//! wgpu GPU backend: cross-platform compute via Vulkan/Metal/DX12.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::{Backend, CancelToken, GeneratorDiagnostics, GpuDiagnostics, TuningSource, WorkError};

const SHADER: &str = include_str!("pow.wgsl");
const WORKGROUP_SIZE: u32 = 64;
const DEFAULT_TUNE_BUDGET_MS: u64 = 250;
const TUNE_CACHE_VERSION: &str = "v1";

#[derive(Debug, Clone)]
pub struct WgpuConfig {
    pub retune: bool,
    pub dispatch_override: Option<u32>,
    pub tune_budget_ms: u64,
}

impl Default for WgpuConfig {
    fn default() -> Self {
        Self {
            retune: false,
            dispatch_override: std::env::var("NANO_RSPOW_WGPU_DISPATCH_X")
                .ok()
                .and_then(|v| v.parse::<u32>().ok()),
            tune_budget_ms: DEFAULT_TUNE_BUDGET_MS,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    hash0: [u32; 4],
    hash1: [u32; 4],
    base_nonce_lo: u32,
    base_nonce_hi: u32,
    threshold_lo: u32,
    threshold_hi: u32,
}

pub(crate) struct WgpuBackend {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    session: Mutex<WgpuSession>,
    dispatch_x: u32,
    diagnostics: GpuDiagnostics,
}

struct WgpuSession {
    uniform_buf: wgpu::Buffer,
    result_buf: wgpu::Buffer,
    readback_buf: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

impl WgpuBackend {
    pub fn new(config: WgpuConfig) -> Result<Self, WorkError> {
        pollster::block_on(Self::new_async(config))
    }

    async fn new_async(config: WgpuConfig) -> Result<Self, WorkError> {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle();
        desc.backends = wgpu::Backends::all();
        let instance = wgpu::Instance::new(desc);

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|_| WorkError::NoAdapter)?;

        let info = adapter.get_info();
        let limits = adapter.limits();
        let max_dispatch = limits.max_compute_workgroups_per_dimension;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("nano-rspow"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: Default::default(),
                experimental_features: Default::default(),
            })
            .await
            .map_err(|e| WorkError::GpuInit(e.to_string()))?;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("nano-rspow-pow"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("nano-rspow-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: false },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("nano-rspow-pl"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("nano-rspow-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        let uniform_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("uniforms"),
            size: std::mem::size_of::<Uniforms>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let result_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("result"),
            size: 12,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let readback_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: 12,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("nano-rspow-bg"),
            layout: &bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buf.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: result_buf.as_entire_binding(),
                },
            ],
        });

        let candidates = dispatch_candidates(max_dispatch);
        let cache_key = tune_cache_key(&info, max_dispatch);
        let cache_path = tune_cache_path(&cache_key);
        let (dispatch_x, source) = select_dispatch(
            &config,
            &candidates,
            &cache_path,
            &device,
            &queue,
            &pipeline,
            &uniform_buf,
            &result_buf,
            &readback_buf,
            &bind_group,
        );

        let diagnostics = GpuDiagnostics {
            backend_api: format!("{:?}", info.backend),
            adapter_name: info.name,
            driver_info: info.driver_info,
            vendor_id: info.vendor,
            device_id: info.device,
            max_compute_workgroups_per_dimension: max_dispatch,
            dispatch_x,
            nonces_per_dispatch: dispatch_x as u64 * WORKGROUP_SIZE as u64,
            tuning_source: source,
            cache_path: Some(cache_path),
        };

        Ok(Self {
            device,
            queue,
            pipeline,
            session: Mutex::new(WgpuSession {
                uniform_buf,
                result_buf,
                readback_buf,
                bind_group,
            }),
            dispatch_x,
            diagnostics,
        })
    }
}

fn dispatch_candidates(max_dispatch: u32) -> Vec<u32> {
    let mut out: Vec<u32> = [1024, 4096, 8192, 16384, 32768, 65535]
        .into_iter()
        .filter(|v| *v > 0 && *v <= max_dispatch)
        .collect();
    out.sort_unstable();
    out.dedup();
    if out.is_empty() && max_dispatch > 0 {
        out.push(max_dispatch);
    }
    out
}

