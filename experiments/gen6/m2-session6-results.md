# Route C Session 6: M2.1 gates passed on lemox

All twelve hardware checks passed on `lemox.lan`, PCI `8086:0126`, kernel
`6.8.12-29-pve`. The i915 reset count was 7 before and after every submission.
The saved dmesg snapshots before and after the suite are byte-identical.
No hashing-throughput measurement was attempted.

## Saved Session 5 payloads: H3 is falsified

The original payloads were decoded before changing state or submitting work:

```text
payload-a0.bin: 64 dwords, 2 nonzero
  output DW2, byte 8:  0x000f0001 (captured packet DW8)
  output DW3, byte 12: 0x00300007 (captured packet DW9)
payload-a1.bin: 64 dwords, 4 nonzero
  output DW0, byte 0:  0xa722c924
  output DW1, byte 4:  0x21a95601
  output DW2, byte 8:  0x662909e4
  output DW3, byte 12: 0x9114485c
```

These are result-buffer offsets, not established GRF positions. A0's values
were not at bytes 40/44/56, and A1 was not all zero. The full output is in
`decode-session6.log`; the Session 5 findings remain unchanged in
`m2-session5-results.md`.

The captured interface descriptor explicitly has DW4 `0x00040000`. Mesa's
Gen6 XML independently places constant-URB read offset in DW4 bits 0..15 and
read length in bits 16..31. The custom descriptor's `0x00020000` was already
correct and was retained. The captured load commands are:

```text
MEDIA_CURBE_LOAD:                70010002 00000000 00000080 @CURBE
MEDIA_INTERFACE_DESCRIPTOR_LOAD: 70020002 00000000 00000400 @IDRT
Captured IDRT entry 0:
  DW0 @kernel (INSTRUCTION read domain)
  DW1 00000000
  DW2 00000000
  DW3 00000442
  DW4 00040000
  DW5 00000000
  DW6 00000000
  DW7 00000000
```

The custom harness retains its 64-byte CURBE load and 32-byte IDRT load,
with CURBE read length 2. The new exact payload checks prove that this
configuration delivers CURBE into r1/r2 and inline data into r3.

## Changes

- Pack surface width at DW2 bit 6, height at bit 19, pitch at DW3 bit 3,
  depth at bit 21. The formula matches all three captured VAAPI buffer
  surfaces (768, 524288 and 3648 logical bytes). The 768-byte surface
  corresponds to 8x6 macroblocks with 16 bytes per intra record.
- Set the second write's OWord address at header byte 8 (`r4.8`).
- Acquire CPU read/write domain before CPU initialization, and CPU read
  domain before result readback. Wait on the batch BO, including EOT-only
  and no-dispatch controls. Fail on changed/unavailable reset statistics.
- Initialize the full 4096-byte result BO to `0xcdcdcdcd`, save the entire
  BO, and compare all defined output words and remaining guard words.
  The C harness says COMPLETE; only the Python checker says PASS.
- For A1, write R0..R3 first, then four known marker GRFs at byte 128.
  This deliberately avoids making expected values depend on uninitialized
  incoming R4..R7. New write probes consume the write-commit response.
- Emit one captured-form 14-dword MEDIA_OBJECT per thread. A 32-byte slot
  write uses OWord control 2, not control 1 (the high half of one OWord).
- Load named probe binaries at runtime, keeping dry-run as the default.
  No Rust/Cargo compilation was required.

Surface packing, header addressing and domain handling were fixed together.
The successful checks do not isolate how much each contributed to the old
readback failure; they establish the corrected configuration.

## Hardware verdicts

| Case | Exact check | Result |
|---|---|---|
| No-dispatch control | Entire 4096-byte BO stays sentinel | PASS |
| EOT-only control | Entire BO stays sentinel | PASS |
| Pattern 16 | Four unique words; remaining BO untouched | PASS |
| Pattern 128 | 32 unique words; remaining BO untouched | PASS |
| Pattern 256 | 64 unique words via offsets 0 and 8 OWords | PASS |
| A0 | CURBE r1/r2, captured inline r3; trailing guard | PASS |
| A0 with magic | Eight FEED inline values at r3; CURBE and guard | PASS |
| A1 | First dump plus 32 marker words at byte 128; guard | PASS |
| Slots 4 | Four distinct indexed 32-byte records; guard | PASS |
| Slots 60 | Sixty distinct indexed records; guard | PASS |
| Lane | Eight values 0x101..0x108, plus CURBE and inline | PASS |
| Arithmetic | Eight u64 adds, carry, ROR24, ROR63, predication | PASS |

The checker records R0 headers and each slot's dispatch-header word without
inventing expected hardware scheduling values. All other output words and
all trailing guard words have exact expectations. Dispatch counts establish
multiple thread execution, not a measured simultaneous occupancy.

## Gen6 arithmetic and lane findings

Gen6 supports predication: the arithmetic probe executed a predicated MOV
with a different expected result for carry and non-carry lanes. The existing
VME sources also use predicated instructions. ADDC remains unavailable.
The tested five-instruction u64-add sequence uses:

```text
ADD low
CMP low-result < old-low into a vector mask
AND mask with 1 to get per-lane carry
ADD high operands
ADD carry to high
```

There is no SEL requirement or flags-to-scalar conversion. The probe also
checks low-word carry, full-u64 wraparound and rotations against independent
Python integer arithmetic. Its addition is out of place; an in-place emitter
must preserve the old low operand until the carry comparison completes.

The lane probe stages eight scalar immediates in one GRF and gathers with
`<4,4,1>`. It writes exactly `0x101` through `0x108`. There is no lane-uniform
hardware limitation here and no need to fetch eight initial nonces from
memory: the future kernel can keep a lane-offset vector and add a batch base.

ID DW1 was kept at the captured zero value. It is not a GRF-count field in
the supplied Gen6 descriptor layout. The arithmetic probe uses registers
through r35 successfully with this descriptor.

## Reproduction and artifacts

From the workstation, `bash build-m21-kernel.sh` preprocesses/assembles the
probe sources on lemox and converts their output to raw binary; it never
submits work. Source generation is `python3 make-m21-probes.py`.

On lemox, the harness was compiled with:

```sh
cc -O2 -Wall -Wextra -Werror $(pkg-config --cflags libdrm) -o snb-m21 snb-m21.c
bash m21-final2.sh
```

The build/run directory is `/tmp/nano-gen6-session6`. Copies of logs,
verdicts, full-BO payloads and dmesg snapshots are in `session6/` locally.
The runner stops at the first failed submission or comparison. Individual
cases can be selected, for example `bash m21-final2.sh arith`.

M2.1's write, CURBE, inline and multiple-thread gates are closed for this
configuration; the lane and arithmetic probes also pass. M3 still needs the
actual Blake2b kernel and comparison against CPU golden vectors. The current
4 KiB code-BO limit is appropriate for these probes and must be increased for
a large unrolled hash kernel. There is no measured MH/s figure yet.
