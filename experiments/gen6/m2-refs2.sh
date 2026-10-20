#!/usr/bin/env bash
# M2.0 authority refresh for Session 3: pin SNB command/layout and VAAPI cribs.
set -u
cd "$(dirname "$0")"
R="$PWD/ref"; V="$R/intel-vaapi-driver/src"
say() { printf '\n===== %s =====\n' "$1"; }

say "tools and PRM"
if ! command -v pdftotext >/dev/null 2>&1; then
  apt-get install -y -qq poppler-utils >/dev/null 2>&1 || echo "WARN: pdftotext unavailable"
fi
PDF=snb_ihd_os_vol2_part2.pdf
if [ -s "$PDF" ] && command -v pdftotext >/dev/null 2>&1; then
  pdftotext -layout "$PDF" snb-vol2p2.txt
  grep -nE "MEDIA_OBJECT_WALKER|MEDIA_VFE_STATE|MEDIA_CURBE_LOAD|MEDIA_INTERFACE_DESCRIPTOR_LOAD|MEDIA_STATE_POINTERS|MEDIA_STATE_FLUSH|STATE_BASE_ADDRESS|PIPELINE_SELECT|Scratch Space|Media Write" snb-vol2p2.txt | head -80
else echo "PRM text extraction unavailable"; fi

say "Mesa references (pinned tags/mirror; cross-check only)"
fetch() {
  local name="$1" path="$2" out="$R/$1" u
  [ -s "$out" ] && { echo "have $name"; return 0; }
  for u in "https://gitlab.freedesktop.org/mesa/mesa/-/raw/main/$path" \
           "https://gitlab.freedesktop.org/mesa/mesa/-/raw/mesa-23.3.6/$path" \
           "https://gitlab.freedesktop.org/mesa/mesa/-/raw/mesa-21.3.9/$path" \
           "https://raw.githubusercontent.com/mesa/mesa/mesa-23.3.6/$path"; do
    if curl -fsSL -m 90 -o "$out" "$u" 2>/dev/null; then echo "OK $name <- $u"; return 0; fi
  done
  echo "FAIL $name (PRM+VAAPI cross-check remain available)"; rm -f "$out"; return 1
}
fetch gen6.xml src/intel/genxml/gen6.xml || true
fetch gen7.xml src/intel/genxml/gen7.xml || true
fetch gen_pack_header.py src/intel/genxml/gen_pack_header.py || true
fetch brw_eu_defines.h src/intel/compiler/brw_eu_defines.h || true
if [ -s "$R/gen6.xml" ] && [ -s "$R/gen_pack_header.py" ]; then
  python3 "$R/gen_pack_header.py" "$R/gen6.xml" > "$R/gen6_pack.h" 2>/dev/null && echo "gen6_pack.h: $(wc -l < "$R/gen6_pack.h") lines"
fi
[ -s "$R/brw_eu_defines.h" ] && grep -nE "DATAPORT|SCRATCH|OW_BLOCK" "$R/brw_eu_defines.h" | head -30

say "VAAPI command macros and numeric values"
sed -n '1,48p' "$V/i965_defines.h"
cat > /tmp/snb-cmdprint.c <<'C'
#include <stdio.h>
#include "i965_defines.h"
#define X(c) printf("%-38s 0x%08x\n", #c, (unsigned)(c))
int main(void) {
 X(CMD_PIPELINE_SELECT); X(CMD_MEDIA_STATE_POINTERS); X(CMD_MEDIA_VFE_STATE);
 X(CMD_MEDIA_CURBE_LOAD); X(CMD_MEDIA_INTERFACE_DESCRIPTOR_LOAD);
 X(CMD_MEDIA_GATEWAY_STATE); X(CMD_MEDIA_STATE_FLUSH); X(CMD_MEDIA_OBJECT);
 X(CMD_MEDIA_OBJECT_WALKER); return 0;
}
C
cc -I"$V" -o /tmp/snb-cmdprint /tmp/snb-cmdprint.c 2>/tmp/snb-cmdprint.err && /tmp/snb-cmdprint || { echo "cmd macro compile failed"; head -5 /tmp/snb-cmdprint.err; }

say "VAAPI Gen6 command emission and state layouts"
grep -n -B6 -A30 "CMD_MEDIA_VFE_STATE" "$V"/*.c | head -100
grep -n -B6 -A18 "CMD_MEDIA_CURBE_LOAD" "$V"/*.c | head -70
grep -n -B6 -A20 "CMD_MEDIA_INTERFACE" "$V"/*.c | head -70
grep -n -B6 -A20 "CMD_MEDIA_STATE_POINTERS" "$V"/*.c | head -70
grep -n -B4 -A12 "CMD_MEDIA_STATE_FLUSH" "$V"/*.c | head -45
grep -rn "STATE_BASE_ADDRESS" "$V" | head -18
grep -rn -B2 -A16 "struct gen6_interface_descriptor" "$V"/*.h | head -70
grep -n -B5 -A24 "idrt\|gpe_context_init" "$V/i965_gpe_utils.c" | head -90
grep -n -B5 -A40 "i965_gpe_buffer_suface_setup" "$V/i965_gpe_utils.c" | head -100
grep -n -B5 -A25 "CMD_MEDIA_OBJECT[^_]" "$V/gen6_vme.c" "$V/i965_gpe_utils.c" | head -130

say "VME source write descriptors and EOT"
find "$R/intel-vaapi-driver/src/shaders/vme" -maxdepth 1 -type f -printf '%f\n' 2>/dev/null | head -40
for f in "$R"/intel-vaapi-driver/src/shaders/vme/*.inc; do
  [ -f "$f" ] || continue
  echo "--- $f"; grep -nE "nDPMW|nDATAPORT|nBI_|EOT" "$f" | head -30
done
find "$R/intel-vaapi-driver/src/shaders" -name '*.asm' -print | head -15

say "capture prerequisites"
[ -f /usr/lib/x86_64-linux-gnu/dri/i965_drv_video.so ] && echo "i965 driver present" || echo "i965 driver missing"
command -v ffmpeg >/dev/null && { echo "ffmpeg present"; ffmpeg -hide_banner -encoders 2>/dev/null | grep -o h264_vaapi | head -1 || true; } || echo "ffmpeg missing"
echo "done"
