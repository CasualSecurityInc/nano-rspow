#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v ffmpeg >/dev/null 2>&1 || [ ! -f /usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so ]; then
  echo "Installing runtime capture prerequisites (ffmpeg, i965-va-driver)."
  apt-get install -y ffmpeg i965-va-driver
fi
cc -O2 -Wall -Wextra -fPIC -shared -o snb-cap.so snb-cap.c $(pkg-config --cflags libdrm) -ldl -pthread
export CAP_DIR=${CAP_DIR:-/tmp/snbcap}
rm -rf "$CAP_DIR"; mkdir -p "$CAP_DIR"
LD_PRELOAD="$PWD/snb-cap.so" LIBVA_DRIVER_NAME=i965 vainfo 2>&1 | tail -8 || true
LD_PRELOAD="$PWD/snb-cap.so" LIBVA_DRIVER_NAME=i965 \
  ffmpeg -hide_banner -loglevel warning -vaapi_device /dev/dri/renderD128 \
    -f lavfi -i testsrc2=size=128x96:rate=15:duration=1 \
    -vf format=nv12,hwupload -c:v h264_vaapi -g 15 -bf 0 -f null - 2>&1 | tail -10
printf 'captured submissions: '
find "$CAP_DIR" -maxdepth 1 -name 'sub-*.manifest' | wc -l
