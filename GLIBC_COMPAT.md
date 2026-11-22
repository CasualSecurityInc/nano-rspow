# glibc Compatibility of Prebuilt Linux Binaries

This document records the glibc requirements of the prebuilt Linux artifacts
published from this repository, how the floor is enforced in CI, and how to
verify a binary before shipping it.

## Why this document exists

The published `nano-rspow-node` Linux packages ship **two** families of
binaries:

| Package suffix | Target | libc | Notes |
| :--- | :--- | :--- | :--- |
| `-linux-x64-gnu`, `-linux-arm64-gnu` | `*-unknown-linux-gnu` | glibc, dynamically linked | Requires a glibc at or above the declared floor. |
| `-linux-x64-musl`, `-linux-arm64-musl` | `*-unknown-linux-musl` | musl, statically linked | **No glibc dependency at all.** |

The `-gnu` packages are the ones with a compatibility floor. The `-musl`
packages have no floor: they link only against `libc.so` (musl) and contain
**zero** `GLIBC_*` symbol references.

## The 0.18.1 regression (why the floor matters)

`nano-rspow-node@0.18.1` was built on GitHub Actions `ubuntu-latest` runners.
Between 2026-10-19 and 2026-11-19, `ubuntu-latest` moved from Ubuntu 24.04
(glibc 2.39) to **Ubuntu 26.04 (glibc 2.43)**.

glibc 2.43 moved the SVID error handling of a set of single-precision `libm`
functions (`acosf`, `acoshf`, `asinf`, `atan2f`, `atanhf`, `coshf`, `fmodf`,
`log10f`, `remainderf`, `sinhf`, `sqrtf`, `tgammaf`, `y0f`/`y1f`/`ynf`, …) into
new *compatibility symbols*. A binary compiled against glibc 2.43 therefore
records those symbols at version `GLIBC_2.43`.

Because glibc 2.43 did not exist on any released distribution at the time, the
resulting artifacts were unloadable everywhere:

```text
Error: /lib/x86_64-linux-gnu/libm.so.6: version `GLIBC_2.43' not found
  (required by .../nano-rspow-node-linux-x64-gnu/nano-rspow-node.linux-x64-gnu.node)
    at Object..node (node:internal/modules/cjs/loader:2087:18)
```

The build job was green — the runner had glibc 2.43 — so the failure only
surfaced on user machines.

`nano-rspow-node@0.18.2` fixed this by building the Linux targets on
`ubuntu-24.04` (glibc 2.39) and adding the CI gate described below.

## Current floor

| Artifact | Highest required glibc | Equivalent distro |
| :--- | :--- | :--- |
| `nano-rspow-node-linux-x64-gnu` | `GLIBC_2.34` | Ubuntu 22.04, Debian 12, RHEL 9 |
| `nano-rspow-node-linux-arm64-gnu` | `GLIBC_2.34` | Ubuntu 22.04, Debian 12, RHEL 9 |

**Practical support matrix**

| Distribution | glibc | `*-gnu` package | `*-musl` package |
| :--- | :--- | :--- | :--- |
| Debian 13 / Ubuntu 24.04+ | 2.39+ | ✅ | ✅ |
| Debian 12 / Ubuntu 22.04 | 2.35 | ✅ | ✅ |
| RHEL 9 / Rocky 9 / Alma 9 | 2.34 | ✅ | ✅ |
| RHEL 8 / Rocky 8 | 2.28 | ❌ | ✅ |
| Ubuntu 20.04 | 2.31 | ❌ (EOL) | ✅ |
| Alpine / any musl distro | n/a | n/a | ✅ |

`0.18.2` has the **same** glibc floor as `0.17.x` (`GLIBC_2.34`), so it is a
drop-in replacement for existing `0.17.x` consumers.

## How the floor is enforced

`.github/workflows/node-publish.yml` pins the Linux build hosts to
`ubuntu-24.04` and runs a gate on every `-linux-*-gnu` build:

```yaml
- name: Verify glibc floor (linux-gnu)
  if: matrix.settings.target == 'x86_64-unknown-linux-gnu' || matrix.settings.target == 'aarch64-unknown-linux-gnu'
  shell: bash
  run: |
    # Oldest glibc we support (Ubuntu 22.04 = 2.35). A binary built on a newer
    # glibc will not load on older distros, so fail the release instead.
    required="2.35"
    for so in nano-rspow-node/*.node; do
      need=$(objdump -T "$so" | grep -oE 'GLIBC_[0-9]+(\.[0-9]+)+' | sed 's/GLIBC_//' | sort -uV | tail -n 1)
      echo "$so needs glibc ${need:-none}"
      if [ -n "$need" ] && [ "$(printf '%s\n%s\n' "$need" "$required" | sort -V | tail -n 1)" != "$required" ]; then
        echo "::error::$so requires glibc $need, but the supported floor is $required"
        exit 1
      fi
    done
```

If a runner image upgrade ever raises the floor again, the release fails
before anything reaches npm.

## Verifying a binary locally

Find the highest glibc version a binary requires:

```bash
objdump -T nano-rspow-node.linux-x64-gnu.node \
  | grep -oE 'GLIBC_[0-9]+(\.[0-9]+)+' \
  | sed 's/GLIBC_//' \
  | sort -uV | tail -n 1
```

Check it resolves on a given distribution:

```bash
docker run --rm -i ubuntu:22.04 bash -c \
  'cat > /tmp/x.node; apt-get install -y -qq libc-bin >/dev/null 2>&1; ldd -r /tmp/x.node' \
  < nano-rspow-node.linux-x64-gnu.node
```

`ldd -r` reports every unresolved symbol version, so a mismatch shows up
immediately:

```text
/tmp/x.node: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.32' not found (required by /tmp/x.node)
```

End-to-end smoke test:

```bash
docker run --rm node:24 /bin/bash -c 'npx -y xno-skills --version'   # glibc
docker run --rm node:24-alpine /bin/sh -c 'npx -y xno-skills --version'  # musl
```

## Lowering the floor further (optional)

If support for glibc < 2.34 is ever required (RHEL 8), build the `-gnu`
targets against an explicitly pinned glibc instead of the runner's default:

```bash
cargo zigbuild --release --target x86_64-unknown-linux-gnu.2.28
```

The `.2.28` suffix pins the glibc version cargo-zigbuild links against. This
is not enabled today because Ubuntu 20.04 and RHEL 8 are both past standard
support, and the musl packages already cover those environments.

## Related

- [`nano-rspow-node/README.md`](nano-rspow-node/README.md) — Node.js bindings
- [`nano-rspow-node/npm/`](nano-rspow-node/npm/) — per-platform package manifests
- [Node.js bindings release workflow](.github/workflows/node-publish.yml)
- [Native release artifacts workflow](.github/workflows/native-release.yml) — the
  standalone CLI binaries are already built on `ubuntu-24.04`
