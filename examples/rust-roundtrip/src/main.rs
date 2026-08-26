use nano_rspow::{WorkGenerator, thresholds};

fn main() {
    println!("Testing Rust roundtrip consuming nano-rspow from Crates.io...");

    let hash_hex = "718CC2121C3E641059BC1C2CFC45666C99E8AE922F7A807B7D07B62C995D79E2";
    // We can decode hex manually to avoid extra dependencies if desired,
    // but hex is extremely common and probably in cargo cache already.
    // Let's decode manually to make the example fully robust without external helper crates.
    let hash = decode_hex(hash_hex).expect("Failed to decode test vector hash");

    let generator = WorkGenerator::cpu();
    println!("Active backend: {}", generator.backend_name());

    let start = std::time::Instant::now();
    let result = generator.generate(&hash, thresholds::testing::DEV).expect("Failed to generate work");
    let duration = start.elapsed();

    println!("Generated nonce: {} in {:?}", result.nonce_hex(), duration);
    println!("Is valid: {}", result.is_valid());
    
    assert!(result.is_valid(), "Generated work must be valid!");
    println!("Success! Rust roundtrip test passed!");
}

fn decode_hex(s: &str) -> Result<[u8; 32], &'static str> {
    if s.len() != 64 {
        return Err("Hash must be exactly 64 hex characters");
    }
    let mut bytes = [0u8; 32];
    for i in 0..32 {
        let byte_str = &s[i * 2..i * 2 + 2];
        bytes[i] = u8::from_str_radix(byte_str, 16).map_err(|_| "Invalid hex character")?;
    }
    Ok(bytes)
}