fn tune_cache_key(info: &wgpu::AdapterInfo, max_dispatch: u32) -> String {
    let mut hasher = DefaultHasher::new();
    format!("{:?}", info.backend).hash(&mut hasher);
    info.name.hash(&mut hasher);
    info.driver_info.hash(&mut hasher);
    info.vendor.hash(&mut hasher);
    info.device.hash(&mut hasher);
    max_dispatch.hash(&mut hasher);
    env!("CARGO_PKG_VERSION").hash(&mut hasher);
    SHADER.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn tune_cache_path(cache_key: &str) -> PathBuf {
    std::env::temp_dir()
        .join("nano-rspow")
        .join(format!("wgpu-tune-{TUNE_CACHE_VERSION}-{cache_key}.txt"))
}

fn read_cached_dispatch(path: &PathBuf, candidates: &[u32]) -> Option<u32> {
    let content = fs::read_to_string(path).ok()?;
    let value = content.trim().parse::<u32>().ok()?;
    candidates.contains(&value).then_some(value)
}

fn write_cached_dispatch(path: &PathBuf, dispatch_x: u32) {
    let Some(parent) = path.parent() else { return; };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    let tmp = path.with_extension("tmp");
    if fs::write(&tmp, dispatch_x.to_string()).is_ok() {
        let _ = fs::rename(tmp, path);
    }
}

#[allow(clippy::too_many_arguments)]
fn select_dispatch(
    config: &WgpuConfig,
    candidates: &[u32],
    cache_path: &PathBuf,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pipeline: &wgpu::ComputePipeline,
    uniform_buf: &wgpu::Buffer,
    result_buf: &wgpu::Buffer,
    readback_buf: &wgpu::Buffer,
    bind_group: &wgpu::BindGroup,
) -> (u32, TuningSource) {
    if let Some(v) = config.dispatch_override.filter(|v| candidates.contains(v)) {
        return (v, TuningSource::Manual);
    }

    if !config.retune {
        if let Some(v) = read_cached_dispatch(cache_path, candidates) {
            return (v, TuningSource::Cache);
        }
    }

    if let Some(v) = probe_dispatch(
        config.tune_budget_ms,
        candidates,
        device,
        queue,
        pipeline,
        uniform_buf,
        result_buf,
        readback_buf,
        bind_group,
    ) {
        write_cached_dispatch(cache_path, v);
        return (v, TuningSource::Probe);
    }

    (
        candidates.last().copied().unwrap_or(1024),
        TuningSource::Heuristic,
    )
}

#[allow(clippy::too_many_arguments)]
fn probe_dispatch(
    budget_ms: u64,
    candidates: &[u32],
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pipeline: &wgpu::ComputePipeline,
    uniform_buf: &wgpu::Buffer,
    result_buf: &wgpu::Buffer,
    readback_buf: &wgpu::Buffer,
    bind_group: &wgpu::BindGroup,
) -> Option<u32> {
    let budget = Duration::from_millis(budget_ms.max(1));
    let start = Instant::now();
    let mut best: Option<(u32, f64)> = None;
    for &dispatch_x in candidates {
        if start.elapsed() >= budget {
            break;
        }
        let t0 = Instant::now();
        run_dispatch_once(device, queue, pipeline, uniform_buf, result_buf, readback_buf, bind_group, dispatch_x)?;
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        if elapsed_ms <= 0.0 {
            continue;
        }
        let throughput = (dispatch_x as f64 * WORKGROUP_SIZE as f64) / elapsed_ms;
        match best {
            Some((_, best_tp)) if throughput <= best_tp => {}
            _ => best = Some((dispatch_x, throughput)),
        }
    }
    best.map(|(x, _)| x)
}

#[allow(clippy::too_many_arguments)]
fn run_dispatch_once(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    pipeline: &wgpu::ComputePipeline,
    uniform_buf: &wgpu::Buffer,
    result_buf: &wgpu::Buffer,
    readback_buf: &wgpu::Buffer,
    bind_group: &wgpu::BindGroup,
    dispatch_x: u32,
) -> Option<()> {
    let uniforms = Uniforms {
        hash0: [0; 4],
        hash1: [0; 4],
        base_nonce_lo: 0,
        base_nonce_hi: 0,
        threshold_lo: u32::MAX,
        threshold_hi: u32::MAX,
    };
    let zero_result = [0u32; 3];
    queue.write_buffer(uniform_buf, 0, bytemuck::bytes_of(&uniforms));
    queue.write_buffer(result_buf, 0, bytemuck::cast_slice(&zero_result));

    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("nano-rspow-probe") });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("pow-probe"),
            timestamp_writes: None,
        });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, bind_group, &[]);
        pass.dispatch_workgroups(dispatch_x, 1, 1);
    }
    encoder.copy_buffer_to_buffer(result_buf, 0, readback_buf, 0, 12);
    queue.submit(std::iter::once(encoder.finish()));
    let slice = readback_buf.slice(..);
    let (tx, rx) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    rx.recv().ok()?.ok()?;
    readback_buf.unmap();
    Some(())
}

