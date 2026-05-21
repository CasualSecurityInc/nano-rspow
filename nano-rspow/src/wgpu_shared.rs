//! Shader source and uniform types shared between the native wgpu backend and
//! the WASM WebGPU backend (`nano-rspow-web`).  Gated behind `wgpu-types` so
//! WASM builds can pull in just these definitions without the native wgpu feature set.

/// Number of invocations per workgroup — substituted into `@workgroup_size(WGS_PLACEHOLDER)`
/// in `pow.wgsl` at runtime. Change this constant to try different workgroup sizes.
pub const WORKGROUP_SIZE: u32 = 256;

/// WGSL compute shader source compiled by both the native and WASM backends.
pub const SHADER: &str = include_str!("wgpu_backend/pow.wgsl");

/// Uniform buffer written by the host before each dispatch.
///
/// Field order and sizes must stay in sync with the `Uniforms` struct in `pow.wgsl`.
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Uniforms {
    pub hash0: [u32; 4],
    pub hash1: [u32; 4],
    pub base_nonce_lo: u32,
    pub base_nonce_hi: u32,
    pub threshold_lo: u32,
    pub threshold_hi: u32,
}
