#!/usr/bin/env bash
# Read-only Gen6 reconnaissance. Run on lemox with:
#   bash snbcl-m0.sh 2>&1 | tee m0.log
set -u

sec() { printf '\n=== %s ===\n' "$1"; }

sec 'render node and permissions'
ls -l /dev/dri/
id
if [[ -r /dev/dri/renderD128 && -w /dev/dri/renderD128 ]]; then
  echo 'OK: renderD128 is readable and writable'
else
  echo 'WARN: renderD128 is not readable and writable'
fi

sec 'kernel and i915'
uname -a
grep -m1 i915 /proc/modules || echo 'i915 is built in'
(sudo -n dmesg 2>/dev/null || dmesg 2>/dev/null) | grep -iE 'i915|drm' | tail -15 || true

sec 'GPU identity'
lspci -nnk | grep -A3 -iE 'vga|display' || true

sec 'build headers and tools'
gcc --version | head -1
python3 --version
pkg-config --modversion libdrm 2>/dev/null || echo 'libdrm pkg-config metadata is absent'
find /usr/include /usr/src -name i915_drm.h -print 2>/dev/null | head -10

sec 'network'
curl -sI -m 5 https://gitlab.freedesktop.org >/dev/null \
  && echo 'network access to GitLab: OK' || echo 'network access to GitLab: unavailable'

sec 'installed nano-rspow binary'
bin=$(readlink -f "$(command -v nano-rspow)") || exit 1
echo "binary: $bin"
file "$bin"
echo "OpenCL API symbol strings: $(strings -a "$bin" | grep -ciE 'clGetPlatformIDs|clCreateProgramWithSource' || true)"
strings -a "$bin" | grep -m5 -iE '__kernel|blake2b' || echo 'No embedded OpenCL kernel source found'
dpkg -S "$bin" 2>/dev/null || echo 'binary is not managed by dpkg'
cargo install --list 2>/dev/null | grep -i -B1 -A1 nano || true

sec 'Nano PoW kernel source locations in the checkout'
echo 'Run from the repository root: rg -n "__kernel void pow_kernel|BATCH_SIZE|WORKGROUP_SIZE" nano-rspow/src/opencl_backend'
