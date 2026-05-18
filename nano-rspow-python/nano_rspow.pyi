"""Type stubs for the nano_rspow native extension module.

GPU-accelerated Nano (XNO) Proof of Work — Python bindings.
"""

from enum import IntEnum

class WorkType(IntEnum):
    """Nano network work type — determines the difficulty threshold.

    Values:
        Send:    Epoch 2 send/change threshold (0xfffffff800000000)
        Receive: Epoch 2 receive threshold     (0xfffffe0000000000)
        Epoch1:  Legacy / open threshold        (0xffffffc000000000)
        Dev:     Development threshold          (0xfe00000000000000)
    """

    Send = 0
    Receive = 1
    Epoch1 = 2
    Dev = 3

class WorkResult:
    """The result of a PoW generation or validation.

    All fields are read-only properties.
    """

    @property
    def nonce_hex(self) -> str:
        """The work nonce as a 16-character lowercase hex string."""
        ...
    @property
    def difficulty_hex(self) -> str:
        """The achieved difficulty as a 16-character lowercase hex string."""
        ...
    @property
    def is_valid(self) -> bool:
        """Whether the achieved difficulty meets the required threshold."""
        ...
    @property
    def multiplier(self) -> float:
        """Difficulty multiplier relative to the required threshold."""
        ...

def generate_work(hash_hex: str, work_type: WorkType) -> WorkResult:
    """Generate valid Proof of Work for a Nano block hash.

    Uses the best available backend (GPU + CPU hybrid race).
    The GIL is released during computation, so other Python threads
    continue to run while the PoW search is in progress.

    Args:
        hash_hex: The 32-byte block root hash as a 64-char hex string.
        work_type: A WorkType enum value selecting the difficulty threshold.

    Returns:
        A WorkResult containing the valid nonce and achieved difficulty.

    Raises:
        ValueError: If the hash is not valid hex or not 32 bytes.
        RuntimeError: If work generation fails.
    """
    ...

def validate_work(hash_hex: str, work_hex: str, work_type: WorkType) -> bool:
    """Validate a work nonce against a hash and threshold.

    Args:
        hash_hex: The 32-byte block root hash as a 64-char hex string.
        work_hex: The work nonce as a hex string (up to 16 chars).
        work_type: A WorkType enum value selecting the difficulty threshold.

    Returns:
        True if the work meets the threshold, False otherwise.

    Raises:
        ValueError: If the hash or work value is not valid hex.
    """
    ...

def compute_difficulty(hash_hex: str, nonce_hex: str) -> str:
    """Compute the raw PoW difficulty for a hash+nonce pair.

    Args:
        hash_hex: The 32-byte block root hash as a 64-char hex string.
        nonce_hex: The work nonce as a hex string (up to 16 chars).

    Returns:
        The difficulty as a 16-character lowercase hex string.

    Raises:
        ValueError: If inputs are not valid hex.
    """
    ...

def backend_name() -> str:
    """Return the name of the active compute backend.

    Returns one of: "hybrid-race", "cpu", "wgpu", "opencl".
    """
    ...

class thresholds:
    """Nano PoW threshold constants for all network epochs.

    Constants are sourced from the Rust core library and match
    the values used by rsnano-node and the C++ nano-node.
    """

    EPOCH2_SEND: int
    """Epoch 2 send/change threshold (current live network default for sends)."""

    EPOCH2_RECEIVE: int
    """Epoch 2 receive threshold."""

    EPOCH1: int
    """Epoch 1 threshold (legacy / open blocks)."""

    BETA_EPOCH1: int
    """Beta network epoch 1 threshold."""

    DEV: int
    """Dev network threshold (very low, for testing)."""

    BASE: int
    """The highest threshold — used as the base for multiplier calculations."""
