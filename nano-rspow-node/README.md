# nano-rspow-node

Native Nano (XNO) Proof-of-Work for Node.js. Pre-compiled binaries for macOS (x64 + ARM), Linux (x64), and Windows (x64) — no Rust toolchain required.

## Install

```bash
npm install nano-rspow-node
```

## Usage

```typescript
import { generateWork, validateWork, WorkType } from 'nano-rspow-node';

const work = await generateWork(hash, WorkType.Send);
validateWork(hash, work, WorkType.Send); // → true
```

### Work types

| `WorkType`  | Use for                        |
|-------------|--------------------------------|
| `Send`      | Send and change blocks         |
| `Receive`   | Receive, open, and epoch blocks at the current epoch-2 threshold |
| `LegacyEpoch1` | Historical epoch-1 work only; not for current mainnet blocks |
| `Epoch1`    | Deprecated compatibility alias for `LegacyEpoch1` |

Current Nano mainnet uses `fffffff800000000` for send/change blocks and
`fffffe0000000000` for receive/open/epoch blocks. `LegacyEpoch1` maps to
`ffffffc000000000` and exists only for historical compatibility.

## See Also

- **[nano-rspow-web](https://www.npmjs.com/package/nano-rspow-web)**: WebGPU-accelerated browser WebAssembly PoW package.

## Source

Part of the [nano-rspow](https://github.com/CasualSecurityInc/nano-rspow) workspace.