impl Backend for WgpuBackend {
    fn name(&self) -> &'static str {
        "wgpu"
    }

    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        let session = self.session.lock().ok()?;

        let mut hash0 = [0u32; 4];
        let mut hash1 = [0u32; 4];
        for (i, chunk) in hash[..16].chunks_exact(4).enumerate() {
            hash0[i] = u32::from_le_bytes(chunk.try_into().unwrap());
        }
        for (i, chunk) in hash[16..].chunks_exact(4).enumerate() {
            hash1[i] = u32::from_le_bytes(chunk.try_into().unwrap());
        }

        let threshold_lo = threshold as u32;
        let threshold_hi = (threshold >> 32) as u32;
        let nonces_per_batch = (WORKGROUP_SIZE * self.dispatch_x) as u64;
        let mut base_nonce: u64 = rand::random();
        let zero_result = [0u32; 3];

        loop {
            if cancel.is_cancelled() {
                return None;
            }

            let uniforms = Uniforms {
                hash0,
                hash1,
                base_nonce_lo: base_nonce as u32,
                base_nonce_hi: (base_nonce >> 32) as u32,
                threshold_lo,
                threshold_hi,
            };

            self.queue.write_buffer(&session.uniform_buf, 0, bytemuck::bytes_of(&uniforms));
            self.queue.write_buffer(&session.result_buf, 0, bytemuck::cast_slice(&zero_result));

            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("nano-rspow-enc") });

            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("pow"),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &session.bind_group, &[]);
                pass.dispatch_workgroups(self.dispatch_x, 1, 1);
            }

            encoder.copy_buffer_to_buffer(&session.result_buf, 0, &session.readback_buf, 0, 12);
            self.queue.submit(std::iter::once(encoder.finish()));

            let slice = session.readback_buf.slice(..);
            let (tx, rx) = std::sync::mpsc::channel();
            slice.map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx.send(r);
            });
            let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
            rx.recv().ok()?.ok()?;

            let data: Vec<u32> = {
                let mapped = slice.get_mapped_range();
                bytemuck::cast_slice(&mapped).to_vec()
            };
            session.readback_buf.unmap();

            if data[2] != 0 {
                return Some(data[0] as u64 | ((data[1] as u64) << 32));
            }

            base_nonce = base_nonce.wrapping_add(nonces_per_batch);
        }
    }

    fn diagnostics(&self) -> GeneratorDiagnostics {
        GeneratorDiagnostics {
            backend: "wgpu".to_string(),
            gpu: Some(self.diagnostics.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_clip_to_limits() {
        assert_eq!(dispatch_candidates(4096), vec![1024, 4096]);
    }

    #[test]
    fn candidates_fallback_to_limit_if_small() {
        assert_eq!(dispatch_candidates(128), vec![128]);
    }

    #[test]
    fn cache_read_ignores_corrupt_or_invalid() {
        let p = std::env::temp_dir().join(format!("nano-rspow-test-{}", rand::random::<u64>()));
        fs::write(&p, "bogus").unwrap();
        assert_eq!(read_cached_dispatch(&p, &[1024, 2048]), None);
        fs::write(&p, "2048").unwrap();
        assert_eq!(read_cached_dispatch(&p, &[1024]), None);
        let _ = fs::remove_file(&p);
    }
}
