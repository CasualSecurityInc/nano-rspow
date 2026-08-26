"""Type stubs for the nano_rspow native extension module.

GPU-accelerated Nano (XNO) Proof of Work — Python bindings.
"""

from enum import IntEnum

class WorkType(IntEnum):
    """Nano network work type — determines the difficulty threshold.

    Values:
        Send:    Current send/change threshold (0xfffffff800000000)
        Receive: Current receive/open/epoch threshold (0xfffffe0000000000)
    """

    Send = 0
    Receive = 1

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

    Uses the selected CPU or GPU backend.
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

def generate_work_with_threshold(hash_hex: str, threshold_hex: str) -> WorkResult:
    """Generate valid Proof of Work for an arbitrary hexadecimal threshold."""
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

def validate_work_with_threshold(hash_hex: str, work_hex: str, threshold_hex: str) -> bool:
    """Validate a nonce against an arbitrary hexadecimal threshold."""
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

    Returns one of: "cpu", "wgpu", "opencl".
    """
    ...

def cli_main() -> int:
    """Run the minimal line-buffered nano-rspow-python CLI."""
    ...

class thresholds:
    """Grouped threshold presets from the Rust core library."""

    class current:
        """Current Nano mainnet threshold presets."""
        SEND: int
        RECEIVE: int

    class legacy:
        """Historical Epoch 1 threshold presets."""
        EPOCH1: int
        BETA_EPOCH1: int

    class testing:
        """Test-only threshold presets."""
        DEV: int
