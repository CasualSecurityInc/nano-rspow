#!/usr/bin/env bash
# On lemox after build-m5.sh --cli (and optionally install-m5.sh).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p session10
cli=${SNBCL_CLI:-/tmp/nano-snbcl-cli/target/release/nano-rspow}
export OCL_ICD_VENDORS=$PWD/icd
export SNBCL_DEBUG=1
root=718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2
ldd "$cli" | tee session10/m5-linkage.log
grep -q 'libOpenCL.so.1' session10/m5-linkage.log
./test-snb-engine | tee session10/m5-engine.log
./snbcl-smoke pow.cl "$root" fffffe0000000000 2>&1 | tee session10/m5-smoke.log
if grep -E 'unsupported|live application objects|engine ERROR' session10/m5-smoke.log; then exit 1; fi
for tier in receive send; do
  count=1; [[ $tier == receive ]] && count=3
  uptime | tee "session10/m5-$tier.log"
  "$cli" benchmark --backend opencl --tier "$tier" --count "$count" --mode warm --format markdown 2>&1 |
    tee -a "session10/m5-$tier.log"
  grep -F "| \`opencl\` | \`warm\` | \`$tier\` |" "session10/m5-$tier.log"
  grep -q 'build source=MATCH' "session10/m5-$tier.log"
  grep -q 'HIT CPU-verified' "session10/m5-$tier.log"
done
"$cli" generate "$root" --backend opencl --threshold fffffe0000000000 2>&1 | tee session10/m5-work.log
python3 verify-cli-work.py session10/m5-work.log "$cli" | tee session10/m5-work-validate.log
