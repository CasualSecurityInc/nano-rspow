#!/usr/bin/env bash
# Audit M5's saved logs against the milestone gates.
set -u
D=${1:-experiments/gen6/session10}
[ -d "$D" ] || { echo "no log dir: $D" >&2; exit 2; }
P=0; F=0
ok()  { echo "PASS  $1"; P=$((P+1)); }
bad() { echo "FAIL  $1"; F=$((F+1)); }
one() { grep -rEl -- "$1" "$D" 2>/dev/null | head -1; }

# M5-A: smoke solved through the ghost, with no unhandled CL calls.
S=$(one 'SMOKE SOLVED')
if [ -n "$S" ] && ! grep -qEi 'unhandled|unimplemented' "$S"; then
  ok "M5-A  smoke solved, clean debug log  ($S)"
else bad "M5-A  smoke: solved + no unhandled calls (hit: ${S:-none})"; fi

# M5-B: the CLI benchmark process loaded the ghost and reached its engine.
B=$(grep -rEl 'Benchmark Results' "$D" 2>/dev/null \
     | xargs -r grep -lE '\| `opencl` \|' 2>/dev/null | head -1)
[ -n "$B" ] && grep -qE 'snbcl: loaded pid=.*restricted pow_kernel ICD' "$B" \
  && ok "M5-B  ghost loaded in CLI process  ($B)" \
  || bad "M5-B  ghost-load proof line"
[ -n "$B" ] && grep -q 'snbcl: NDRange' "$B" \
  && ok "M5-B  CLI enqueues reached the engine  ($B)" \
  || bad "M5-B  engine-call proof lines"

# M5-C: a benchmark table identifies opencl as the backend.
[ -n "$B" ] && ok "M5-C  opencl benchmark table  ($B)" || bad "M5-C  opencl benchmark table"

# M5-D: check the CLI validate output, not the independent hashlib check.
V="$D/generate-validate.log"
[ -f "$V" ] && grep -qE 'Valid[[:space:]]*:[^[:cntrl:]]*YES' "$V" \
  && ok "M5-D  CLI validate accepted work  ($V)" || bad "M5-D  validate acceptance"

# No saved log should report an invalidated run.
if grep -rqEi 'reset count changed|INVALID RUN' "$D" 2>/dev/null; then
  bad "reset discipline (invalidated run present)"
elif ! grep -rq 'reset_start=[0-9].*reset_end=[0-9]' "$D" 2>/dev/null; then
  bad "reset discipline (no before/after reset evidence)"
elif grep -rE 'reset_start=[0-9]+ reset_end=[0-9]+' "$D" 2>/dev/null \
    | awk '{ split($2,a,"="); split($3,b,"="); n++; if (a[2] != b[2]) bad=1 }
           END { exit (n == 0 || bad) }'; then
  ok "reset discipline (all recorded counts unchanged)"
else
  bad "reset discipline (a recorded reset count changed)"
fi

echo "---- $P pass / $F fail"
if [ "$F" -eq 0 ]; then
  echo "M5: CLOSED on log evidence"
  exit 0
fi
echo "M5: $F evidence gap(s)"
exit 1
