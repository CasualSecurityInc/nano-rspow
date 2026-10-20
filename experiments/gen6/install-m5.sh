#!/usr/bin/env bash
# Run on lemox after build-m5.sh --cli. Keep a rollback copy of the old CLI.
set -euo pipefail
cd "$(dirname "$0")"
cli=/tmp/nano-snbcl-cli/target/release/nano-rspow
target=$(command -v nano-rspow)
[[ -x $cli && -f libsnbcl.so && -n $target ]] || exit 2
mkdir -p session10 /usr/local/lib/snbcl /etc/OpenCL/vendors
if [[ ! -e session10/nano-rspow-before-m5 ]]; then cp -p "$target" session10/nano-rspow-before-m5; fi
for file in libsnbcl.so m3-12-l16-pred.bin m3-12-l8-pred.bin; do
  mode=644; [[ $file == libsnbcl.so ]] && mode=755
  install -m "$mode" "$file" "/usr/local/lib/snbcl/$file.next"
  mv "/usr/local/lib/snbcl/$file.next" "/usr/local/lib/snbcl/$file"
done
if [[ -e /usr/local/lib/libsnbcl.so && ! -L /usr/local/lib/libsnbcl.so ]]; then
  cp -p /usr/local/lib/libsnbcl.so session10/libsnbcl-before-m5.so
fi
ln -sfn snbcl/libsnbcl.so /usr/local/lib/libsnbcl.so
printf '%s\n' /usr/local/lib/snbcl/libsnbcl.so > /etc/OpenCL/vendors/snbcl.icd.next
mv /etc/OpenCL/vendors/snbcl.icd.next /etc/OpenCL/vendors/snbcl.icd
install -m755 "$cli" "$target.next"
mv "$target.next" "$target"
printf 'CLI %s\n' "$target"
sha256sum "$target" /usr/local/lib/snbcl/libsnbcl.so /usr/local/lib/snbcl/m3-12-l16-pred.bin
ldd "$target"
