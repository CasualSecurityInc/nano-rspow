use std::sync::{Arc, Mutex};
use wgpu::BufferAsyncError;
use wasm_bindgen::prelude::*;

use nano_rspow::CancelToken;

macro_rules! console_log {
    ($($t:tt)*) => (
        web_sys::console::log_1(&wasm_bindgen::JsValue::from_str(&format!($($t)*)))
    )
}

const WORKGROUP_SIZE: u32 = 64;

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

struct MapResult {
    done: bool,
    result: Option<Result<(), BufferAsyncError>>,
}

pub struct WgpuWebGenerator {
    device: wgpu::Device,
    queue: wgpu::Queue,
    pipeline: wgpu::ComputePipeline,
    uniform_buf: wgpu::Buffer,
    result_buf: wgpu::Buffer,
    readback_buf: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = setTimeout)]
    fn set_timeout(callback: &js_sys::Function, ms: f64) -> wasm_bindgen::JsValue;
}

async fn js_sleep_ms(ms: f64) {
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        let _ = set_timeout(&resolve, ms);
    });
    let _ = wasm_bindgen_futures::JsFuture::from(promise).await;
}



impl WgpuWebGenerator {
    pub async fn new() -> Result<Self, String> {
        console_log!("[WebGPU] Instantiating wgpu::Instance...");
        let instance = wgpu::Instance::default();
        
        console_log!("[WebGPU] Requesting adapter...");
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: None,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| format!("Failed to request WebGPU adapter: {:?}", e))?;

        console_log!("[WebGPU] Adapter acquired. Requesting device...");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("nano-rspow-web"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::default(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: Default::default(),
                experimental_features: Default::default(),
            })
            .await
            .map_err(|e| format!("Failed to request WebGPU device: {}", e))?;

        console_log!("[WebGPU] Device and Queue acquired. Compiling WGSL shader...");
        let shader_src = include_str!("../../nano-rspow/src/wgpu_backend/pow.wgsl");
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("nano-rspow-pow"),
            source: wgpu::ShaderSource::Wgsl(shader_src.into()),
        });

        console_log!("[WebGPU] Shader module created. Creating bind group layout...");
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

        console_log!("[WebGPU] Bind group layout created. Creating pipeline layout...");
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("nano-rspow-pl"),
            bind_group_layouts: &[Some(&bind_group_layout)],
            immediate_size: 0,
        });

        console_log!("[WebGPU] Pipeline layout created. Creating compute pipeline...");
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("nano-rspow-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });

        console_log!("[WebGPU] Compute pipeline compiled. Allocating buffers...");
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

        console_log!("[WebGPU] Buffers allocated. Creating bind group...");
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

        console_log!("[WebGPU] Initialization complete!");
        Ok(Self {
            device,
            queue,
            pipeline,
            uniform_buf,
            result_buf,
            readback_buf,
            bind_group,
        })
    }

    pub async fn generate(&self, hash: &[u8; 32], threshold: u64, cancel: &CancelToken) -> Option<u64> {
        console_log!("[WebGPU] generate called. threshold: {:016x}", threshold);
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
        const DISPATCH_X: u32 = 8192;
        let nonces_per_batch = (WORKGROUP_SIZE * DISPATCH_X) as u64;

        let mut base_nonce: u64 = rand::random();
        let zero_result = [0u32; 3];
        let mut batch_count = 0;

        loop {
            batch_count += 1;
            console_log!("[WebGPU] Batch #{} starting. base_nonce: {:016x}", batch_count, base_nonce);
            
            if cancel.is_cancelled() {
                console_log!("[WebGPU] Generation cancelled. Exiting loop.");
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

            self.queue.write_buffer(&self.uniform_buf, 0, bytemuck::bytes_of(&uniforms));
            self.queue.write_buffer(&self.result_buf, 0, bytemuck::cast_slice(&zero_result));

            let mut encoder = self
                .device
                .create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("nano-rspow-enc") });

            {
                let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                    label: Some("pow"),
                    timestamp_writes: None,
                });
                pass.set_pipeline(&self.pipeline);
                pass.set_bind_group(0, &self.bind_group, &[]);
                pass.dispatch_workgroups(DISPATCH_X, 1, 1);
            }

            encoder.copy_buffer_to_buffer(&self.result_buf, 0, &self.readback_buf, 0, 12);
            
            console_log!("[WebGPU] Submitting command encoder to queue...");
            self.queue.submit(std::iter::once(encoder.finish()));

            let slice = self.readback_buf.slice(..);
            let shared = Arc::new(Mutex::new(MapResult {
                done: false,
                result: None,
            }));

            let shared_clone = Arc::clone(&shared);
            console_log!("[WebGPU] Calling slice.map_async...");
            slice.map_async(wgpu::MapMode::Read, move |res| {
                console_log!("[WebGPU] map_async callback executed!");
                let mut shared = shared_clone.lock().unwrap();
                shared.done = true;
                shared.result = Some(res);
            });

            // Poll for completion with a timeout to avoid hangs
            let mut timeout_ticks = 0;
            const MAX_TICKS: u32 = 100; // 100 * 10ms = 1000ms total timeout

            loop {
                if cancel.is_cancelled() {
                    console_log!("[WebGPU] Generation cancelled. Exiting loop.");
                    return None;
                }

                {
                    let shared_lock = shared.lock().unwrap();
                    if shared_lock.done {
                        if let Some(res) = &shared_lock.result {
                            if res.is_err() {
                                console_log!("[WebGPU] Error: map_async callback returned error: {:?}", res);
                                return None;
                            }
                            break;
                        }
                    }
                }

                if timeout_ticks >= MAX_TICKS {
                    console_log!("[WebGPU] Error: map_async timed out after 1000ms. Aborting WebGPU.");
                    return None;
                }

                timeout_ticks += 1;
                // Yield to browser event loop to allow GPU mapping callback to execute
                js_sleep_ms(10.0).await;
            }
            console_log!("[WebGPU] map_async successfully completed. Reading data...");

            let data: Vec<u32> = {
                let mapped = slice.get_mapped_range();
                bytemuck::cast_slice(&mapped).to_vec()
            };
            self.readback_buf.unmap();
            console_log!("[WebGPU] Buffer unmapped. Data: {:?}", data);

            if data[2] != 0 {
                let found_nonce = data[0] as u64 | ((data[1] as u64) << 32);
                console_log!("[WebGPU] Success! Found valid nonce: {:016x}", found_nonce);
                return Some(found_nonce);
            }

            console_log!("[WebGPU] No valid nonce found in this batch. Incrementing nonce.");
            base_nonce = base_nonce.wrapping_add(nonces_per_batch);
        }
    }
}
