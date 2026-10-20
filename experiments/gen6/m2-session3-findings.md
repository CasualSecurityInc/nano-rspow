# Route C M2.1: Session 3 pinned values

The reference run and capture were performed on `lemox.lan` (8086:0126, Gen6
GT2). The capture is from the stock i965 VAAPI media encode path. It proves
the Gen6 command sequence and its state values on this host; it contains no
`MEDIA_OBJECT_WALKER` command, so walker field positions below come from the
Sandy Bridge PRM and `gen6.xml`.

## Captured Gen6 command sequence

`cap-decode.log` originally omitted the three `PIPE_CONTROL`s at the head of
each batch. The decoder now recognizes the 4-dword packet. A representative
batch is:

| Packet | Captured values | Provenance |
|---|---|---|
| `PIPE_CONTROL` | `7a000002 00100002 00000000 00000000` | VAAPI capture; CS stall and pixel-scoreboard stall |
| `PIPE_CONTROL` | `7a000002 00004000 00007000 00000000` | VAAPI capture; not copied because its post-sync address is capture-specific |
| `PIPE_CONTROL` | `7a000002 00001400 00000000 00000000` | VAAPI capture |
| `PIPELINE_SELECT` | `69040001` | VAAPI capture; media pipeline |
| `STATE_BASE_ADDRESS` | `61010008`, 10 dwords | VAAPI capture and `gen6_gpe_state_base_address` |
| `MEDIA_VFE_STATE` | `70000006`, 8 dwords | VAAPI capture and Gen6 emitter |
| `MEDIA_CURBE_LOAD` | `70010002`, 4 dwords | VAAPI capture and Gen6 emitter |
| `MEDIA_INTERFACE_DESCRIPTOR_LOAD` | `70020002`, 4 dwords | VAAPI capture and Gen6 emitter |
| `MEDIA_OBJECT` | `7100000c`, 14 dwords | VAAPI capture; issued when work is present |

Thirty captured media batches share that sequence. There was no
`MEDIA_STATE_POINTERS` packet in the observed Gen6 path. Experimental probe
batches were submitted during bring-up; every media submission hung the GT.
The current harness defaults to dry-run and does not imply M2.1 success.

All three captured `PIPE_CONTROL`s are reproduced in the current probe. The
middle packet's address is a relocation to a dedicated sync BO, not the
capture-specific address (`0x7000`). The refreshed capture records this
relocation as `INSTRUCTION` read and `INSTRUCTION` write; the probe uses those
captured domains.

## Packed state for the first-light probe

The low-level values below are used by `snb-m21.c`. `@STATE+n` means a GEM
relocation to the state BO with byte delta `n`; `@RESULTS` means a relocation
to the result BO. The state layout keeps the bases simple: Surface State Base
Address points to the state BO; Dynamic and Instruction bases stay at zero,
so CURBE, IDRT, and kernel pointers use absolute GEM relocations exactly as the
captured VAAPI path does.

