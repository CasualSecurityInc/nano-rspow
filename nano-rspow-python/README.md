# nano-rspow-python

Native Nano (XNO) proof-of-work bindings for Python. The extension selects an available GPU backend when possible and otherwise uses the CPU backend. `generate_work` releases the Python GIL while it searches.

## Install

```bash
pip install nano-rspow-python
```

The package also installs a minimal streaming executable named
`nano-rspow-python`. It accepts no options except `--help` and uses the same
line protocol as `nano-rspow generate --stream`:

```text
<hash_hex>[:0x<threshold_hex>]
<hash_hex>:0x<threshold_hex>:<work_hex>
```

`nano-rspow` remains the full-featured CLI provided by the Rust
`nano-rspow-cli` crate; this Python package intentionally exposes only the
`nano-rspow-python` entrypoint.

## Usage

```python
import nano_rspow
from nano_rspow import WorkType
from nano_rspow.thresholds import current

root = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2"
result = nano_rspow.generate_work(root, WorkType.Send)

print(result.nonce_hex)
assert result.is_valid
assert nano_rspow.validate_work(root, result.nonce_hex, WorkType.Send)
assert current.SEND == 0xfffffff800000000

# Use an arbitrary threshold when a node requires more than the public floor.
threshold = "fffffff900000000"
result = nano_rspow.generate_work_with_threshold(root, threshold)
assert nano_rspow.validate_work_with_threshold(root, result.nonce_hex, threshold)
```

## API reference

### `generate_work(hash_hex, work_type) -> WorkResult`

Generates work for a 32-byte hexadecimal block root. Raises `ValueError` for invalid hexadecimal input or a root that is not 32 bytes. Raises `RuntimeError` if generation does not return a result.

### `validate_work(hash_hex, work_hex, work_type) -> bool`

Tests a hexadecimal nonce against a block root and the threshold selected by `work_type`. Raises `ValueError` for invalid input.

### `generate_work_with_threshold(hash_hex, threshold_hex) -> WorkResult`

Generates work for any hexadecimal threshold. Use it when a node requires a
stricter threshold than the public Nano floor or when handling historical data.

### `validate_work_with_threshold(hash_hex, work_hex, threshold_hex) -> bool`

Validates a nonce against any hexadecimal threshold.

### `compute_difficulty(hash_hex, nonce_hex) -> str`

Returns the raw difficulty as a 16-character lowercase hexadecimal string. Raises `ValueError` for invalid input.

### `backend_name() -> str`

Returns the selected backend name, such as `cpu`, `wgpu`, or `opencl`.

### `WorkType`

| Value | Use |
| --- | --- |
| `Send` | Current send and change blocks |
| `Receive` | Current receive, open, and epoch blocks |

### `WorkResult`

`generate_work` returns a read-only result with `nonce_hex`, `difficulty_hex`, `is_valid`, and `multiplier` properties.

### `thresholds`

The `nano_rspow.thresholds` submodule separates values by applicability:

- `thresholds.current.SEND` and `.RECEIVE` are the current public mainnet floors.
- `thresholds.legacy.EPOCH1` and `.BETA_EPOCH1` are historical values.
- `thresholds.testing.DEV` is for tests only.

Nano nodes may require a stricter arbitrary threshold. Use the explicit
custom-threshold APIs for that case. See Nano's
[Work Generation guide](https://docs.nano.org/integration-guides/work-generation/)
for current network requirements.
