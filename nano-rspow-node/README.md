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

```bash
npx nano-rspow <hash> --type send
```

## Source

Part of the [nano-rspow](https://github.com/CasualSecurityInc/nano-rspow) workspace.