| Dwords / field | Packed value | Why it is pinned |
|---|---:|---|
| `PIPE_CONTROL` #1 | `7a000002 00100002 00000000 00000000` | Captured Gen6 CS/scoreboard stall |
| `PIPE_CONTROL` #2 | `7a000002 00004000 @SYNC 00000000` | Captured qword write workaround; relocation to a dedicated 4 KiB sync BO, instruction read/write domains |
| `PIPE_CONTROL` #3 | `7a000002 00001400 00000000 00000000` | Captured WC/TC flush and no-write flags |
| `PIPELINE_SELECT` | `69040001` | Captured media selection |
| SBA DW0 | `61010008` | Captured command header, 10 dwords |
| SBA DW1 | `00000001` | General base modify, base zero; scratch is disabled |
| SBA DW2 | `@STATE+1` | Surface base relocation plus modify-enable bit; captured VAAPI uses this base |
| SBA DW3–DW9 | `00000001` each | Captured modify-only zero Dynamic/Indirect/Instruction bases and access bounds |
| VFE DW0 | `70000006` | Captured 8-dword Gen6 packet |
| VFE DW1 | `00000000` | Scratch pointer and size disabled |
| VFE DW2 | `003b1000` | 59 threads, 16 URB entries |
| VFE DW3 | `00000000` | Debug object ID |
| VFE DW4 | `003a0024` | URB entry size 58; CURBE allocation 36 |
| VFE DW5–DW7 | `00000000` | Captured scoreboard disabled |
| CURBE DW0–DW3 | `70010002 00000000 00000040 @STATE+0` | Captured packet shape; 64-byte CURBE load from dynamic-base-zero address |
| ID load DW0–DW3 | `70020002 00000000 00000020 @STATE+0x80` | Captured packet shape; 32-byte minimum descriptor load |
| ID DW0 | `@STATE+0x200` | Absolute kernel pointer, 64-byte aligned; relocation matches VAAPI's `desc0` relocation |
| ID DW1–DW2 | `00000000 00000000` | No exceptions, SPF off, no sampler |
| ID DW3 | `00000101` | Binding table at state+0x100 and one entry (BTI 0) |
| ID DW4 | `00020000` | Constant URB offset 0; read length 2 × 8 dwords = 64 bytes |
| ID DW5–DW7 | `00000000` | No Gen6 barrier or extension fields |
| Binding table entry 0 | `00000140` | Surface-state offset from Surface State Base Address |
| Surface DW0 | `80000100` | Buffer surface, render-cache read/write mode |
| Surface DW1 | `@RESULTS` | Results BO base relocation, render read/write domain |
| Surface DW2 | `0000000f` | Gen6 buffer width field is low 7 bits: 16 entries minus one |
| Surface DW3 | `00000078` | 16-byte pitch minus one, per VAAPI buffer-surface setup |
| Surface DW4–DW7 | `00000000` | Reserved/padding; 32-byte-aligned surface state |
| Walker DW0 | `7103000f` | PRM opcode and length for 17 dwords, no inline data |
| Walker DW1–DW6 | `0` | Descriptor 0; no indirect data, children, scoreboard, or color options |
| Walker DW7 | `03ff03ff` | Local/global loop limits set to valid maximum; VAAPI packer cross-check |
| Walker DW8 | `00010001` | Local block resolution 1×1 |
| Walker DW9–DW10 | `0` | Local start/end 0,0 |
| Walker DW11 | `00010000` | Local outer stride Y=1 |
| Walker DW12 | `00000001` | Local inner unit X=1 |
| Walker DW13 | `00010001` | Global resolution 1×1 |
| Walker DW14 | `x & 0x1ff` | Global start X, direct PRM field; varied by the host |
| Walker DW15 | `00000001` | Global outer stride X=1 |
| Walker DW16 | `00010000` | Global inner unit Y=1 |

The VFE/CURBE/ID values are also represented in the captured batch binaries.
The walker DW layout is independently in `gen6.xml` and PRM §1.7.9. The
single-thread 1×1 loop shape follows those fields and is cross-checked against
the VAAPI walker packer; VAAPI's Gen8 packer is not treated as proof of Gen6
support.

## Kernel message layout

`m21dump.asm` builds the OWord Block Write header as the Gen6 VME sources do:
zero header, copy the fixed-function dispatch ID from R0.5 into M0.5, and use
global offset zero in M0.2. It copies R0–R3 to M1–M4 and sends an eight-OWord
write to BTI 0. The Sandy Bridge shared-functions PRM says an OWord block write
supports a buffer surface, requires render-cache read/write mode, uses M0.2
as an OWord offset, and carries 1/2/4 data registers for 1/2/4/8 OWords.
The data-port descriptor emitted by the installed assembler is
`0x0a1b0400`; the EOT instruction matches the VME Gen6 binary (`0x82000010`).

The kernel assembled successfully to 160 bytes (10 Gen6 instructions).
`snb-m21.c` defaults to dry-run; hardware execution requires explicit
`--submit`. It submits one walker thread only, so all eight SIMD lanes are a
single thread's payload and no threads race on the fixed output address. The
multi-thread same-address sweep from the draft is intentionally omitted; it
would race writes and cannot reliably prove the final X coordinate.

## First-light attempts and correction

The initial probe and isolation probes hung the GT. The minimal EOT kernel
also hung with both Walker and captured-style `MEDIA_OBJECT`, so the dataport
message is not required to trigger the failure. M1's raw MI smoke test passed
after resets. The first probe versions had two confirmed framing omissions:
Gen6 `PIPE_CONTROL` is four dwords, and the VAAPI preamble has three packets.
The current harness includes all three, with a separate 4 KiB sync BO and the
captured relocation domains. Offline comparison also found and fixed the
results surface width field, which had been placed in the height bits.

These corrections do not explain the EOT-only hang. No further media
submission has been made after identifying the surface packing error; a
successful M2.1 result is still outstanding. Keep submissions gated until the
remaining setup is compared against VAAPI's IDRT and surface-state bytes or a
minimal captured-equivalent dispatch is demonstrated. The hang/reset logs
remain evidence of failed attempts, not a successful first-light result.
