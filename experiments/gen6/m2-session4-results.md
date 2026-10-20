# Route C M2.1: Session 4 instrument results

## First-light result

The VAAPI capture baseline replay completed on `lemox.lan`: 10 objects, render
ring, 216-byte batch. Replaying the same capture with object 6 replaced by the
assembled two-instruction `m21eot` kernel also completed. The replacement was
32 bytes in a 4096-byte kernel BO; the descriptor and all command/state BOs
were left from the captured submission. Neither replay added a new i915 GPU
HANG entry.

The EOT SEND is byte-identical to the final instruction of both shipped
`intra_frame.g6b` and `inter_frame.g6b` kernels:

```text
07800031 24001cc8 00000000 82000010
```

This proves the assembled EOT kernel completes when launched through VAAPI's
captured Gen6 media state. It isolates the remaining hang to the custom
batch/state/descriptor path (class A). It does not yet prove the dataport dump
kernel (class B), nor does it prove the custom Walker submission.

## What the refreshed capture pins

The retained relocation-aware capture for `sub-002` is stored in
`capture/session4/`; the relevant decoded output is
`capmedia-session4-sub-002.log`. The older `capture/sub-002.tar` is also kept
as a compact standalone snapshot, but does not contain relocation domains.

For `sub-002`, VAAPI emits three four-dword PIPE_CONTROL packets, then
PIPELINE_SELECT, a ten-dword STATE_BASE_ADDRESS, an eight-dword
MEDIA_VFE_STATE, four-dword CURBE and interface-descriptor loads, and one
14-dword MEDIA_OBJECT. Its load sizes are 128 bytes for CURBE and 1024 bytes
for IDRT. The IDRT kernel pointer relocation has `INSTRUCTION` read domain;
the state-surface relocations use `RENDER` read/write. The sync workaround
relocation uses `INSTRUCTION` read/write. These values are preserved by the
new capture format and replayed without inferred domains.

The previous six-dword `MEDIA_OBJECT` fallback is internally length-consistent
(`0x71000004` declares six total dwords), but it is not the packet shape used
by the captured dispatch. The VAAPI capture and source provide stronger
reference shapes; keep the difference visible when testing the custom batch.

The updated capture shim also supports `CAP_ONLY=1`: it snapshots an
execbuffer and returns `ECANCELED` before the real ioctl. I captured both
custom dispatch forms this way, using the EOT-only kernel, without submitting
them to the GPU. The Walker batch is 58 dwords and the no-inline
`MEDIA_OBJECT` batch is 46 dwords; both packet lengths match their headers.
Their first post-VFE differences from the working VAAPI capture are the CURBE
load length (64 vs. 128 bytes), IDRT load length (32 vs. 1024 bytes), and the
IDRT location/layout (shared state BO at +0x80 vs. a separate table BO at
+0). The captured dispatch is a 14-dword `MEDIA_OBJECT`; the custom form is
six dwords, also self-consistent. These differences are now visible in the
saved `capmedia-custom-eot-*.log` files.

I then replayed the custom `MEDIA_OBJECT` capture in prefixes. The prefix
ending after IDRT load completed without a reset. The six-dword dispatch
prefix caused a new GT reset. At first the replayer printed `COMPLETE` because
`GEM_WAIT` returns idle after reset; that was a false positive. `snb-replay.c`
now compares i915 reset statistics before and after each replay and reports a
reset as failure. Replacing only the six-dword command with the 14 captured
MEDIA_OBJECT dwords, leaving the custom state and EOT kernel unchanged,
completed without reset. This pins the immediate fault to the custom
no-inline MEDIA_OBJECT encoding on this setup. The Walker command remains
unsubmitted and unproven. The `--media-object` builder now emits the captured
14-dword packet template; that source change has only been dry/capture-only
validated, not submitted as the C harness. A fresh `CAP_ONLY` snapshot
compares byte-for-byte equal to the VAAPI packet.

## Tools and checks

- `eotdiff.py` compares the final assembled instruction against shipped Gen6
  kernel binaries.
- `capmedia.py` prints command dwords, relocation targets/domains, and the
  referenced CURBE/IDRT data; it follows nested batch starts when present.
- `snb-cap.c` now records object placement metadata and relocation domains.
- `CAP_ONLY=1` captures a would-be submission and cancels before GPU ioctl.
- `snb-replay.c` rejects old manifests that omit relocation domains, supports
  baseline replay, a BO transplant and prefix truncation, and detects GT
  resets that would otherwise look like successful idle waits.
- `g4b2bin.py` converts assembler output to raw little-endian kernel bytes.

The updated C tools compiled on lemox with `-Wall -Wextra`. The default
`snb-m21` dry run also completed and is saved in `m2-session3-dry.log`. The
custom command was captured without direct submission; the GPU received only
the explicit replay prefixes described above. The OWord dataport kernel and
Walker X-sweep remain unverified.
