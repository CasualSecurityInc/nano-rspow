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
| `Receive`   | Open and receive blocks        |
| `Epoch1`    | Epoch upgrade blocks           |
| `Dev`       | Low-threshold development/test |

## CLI

You can run the high-performance native CLI directly through the Node package.

### Zero-Install (Run instantly via npm)
Use `npx -p nano-rspow-node nano-rspow` to run the executable without installing it:
```bash
npx -p nano-rspow-node nano-rspow --help
```

### When Installed Locally
If installed inside a project:
```bash
npx nano-rspow --help
```

### When Installed Globally
If installed globally (`npm install -g nano-rspow-node`):
```bash
nano-rspow --help
```

## See Also

- **[nano-rspow-web](https://www.npmjs.com/package/nano-rspow-web)**: WebGPU-accelerated browser WebAssembly PoW package.

## Source

Part of the [nano-rspow](https://github.com/CasualSecurityInc/nano-rspow) workspace.
