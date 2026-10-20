# snbcl: Gen6 Nano PoW adapter

This experimental OpenCL ICD runs the checkout's `pow_kernel` through the Sandy
Bridge media pipeline. It supports that one program and the API subset needed by
nano-rspow. It is **not a conformant general OpenCL implementation**. Compatibility
profile/version strings do not imply arbitrary-kernel or extension support.

## Build and use

From this directory on the workstation:

```sh
bash m5-recon.sh
bash build-m5.sh --cli
```

This builds optimized C code and stages the unchanged Rust workspace on
`root@lemox.lan`. The release CLI build uses `--locked -p nano-rspow-cli
--features opencl`, two jobs, and disables release debug information. C-only
rebuilds omit `--cli`. The existing M3 kernel binaries remain checksum pinned.

On lemox, before installing globally:

```sh
cd /tmp/nano-gen6-m3
OCL_ICD_VENDORS=$PWD/icd SNBCL_DEBUG=1 ./snbcl-smoke pow.cl \
  718cc2121c3e641059bc1c2cfc45666c99e8ae922f7a807b7d07b62c995d79e2 fffffe0000000000
```

The smoke requires the shader path, root and threshold arguments. `m5.sh` runs the
complete smoke/benchmark/generate/validate sequence against the staged CLI.

Install the tested library, kernels, vendor registration, and release CLI:

```sh
bash install-m5.sh
nano-rspow benchmark --backend opencl --tier receive --count 3 --mode warm --format markdown
```

Installation places the library and both kernels in `/usr/local/lib/snbcl/`,
registers `/etc/OpenCL/vendors/snbcl.icd`, and preserves the previous CLI in
`session10/nano-rspow-before-m5`. The tested CLI is `/root/.cargo/bin/nano-rspow`.
The neutral system OpenCL loader remains in use. Debian's loader ignores
`OCL_ICD_FILENAMES`; use `OCL_ICD_VENDORS` for private testing, or the standard
vendor registration for normal use. `SNBCL_DEBUG=1` records source matching,
hits, counters and resets; `=2` also records every missed enqueue.

## Contract and verification

The adapter accepts the exact checkout shader after CRLF normalization, plus
ocl 0.19.7's exact two-newline prefix. Other sources fail program build. Scalar
arguments are decoded by index, independently of pointer size. The shim uses
real ICD dispatch pointers, reference-counted handles, checked buffer ranges,
and synchronous in-order events. It advertises no int64 atomic extensions.

The shared engine accepts arbitrary nonce bases, handles low-word and u64 wrap,
uses CPU prefix/tails around aligned SIMD batches, and CPU-verifies every hit.
GPU errors propagate to OpenCL errors. Failed initialization exposes no usable
platform; the CLI may then fall back to CPU, so verify its reported backend.

`test-snb-engine`, `snbcl-smoke`, and `verify-cli-work.py` cover the engine,
loader path and independent Python/CLI validation. Historical observations and
actual gate logs are linked in `m5-session10-results.md`.

## Qualification and rollback

`requalify-when-idle.sh` checks every five minutes for at most 24 hours and runs
one qualification attempt only when load <0.20, CPU pressure <5%, and maximum
reported temperature <85°C. It changes no host services or clock settings.
Logs and PID are in `/tmp/nano-gen6-m3/session10/`. Stop the waiting watcher with:

```sh
kill "$(cat /tmp/nano-gen6-m3/session10/requalify.pid)"
```

`sustain-monitor.py` samples clocks during timestamped buckets. Its normalized
retention is an association, not proof of a single cause. Raw retention remains
reported separately. A short instrumentation test is not sustained qualification.

To remove this installation, remove `/etc/OpenCL/vendors/snbcl.icd` and restore
`session10/nano-rspow-before-m5` to `/root/.cargo/bin/nano-rspow`. The installed
library directory can then be removed if no other process uses it.
