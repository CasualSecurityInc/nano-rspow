# nano-rspow-node

Native Nano (XNO) proof of work for Node.js. Pre-compiled binaries are available for macOS (x64 and ARM64), Linux (x64 and ARM64), and Windows (x64). A Rust toolchain is not required for those targets.

## Install

```bash
npm install nano-rspow-node
```

The package also installs a minimal streaming executable named
`nano-rspow-node`. It accepts no options except `--help` and uses the same
line protocol as `nano-rspow generate --stream`:

```text
<hash_hex>[:0x<threshold_hex>]
<hash_hex>:0x<threshold_hex>:<work_hex>
```

`nano-rspow` remains the full-featured CLI provided by the Rust
`nano-rspow-cli` crate; this Node package intentionally exposes only the
`nano-rspow-node` entrypoint.

If you are looking for the same functionality in the browser, see the [nano-rspow-web README](../nano-rspow-web/README.md).

## Usage

```typescript
import { generateWork, validateWork, WorkType } from 'nano-rspow-node';

const hash = '718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2';
const work = await generateWork(hash, WorkType.Send);
validateWork(hash, work, WorkType.Send); // → true
```

## API reference

### `generateWork(hashHex, workType): Promise<string>`

Generates a valid nonce for a 32-byte block root. `hashHex` accepts 64 hexadecimal characters, with an optional `0x` prefix. The promise resolves to a 16-character lowercase hexadecimal nonce.

### `validateWork(hashHex, workHex, workType): boolean`

Validates `workHex` against a 32-byte block root and the threshold selected by `workType`. Invalid hexadecimal input or a root with a length other than 32 bytes throws.

### `getBackendName(): string`

Initializes the shared generator if necessary and returns the selected backend name, such as `cpu`, `wgpu`, or `opencl`.

### `recommendLocalPow(): boolean`

Runs or reads a short local performance probe and returns whether local proof-of-work generation is recommended. The probe result is cached in the system temporary directory.

### `clearPowTuningCache(): boolean`

Deletes nano-rspow's temporary tuning cache. Returns `true` only when a cache directory existed and was deleted.

### `workTypeToHex(workType): WorkThreshold`

Returns the threshold selected by `workType` as a 16-character lowercase hexadecimal string.

### Work types

| `WorkType`  | Use for                        |
|-------------|--------------------------------|
| `Send`      | Send and change blocks         |
| `Receive`   | Receive, open, and epoch blocks at the current epoch-2 threshold |
| `LegacyEpoch1` | Historical epoch-1 work only; not for current mainnet blocks |
| `Epoch1`    | Deprecated compatibility alias for `LegacyEpoch1` |
| `Dev`       | Low-difficulty development-network work; do not use for mainnet blocks |

Current Nano mainnet uses `fffffff800000000` for send/change blocks and
`fffffe0000000000` for receive/open/epoch blocks. `LegacyEpoch1` maps to
`ffffffc000000000` and exists only for historical compatibility.

## See Also

- **[nano-rspow-web](https://www.npmjs.com/package/nano-rspow-web)**: WebGPU-accelerated browser WebAssembly PoW package.

## Source

Part of the [nano-rspow](https://github.com/CasualSecurityInc/nano-rspow) workspace.
