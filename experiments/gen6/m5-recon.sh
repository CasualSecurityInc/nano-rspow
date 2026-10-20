#!/usr/bin/env bash
# Read-only recon of this checkout and the release build staged on lemox.
set -euo pipefail
cd "$(dirname "$0")/../.."
echo '=== authoritative source and Rust enqueue contract ==='
shasum -a 256 nano-rspow/src/opencl_backend/pow.cl nano-rspow/src/opencl_backend/mod.rs Cargo.lock
git rev-parse HEAD
cat nano-rspow/src/opencl_backend/mod.rs
sed -n '/__kernel void pow_kernel/,$p' nano-rspow/src/opencl_backend/pow.cl
echo '=== features ==='
rg -n 'ocl|opencl|wgpu|name = "nano-rspow-cli"' nano-rspow/Cargo.toml nano-rspow-cli/Cargo.toml
echo 'CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=debuginfo CARGO_INCREMENTAL=0 cargo build --release --locked -p nano-rspow-cli --features opencl -j 2'
echo '=== CLI fallback and benchmark verification ==='
sed -n '459,476p' nano-rspow-cli/src/main.rs
sed -n '650,699p' nano-rspow-cli/src/main.rs
echo '=== lemox release linkage, linked OpenCL imports, loader controls ==='
ssh root@lemox.lan 'uptime; cargo --version; ldd /tmp/nano-snbcl-cli/target/release/nano-rspow; nm -D /tmp/nano-snbcl-cli/target/release/nano-rspow | grep " U cl"; strings /lib/x86_64-linux-gnu/libOpenCL.so.1 | grep OCL_ICD; ls -l /usr/include/CL/cl{,_icd}.h'
