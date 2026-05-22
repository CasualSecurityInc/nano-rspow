import sys
import time
import nano_rspow
from nano_rspow import WorkType

def main():
    print("Testing Python roundtrip consuming nano-rspow-python from PyPI...")
    
    # Official known-good test vector hash
    hash_hex = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2"
    print(f"Hash: {hash_hex}")
    
    print("Active backend:", nano_rspow.backend_name())
    
    print("Generating proof of work for WorkType.Dev...")
    start = time.perf_counter()
    result = nano_rspow.generate_work(hash_hex, WorkType.Dev)
    duration_ms = (time.perf_counter() - start) * 1000
    
    print(f"[Dev] Generated: {result.nonce_hex} in {duration_ms:.2f}ms")
    
    is_valid = nano_rspow.validate_work(hash_hex, result.nonce_hex, WorkType.Dev)
    print(f"[Dev] Valid: {is_valid}")
    
    if not is_valid:
        print("Error: Generated work is invalid!")
        sys.exit(1)
        
    print("Success! Python roundtrip test passed!")

if __name__ == "__main__":
    main()
