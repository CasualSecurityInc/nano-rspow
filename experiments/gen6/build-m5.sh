#!/usr/bin/env bash
# Build C pieces; --cli also stages the unchanged Rust workspace and release CLI.
set -euo pipefail
cd "$(dirname "$0")"
with_cli=0
if [[ ${1:-} == --cli ]]; then with_cli=1; shift; fi
(($# == 0)) || { echo 'usage: build-m5.sh [--cli]' >&2; exit 2; }
ssh root@lemox.lan 'test -r /usr/include/CL/cl_icd.h && test -e /usr/lib/x86_64-linux-gnu/libOpenCL.so || apt-get install -y -qq opencl-headers ocl-icd-opencl-dev'
bash build-m4.sh
python3 make-powcl.py
remote=/tmp/nano-gen6-m3
scp libsnbcl.c powcl_blob.h snbcl-smoke.c test-snb-engine.c m5.sh verify-cli-work.py install-m5.sh requalify-when-idle.sh ../../nano-rspow/src/opencl_backend/pow.cl "root@lemox.lan:$remote/"
ssh root@lemox.lan "cd $remote && \
  cc -std=gnu11 -O3 -march=sandybridge -fPIC -shared -Wall -Wextra -Werror \$(pkg-config --cflags libdrm) -Wl,-Bsymbolic-functions -Wl,-soname,libsnbcl.so -o libsnbcl.so libsnbcl.c snb-engine.c blake8.c -pthread -ldl && \
  cc -O2 -Wall -Wextra -Werror -o snbcl-smoke snbcl-smoke.c blake8.c -lOpenCL && \
  cc -std=gnu11 -O2 -Wall -Wextra -Werror \$(pkg-config --cflags libdrm) -o test-snb-engine test-snb-engine.c snb-engine.c blake8.c -ldl && \
  mkdir -p icd && printf '%s\\n' $remote/libsnbcl.so > icd/snbcl.icd && ./test-snb-engine"
if ((with_cli)); then
  temp_src=$(mktemp /tmp/snbcl-cli-src.XXXXXX)
  trap 'rm -f "$temp_src"' EXIT
  (cd ../.. && tar -cf "$temp_src" --exclude=target --exclude=node_modules --exclude=dist --exclude='*.wasm' --exclude='*.node' \
    Cargo.toml Cargo.lock README.md nano-rspow nano-rspow-cli nano-rspow-ffi nano-rspow-node nano-rspow-python nano-rspow-web)
  scp "$temp_src" root@lemox.lan:/tmp/snbcl-cli-src.tar
  ssh root@lemox.lan 'mkdir -p /tmp/nano-snbcl-cli && tar -xf /tmp/snbcl-cli-src.tar -C /tmp/nano-snbcl-cli && cd /tmp/nano-snbcl-cli && CARGO_PROFILE_RELEASE_DEBUG=0 CARGO_PROFILE_RELEASE_STRIP=debuginfo CARGO_INCREMENTAL=0 cargo build --release --locked -p nano-rspow-cli --features opencl -j 2'
fi
