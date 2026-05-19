"""Tests for nano_rspow Python bindings.

Test vectors are sourced from the same data used in the Rust core library:
  - nano-rspow/src/difficulty.rs (vector_nano_work_server_readme, vector_rsnano_legacy_send_block)
  - nano-rspow/src/thresholds.rs (constant values)
"""

import nano_rspow
from nano_rspow import WorkType, WorkResult


# ---------------------------------------------------------------------------
# Known test vectors — cross-validated against Rust core, rsnano-node,
# nano-work-server, and the original C++ nano-node.
# ---------------------------------------------------------------------------

# Vector from nano-work-server README (difficulty.rs vector_nano_work_server_readme)
VECTOR_HASH = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2"
VECTOR_WORK = "2bf29ef00786a6bc"
VECTOR_DIFFICULTY = "ffffffd21c3933f4"

# Vector from rsnano-node validate_real_block test (difficulty.rs vector_rsnano_legacy_send_block)
RSNANO_HASH = "991CF190094C00F0B68E2E5F75F6BEE95A2E0BD93CEAA4A6734DB9F19B728948"
RSNANO_WORK = "3c82cc724905ee95"
RSNANO_DIFFICULTY_INT = 18446743921403126366

# Threshold constants from thresholds.rs
EPOCH2_SEND = 0xfffffff800000000
EPOCH2_RECEIVE = 0xFFFFFE0000000000
EPOCH1 = 0xFFFFFFc000000000
DEV = 0xFE00000000000000


class TestComputeDifficulty:
    """Tests for the low-level compute_difficulty function."""

    def test_nano_work_server_vector(self):
        """Vector 2 from difficulty.rs — nano-work-server README."""
        diff = nano_rspow.compute_difficulty(VECTOR_HASH, VECTOR_WORK)
        assert diff == VECTOR_DIFFICULTY, f"Expected {VECTOR_DIFFICULTY}, got {diff}"

    def test_rsnano_legacy_send_vector(self):
        """Vector 1 from difficulty.rs — rsnano-node validate_real_block."""
        diff = nano_rspow.compute_difficulty(RSNANO_HASH, RSNANO_WORK)
        diff_int = int(diff, 16)
        assert diff_int == RSNANO_DIFFICULTY_INT, (
            f"Expected {RSNANO_DIFFICULTY_INT:#018x}, got {diff_int:#018x}"
        )

    def test_deterministic(self):
        """Same inputs must always produce the same difficulty."""
        d1 = nano_rspow.compute_difficulty(VECTOR_HASH, VECTOR_WORK)
        d2 = nano_rspow.compute_difficulty(VECTOR_HASH, VECTOR_WORK)
        assert d1 == d2

    def test_invalid_hex_raises(self):
        """Non-hex input should raise ValueError."""
        try:
            nano_rspow.compute_difficulty("not_hex", "0000000000000000")
            assert False, "Expected ValueError"
        except ValueError:
            pass

    def test_wrong_length_raises(self):
        """Hash that is not 32 bytes should raise ValueError."""
        try:
            nano_rspow.compute_difficulty("aabb", "0000000000000000")
            assert False, "Expected ValueError"
        except ValueError:
            pass


class TestValidateWork:
    """Tests for the validate_work function."""

    def test_known_valid_epoch1(self):
        """Known-good work from nano-work-server must validate at Epoch1."""
        assert nano_rspow.validate_work(VECTOR_HASH, VECTOR_WORK, WorkType.Epoch1)

    def test_known_invalid(self):
        """Work = 0 should not meet any real threshold."""
        assert not nano_rspow.validate_work(
            VECTOR_HASH, "0000000000000000", WorkType.Epoch1
        )

    def test_invalid_hash_hex_raises(self):
        """Non-hex hash should raise ValueError."""
        try:
            nano_rspow.validate_work("zzzz", VECTOR_WORK, WorkType.Epoch1)
            assert False, "Expected ValueError"
        except ValueError:
            pass


class TestGenerateWork:
    """Tests for the generate_work function."""

    def test_generate_dev_roundtrip(self):
        """Generate work at DEV difficulty and round-trip validate."""
        zero_hash = "00" * 32
        result = nano_rspow.generate_work(zero_hash, WorkType.Dev)

        # Result should be a WorkResult instance
        assert isinstance(result, WorkResult)
        assert result.is_valid
        assert len(result.nonce_hex) == 16
        assert len(result.difficulty_hex) == 16
        assert result.multiplier >= 1.0

        # Round-trip validation
        assert nano_rspow.validate_work(zero_hash, result.nonce_hex, WorkType.Dev)

    def test_generate_epoch1_known_hash(self):
        """Generate work for a known hash at Epoch1 difficulty."""
        result = nano_rspow.generate_work(VECTOR_HASH, WorkType.Epoch1)
        assert result.is_valid
        assert nano_rspow.validate_work(VECTOR_HASH, result.nonce_hex, WorkType.Epoch1)

    def test_str_returns_nonce(self):
        """str(result) should return the nonce hex."""
        result = nano_rspow.generate_work("00" * 32, WorkType.Dev)
        assert str(result) == result.nonce_hex

    def test_repr_contains_info(self):
        """repr(result) should be informative."""
        result = nano_rspow.generate_work("00" * 32, WorkType.Dev)
        r = repr(result)
        assert "WorkResult" in r
        assert result.nonce_hex in r


class TestWorkType:
    """Tests for the WorkType enum."""

    def test_enum_values(self):
        """Enum integer values should be stable."""
        assert WorkType.Send == 0
        assert WorkType.Receive == 1
        assert WorkType.Epoch1 == 2
        assert WorkType.Dev == 3

    def test_equality(self):
        """Enum equality should work."""
        assert WorkType.Send == WorkType.Send
        assert WorkType.Send != WorkType.Receive


class TestThresholds:
    """Tests for the threshold constants submodule."""

    def test_epoch2_send(self):
        """EPOCH2_SEND must match the Rust constant."""
        assert nano_rspow.thresholds.EPOCH2_SEND == 0xfffffff800000000

    def test_epoch2_receive(self):
        assert nano_rspow.thresholds.EPOCH2_RECEIVE == 0xFFFFFE0000000000

    def test_epoch1(self):
        assert nano_rspow.thresholds.EPOCH1 == 0xFFFFFFc000000000

    def test_dev(self):
        assert nano_rspow.thresholds.DEV == 0xFE00000000000000

    def test_base_equals_epoch2_send(self):
        """BASE should equal EPOCH2_SEND (the hardest threshold)."""
        assert nano_rspow.thresholds.BASE == nano_rspow.thresholds.EPOCH2_SEND


class TestBackendName:
    """Tests for the backend_name function."""

    def test_returns_string(self):
        name = nano_rspow.backend_name()
        assert isinstance(name, str)
        assert name in ("hybrid-race", "cpu", "wgpu", "opencl")
