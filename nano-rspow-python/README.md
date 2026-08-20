# nano-rspow-python

Native Nano (XNO) proof-of-work bindings for Python. The extension selects an available GPU backend when possible and otherwise uses the CPU backend. `generate_work` releases the Python GIL while it searches.

## Install

```bash
pip install nano-rspow-python
```

## Usage

```python
import nano_rspow
from nano_rspow import WorkType

root = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2"
result = nano_rspow.generate_work(root, WorkType.Send)

print(result.nonce_hex)
assert result.is_valid
assert nano_rspow.validate_work(root, result.nonce_hex, WorkType.Send)
```

## API reference

### `generate_work(hash_hex, work_type) -> WorkResult`

Generates work for a 32-byte hexadecimal block root. Raises `ValueError` for invalid hexadecimal input or a root that is not 32 bytes. Raises `RuntimeError` if generation does not return a result.

### `validate_work(hash_hex, work_hex, work_type) -> bool`

Tests a hexadecimal nonce against a block root and the threshold selected by `work_type`. Raises `ValueError` for invalid input.

### `compute_difficulty(hash_hex, nonce_hex) -> str`

Returns the raw difficulty as a 16-character lowercase hexadecimal string. Raises `ValueError` for invalid input.

### `backend_name() -> str`

Returns the selected backend name, such as `cpu`, `wgpu`, or `opencl`.

### `WorkType`

| Value | Use |
| --- | --- |
| `Send` | Epoch 2 send and change blocks |
| `Receive` | Epoch 2 receive blocks |
| `LegacyEpoch1` | Historical epoch-1 validation only |
| `Epoch1` | Compatibility alias for `LegacyEpoch1` |

### `WorkResult`

`generate_work` returns a read-only result with `nonce_hex`, `difficulty_hex`, `is_valid`, and `multiplier` properties.

### `thresholds`

The `nano_rspow.thresholds` submodule provides `EPOCH2_SEND`, `EPOCH2_RECEIVE`, `LEGACY_EPOCH1`, `EPOCH1`, `BETA_LEGACY_EPOCH1`, `BETA_EPOCH1`, `DEV`, and `BASE`.
