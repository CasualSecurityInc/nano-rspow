//! wgpu GPU backend: cross-platform compute via Vulkan/Metal/DX12.
//!
//! Uses WGSL compute shaders with u32-pair u64 emulation for Blake2b.
//! Testable on M1 Mac via Metal.


use wgpu::util::DeviceExt;

use crate::{Backend, CancelToken, WorkError};

const SHADER: &str = include_str!("pow.wgsl");

// Each dispatch covers WORKGROUP_SIZE * DISPATCH_X nonces per batch.
const WORKGROUP_SIZE: u32 = 64;
const DISPATCH_X: u32 = 1024; // 64 * 1024 = 65536 nonces per batch

/// Uniforms passed to the GPU per batch dispatch.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Uniforms {
    hash0: [u32; 4],      // hash bytes 0-15 as 4 x u32 LE (maps to vec4<u32>)
    hash1: [u32; 4],      // hash bytes 16-31 as 4 x u32 LE (maps to vec4<u32>)
    base_nonce_lo: u32,
    base_nonce_hi: u32,
    threshold_lo: u32,
    threshold_hi: u32,
}

pub(crate) struct WgpuBackend {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    bind_group_layout: wgpu::BindGroupLayout,
}

impl WgpuBackend {
    pub fn new() -> Result<Self, WorkError> {
        pollster::block_on(Self::new_async())
    }

    async fn new_async() -> Result<Self, WorkError> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends: wgpu::Backends::all(),
            ..Default::default()
        });

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .ok_or(WorkError::NoAdapter)?;

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("nano-rspow"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::default(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| WorkError::GpuInit(e.to_string()))?;

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("nano-rspow-pow"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });

        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("nano-rspow-bgl"),
            entries: &[
                // binding 0: uniforms
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
                // binding 1: result (storage, read_write)
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
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("nano-rspow-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        Ok(Self {
            device,
            queue,
            pipeline,
            bind_group_layout,
        })
    }
}

impl Backend for WgpuBackend {
    fn name(&self) -> &'static str {
        "wgpu"
    }

    fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        // Convert hash to two vec4<u32> (4 x u32 each), little-endian
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

        // Result buffer: [nonce_lo, nonce_hi, found_flag]
        let result_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("result"),
            size: 12, // 3 x u32
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let readback_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: 12,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let nonces_per_batch = (WORKGROUP_SIZE * DISPATCH_X) as u64;
        let mut base_nonce: u64 = rand::random();

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

            let uniform_buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("uniforms"),
                contents: bytemuck::bytes_of(&uniforms),
                usage: wgpu::BufferUsages::UNIFORM,
            });

            // Reset result buffer to zero for this batch
            let zero_buf = self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("zero"),
                contents: bytemuck::cast_slice(&[0u32; 3]),
                usage: wgpu::BufferUsages::COPY_SRC,
            });

            let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("nano-rspow-bg"),
                layout: &self.bind_group_layout,
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

            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("nano-rspow-enc"),
                });

            // Reset result
            encoder.copy_buffer_to_buffer(&zero_buf, 0, &result_buf, 0, 12);

            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("pow"),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &bind_group, &[]);
                pass.dispatch_workgroups(DISPATCH_X, 1, 1);
            }

            encoder.copy_buffer_to_buffer(&result_buf, 0, &readback_buf, 0, 12);
            self.queue.submit(std::iter::once(encoder.finish()));

            // Read back result
            let slice = readback_buf.slice(..);
            let (tx, rx) = std::sync::mpsc::channel();
            slice.map_async(wgpu::MapMode::Read, move |r| tx.send(r).unwrap());
            self.device.poll(wgpu::MaintainBase::Wait);
            rx.recv().unwrap().ok()?;

            let data: Vec<u32> = {
                let mapped = slice.get_mapped_range();
                bytemuck::cast_slice(&mapped).to_vec()
            };
            readback_buf.unmap();

            let found = data[2];
            if found != 0 {
                let nonce_lo = data[0] as u64;
                let nonce_hi = data[1] as u64;
                return Some(nonce_lo | (nonce_hi << 32));
            }

            base_nonce = base_nonce.wrapping_add(nonces_per_batch);
        }
    }
}
