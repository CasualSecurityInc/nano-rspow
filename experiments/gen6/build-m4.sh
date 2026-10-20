#!/usr/bin/env bash
# Workstation entry point: generate/assemble kernels, build and test on lemox.
set -euo pipefail
cd "$(dirname "$0")"
bash build-m3.sh 12 --lanes 16 --pred
bash build-m3.sh 12 --lanes 8 --pred
python3 make-snb-engine.py
remote=/tmp/nano-gen6-m3
scp snb-pow.c snb-engine.c snb-engine-api.h blake8.c blake8.h snb-engine.h snb-gpu.h test-blake8.py test-snb-pow.c \
  idle-bench.sh sustain.sh sustain-monitor.py fixed-work.sh fit.py m4.sh verify-snb-pow.py summarize-m4.py "root@lemox.lan:$remote/"
ssh root@lemox.lan "cd $remote && mkdir -p session9 && \
  cc -std=gnu11 -O3 -march=sandybridge -Wall -Wextra -Werror \$(pkg-config --cflags libdrm) -o snb-pow snb-pow.c snb-engine.c blake8.c -pthread -ldl && \
  cc -std=gnu11 -O2 -Wall -Wextra -Werror \$(pkg-config --cflags libdrm) -o test-snb-pow test-snb-pow.c snb-engine.c blake8.c -pthread -ldl && \
  python3 test-blake8.py && ./test-snb-pow"
