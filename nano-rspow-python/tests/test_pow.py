"""Tests for nano_rspow Python bindings.

Test vectors are sourced from the same data used in the Rust core library:
  - nano-rspow/src/difficulty.rs (vector_nano_work_server_readme, vector_rsnano_legacy_send_block)
  - nano-rspow/src/thresholds.rs (constant values)
"""

import nano_rspow
from nano_rspow import WorkType, WorkResult
from nano_rspow.thresholds import current, legacy, testing


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
CURRENT_SEND = 0xfffffff800000000
CURRENT_RECEIVE = 0xFFFFFE0000000000
LEGACY_EPOCH1 = 0xFFFFFFc000000000
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

    def test_known_valid_legacy_epoch1(self):
        """Known-good work from nano-work-server validates at legacy epoch-1 difficulty."""
        assert nano_rspow.validate_work_with_threshold(
            VECTOR_HASH, VECTOR_WORK, f"{LEGACY_EPOCH1:016x}"
        )

    def test_known_invalid(self):
        """Work = 0 should not meet any real threshold."""
        assert not nano_rspow.validate_work_with_threshold(
            VECTOR_HASH, "0000000000000000", f"{LEGACY_EPOCH1:016x}"
        )

    def test_invalid_hash_hex_raises(self):
        """Non-hex hash should raise ValueError."""
        try:
            nano_rspow.validate_work_with_threshold(
                "zzzz", VECTOR_WORK, f"{LEGACY_EPOCH1:016x}"
            )
            assert False, "Expected ValueError"
        except ValueError:
            pass


class TestGenerateWork:
    """Tests for the generate_work function."""

    def test_generate_receive_roundtrip(self):
        """Generate work at Receive difficulty and round-trip validate."""
        zero_hash = "00" * 32
        result = nano_rspow.generate_work(zero_hash, WorkType.Receive)

        # Result should be a WorkResult instance
        assert isinstance(result, WorkResult)
        assert result.is_valid
        assert len(result.nonce_hex) == 16
        assert len(result.difficulty_hex) == 16
        assert result.multiplier >= 1.0

        # Round-trip validation
        assert nano_rspow.validate_work(zero_hash, result.nonce_hex, WorkType.Receive)

    def test_generate_custom_threshold_roundtrip(self):
        """Generate and validate work at a caller-supplied historical threshold."""
        threshold = f"{LEGACY_EPOCH1:016x}"
        result = nano_rspow.generate_work_with_threshold(VECTOR_HASH, threshold)
        assert result.is_valid
        assert nano_rspow.validate_work_with_threshold(VECTOR_HASH, result.nonce_hex, threshold)

    def test_str_returns_nonce(self):
        """str(result) should return the nonce hex."""
        result = nano_rspow.generate_work("00" * 32, WorkType.Receive)
        assert str(result) == result.nonce_hex

    def test_repr_contains_info(self):
        """repr(result) should be informative."""
        result = nano_rspow.generate_work("00" * 32, WorkType.Receive)
        r = repr(result)
        assert "WorkResult" in r
        assert result.nonce_hex in r


class TestWorkType:
    """Tests for the WorkType enum."""

    def test_enum_values(self):
        """Enum integer values should be stable."""
        assert WorkType.Send == 0
        assert WorkType.Receive == 1
        assert not hasattr(WorkType, "LegacyEpoch1")
        assert not hasattr(WorkType, "Dev")

    def test_equality(self):
        """Enum equality should work."""
        assert WorkType.Send == WorkType.Send
        assert WorkType.Send != WorkType.Receive


class TestThresholds:
    """Tests for the threshold constants submodule."""

    def test_current_send(self):
        assert nano_rspow.thresholds.current.SEND == CURRENT_SEND
        assert current.SEND == CURRENT_SEND
        assert not hasattr(nano_rspow.thresholds, "LEGACY_EPOCH1")

    def test_current_receive(self):
        assert nano_rspow.thresholds.current.RECEIVE == CURRENT_RECEIVE

    def test_legacy_epoch1(self):
        assert nano_rspow.thresholds.legacy.EPOCH1 == LEGACY_EPOCH1
        assert legacy.EPOCH1 == LEGACY_EPOCH1

    def test_dev(self):
        assert nano_rspow.thresholds.testing.DEV == DEV
        assert testing.DEV == DEV


class TestBackendName:
    """Tests for the backend_name function."""

    def test_returns_string(self):
        name = nano_rspow.backend_name()
        assert isinstance(name, str)
        assert name in ("cpu", "wgpu", "opencl")
