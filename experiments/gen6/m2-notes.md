# Route C M2 notes

## M2.0 reference pass

The M2.0 run was performed on `lemox.lan`; `m2refs.log` records its output. The VAAPI driver clone is `intel-vaapi-driver` commit `fd727a4`, and Beignet is `fc5f430`. The supplied Mesa `/-/raw/main/...` URLs returned 404, so no `gen6.xml` or Mesa compiler scratch references were fetched by that script. `intel-gen4asm` is already installed at `/usr/bin/intel-gen4asm` (supports `-g 6`).

The local PRM copy is `snb_ihd_os_vol2_part2.pdf`, Intel's May 2011 Sandy Bridge Media PRM. It explicitly documents the parameterized media walker and `MEDIA_OBJECT_WALKER` as `[DevSNB+]` (section 1.4.3 and 1.7.9). The PRM says this command dispatches one or more generic-mode threads. The walker command contains dwords 0–16 before optional inline data. The worker payload table says R0 is the thread header and CURBE constants are loaded into R1 onward when enabled. Sources: [PRM PDF mirror](https://kiwitree.net/~lina/intel-gfx-docs/prm/snb/snb_ihd_os_vol2_part2.pdf), [PRM index](https://kiwitree.net/~lina/intel-gfx-docs/prm/).

Useful implementation evidence in the VAAPI source:

- `src/i965_defines.h` defines `CMD_MEDIA_OBJECT_WALKER` as `CMD(2, 1, 3)`.
- `src/i965_gpe_utils.c` has the walker dword emission function, but it is named `gen8_gpe_media_object_walker`; treat its field packing as a cross-check, not a Gen6-tested recipe.
- `src/gen6_vme.c` demonstrates Gen6 VFE setup values (`max_num_threads = 60 - 1`, `num_urb_entries = 16`, `urb_entry_size = 59 - 1`, `curbe_allocation_size = 37 - 1`) and emits legacy `MEDIA_OBJECT` commands. It does not demonstrate a Gen6 walker dispatch.

## Batch corrections required before M2.1

1. The proposed `MEDIA_VFE_STATE` recipe has six dwords total. The SNB PRM specifies dword length 6 excluding DW0 and DW1, so it is eight dwords total (DW0–DW7).
2. The proposed `MEDIA_STATE_POINTERS` recipe has two dwords, while the VAAPI emission uses three: header plus two pointers.
3. The PRM defines the VFE scratch base pointer as a 1 KiB-aligned **offset relative to General State Base Address**. The proposed `@SCRATCH` relocation writes a separate BO address into this field. Either place scratch in the same BO and encode a relative offset, or define and verify a different valid base arrangement from the PRM; do not submit the separate-BO form as shown.
4. The provided batch fields and interface descriptor are still placeholders. `--force` should not be used to bypass them until every command's dword count, state base, and address interpretation is pinned.
5. `m21dump.asm` and `m21.batch` were not present in the checkout when M2.0 began. No M2.1 kernel was assembled or sent to the GPU in this pass.

## CLI kernel contract (checkout)

The OpenCL source is `nano-rspow/src/opencl_backend/pow.cl`. `pow_kernel` takes eight arguments: four `ulong` words for the 32-byte root, `ulong base_nonce`, `ulong threshold`, a global nonce-result pointer, and a global atomic found-flag pointer. It loads one nonce per work item (`base_nonce + global_id`), hashes `nonce_le64 || root` as a 40-byte BLAKE2b-8 input, compares the resulting `ulong` with `>= threshold`, and atomically claims the single result slot. The CLI feature is declared in `nano-rspow-cli/Cargo.toml` as `opencl = ["nano-rspow/opencl"]`; the `--backend opencl` branch is feature-gated in `nano-rspow-cli/src/main.rs` and falls back to CPU when the feature is absent or OpenCL initialization fails.

## Session 3 refresh and live capture

`m2-refs2.sh` ran on lemox. Mesa 23.3.6 raw URLs work; `gen6.xml`, `gen7.xml`, `gen_pack_header.py`, the generated `gen6_pack.h`, and `brw_eu_defines.h` are saved in this folder. The earlier M2.0 failure came from requesting the moving `main` path; the pinned tag fixed it.

The optional capture ran successfully. ffmpeg + `i965-va-driver` were installed because they were absent; apt reported 118 MB additional disk use. The synthetic H.264 VAAPI encode completed successfully. `vainfo` was absent, so its optional probe produced no output. The execbuf interceptor captured 45 submissions; 30 parsed as Gen6 media batches. Every such batch used `PIPELINE_SELECT`, a 10-dword `STATE_BASE_ADDRESS`, an 8-dword `MEDIA_VFE_STATE`, 4-dword CURBE and interface-descriptor loads, and (when work was dispatched) Gen6 `MEDIA_OBJECT`. No `MEDIA_OBJECT_WALKER` occurred at a command boundary. The sample `sub-002.tar` preserves one manifest and its BOs, and `cap-decode.log` records the decoded submissions.

The captured Gen6 VFE fields match the expected crib: scratch disabled; max threads 59; URB entries 16; URB entry allocation size 58; CURBE allocation size 36. The live sequence does not emit `MEDIA_STATE_POINTERS`; it loads CURBE and IDRT with their own commands. `STATE_BASE_ADDRESS` is present. VAAPI sets the General State Base Address with a relocation, sets the Surface State Base Address with a relocation, and uses modify-only zero bases for Dynamic, Indirect, and Instruction state. Its CURBE/IDRT loads point at separate BOs through relocations. For our single-BO layout, keep the PRM's relative-base rules explicit and make each selected base/offset pair agree.

This capture does not pin walker fields: VAAPI used `MEDIA_OBJECT`, as expected. It does make the Gen6 VFE, CURBE/ID load, SBA, and legacy object sequence empirical on this host. The M2.1 fixed-address write still needs the Gen6 dataport message/header and EOT encoding pinned from a Gen6 shader before first light.
