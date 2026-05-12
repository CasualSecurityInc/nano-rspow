// Blake2b PoW compute shader for Nano (XNO) work generation.
//
// Implements: difficulty = BLAKE2b_64(nonce_le || hash) >= threshold
//
// WGSL does not have native u64, so all 64-bit values are represented as
// vec2<u32> where x = low 32 bits, y = high 32 bits.
//
// Each invocation tests one nonce = base_nonce + global_invocation_id.x
//
// If a valid nonce is found, it is written to result[0] (low) and result[1] (high),
// and result[2] is set to 1u as a found flag.

// ──────────────────────────────────────────────────────────────────────────────
// Uniforms
// ──────────────────────────────────────────────────────────────────────────────

struct Uniforms {
    // hash as 2 x vec4<u32> (8 x u32 with 16-byte alignment for uniform)
    hash0: vec4<u32>,  // hash bytes 0-15 as 4 x u32 LE
    hash1: vec4<u32>,  // hash bytes 16-31 as 4 x u32 LE
    base_nonce_lo: u32,
    base_nonce_hi: u32,
    threshold_lo: u32,
    threshold_hi: u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read_write> result: array<u32, 3>;
// result[0] = nonce_lo, result[1] = nonce_hi, result[2] = found flag (0 or 1)

// ──────────────────────────────────────────────────────────────────────────────
// u64 arithmetic helpers (vec2<u32>: x=lo, y=hi)
// ──────────────────────────────────────────────────────────────────────────────

fn u64_add(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
    let lo = a.x + b.x;
    // carry = 1 if addition overflowed
    let carry = select(0u, 1u, lo < a.x);
    return vec2<u32>(lo, a.y + b.y + carry);
}

fn u64_xor(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
    return vec2<u32>(a.x ^ b.x, a.y ^ b.y);
}

// Right rotation of a 64-bit value by n bits (0 < n < 64)
fn u64_rotr(v: vec2<u32>, n: u32) -> vec2<u32> {
    if n == 32u {
        return vec2<u32>(v.y, v.x);
    }
    if n < 32u {
        let lo = (v.x >> n) | (v.y << (32u - n));
        let hi = (v.y >> n) | (v.x << (32u - n));
        return vec2<u32>(lo, hi);
    }
    // n > 32
    let m = n - 32u;
    let lo = (v.y >> m) | (v.x << (32u - m));
    let hi = (v.x >> m) | (v.y << (32u - m));
    return vec2<u32>(lo, hi);
}

// ──────────────────────────────────────────────────────────────────────────────
// Blake2b constants
// ──────────────────────────────────────────────────────────────────────────────

// Initialization vector (same as SHA-512 IV)
const IV: array<vec2<u32>, 8> = array<vec2<u32>, 8>(
    vec2<u32>(0xf3bcc908u, 0x6a09e667u),
    vec2<u32>(0x84caa73bu, 0xbb67ae85u),
    vec2<u32>(0xfe94f82bu, 0x3c6ef372u),
    vec2<u32>(0x5f1d36f1u, 0xa54ff53au),
    vec2<u32>(0xade682d1u, 0x510e527fu),
    vec2<u32>(0x2b3e6c1fu, 0x9b05688cu),
    vec2<u32>(0xfb41bd6bu, 0x1f83d9abu),
    vec2<u32>(0x137e2179u, 0x5be0cd19u),
);

// Sigma permutation table (12 rounds × 16 entries)
const SIGMA: array<array<u32, 16>, 12> = array<array<u32, 16>, 12>(
    array<u32, 16>(0u,  1u,  2u,  3u,  4u,  5u,  6u,  7u,  8u,  9u, 10u, 11u, 12u, 13u, 14u, 15u),
    array<u32, 16>(14u, 10u, 4u,  8u,  9u,  15u, 13u, 6u,  1u,  12u, 0u,  2u,  11u, 7u,  5u,  3u),
    array<u32, 16>(11u, 8u,  12u, 0u,  5u,  2u,  15u, 13u, 10u, 14u, 3u,  6u,  7u,  1u,  9u,  4u),
    array<u32, 16>(7u,  9u,  3u,  1u,  13u, 12u, 11u, 14u, 2u,  6u,  5u,  10u, 4u,  0u,  15u, 8u),
    array<u32, 16>(9u,  0u,  5u,  7u,  2u,  4u,  10u, 15u, 14u, 1u,  11u, 12u, 6u,  8u,  3u,  13u),
    array<u32, 16>(2u,  12u, 6u,  10u, 0u,  11u, 8u,  3u,  4u,  13u, 7u,  5u,  15u, 14u, 1u,  9u),
    array<u32, 16>(12u, 5u,  1u,  15u, 14u, 13u, 4u,  10u, 0u,  7u,  6u,  3u,  9u,  2u,  8u,  11u),
    array<u32, 16>(13u, 11u, 7u,  14u, 12u, 1u,  3u,  9u,  5u,  0u,  15u, 4u,  8u,  6u,  2u,  10u),
    array<u32, 16>(6u,  15u, 14u, 9u,  11u, 3u,  0u,  8u,  12u, 2u,  13u, 7u,  1u,  4u,  10u, 5u),
    array<u32, 16>(10u, 2u,  8u,  4u,  7u,  6u,  1u,  5u,  15u, 11u, 9u,  14u, 3u,  12u, 13u, 0u),
    array<u32, 16>(0u,  1u,  2u,  3u,  4u,  5u,  6u,  7u,  8u,  9u, 10u, 11u, 12u, 13u, 14u, 15u), // round 10 = round 0
    array<u32, 16>(14u, 10u, 4u,  8u,  9u,  15u, 13u, 6u,  1u,  12u, 0u,  2u,  11u, 7u,  5u,  3u), // round 11 = round 1
);

// ──────────────────────────────────────────────────────────────────────────────
// Blake2b G mixing function
// ──────────────────────────────────────────────────────────────────────────────

struct State8 {
    v: array<vec2<u32>, 16>,
}

fn blake2b_G(v: ptr<function, array<vec2<u32>, 16>>, a: u32, b: u32, c: u32, d: u32, x: vec2<u32>, y: vec2<u32>) {
    (*v)[a] = u64_add(u64_add((*v)[a], (*v)[b]), x);
    (*v)[d] = u64_rotr(u64_xor((*v)[d], (*v)[a]), 32u);
    (*v)[c] = u64_add((*v)[c], (*v)[d]);
    (*v)[b] = u64_rotr(u64_xor((*v)[b], (*v)[c]), 24u);
    (*v)[a] = u64_add(u64_add((*v)[a], (*v)[b]), y);
    (*v)[d] = u64_rotr(u64_xor((*v)[d], (*v)[a]), 16u);
    (*v)[c] = u64_add((*v)[c], (*v)[d]);
    (*v)[b] = u64_rotr(u64_xor((*v)[b], (*v)[c]), 63u);
}

// ──────────────────────────────────────────────────────────────────────────────
// Blake2b-8 (output length 8 bytes) for a 40-byte input (nonce_le || hash)
// ──────────────────────────────────────────────────────────────────────────────

fn blake2b_8(nonce_lo: u32, nonce_hi: u32, h0: vec4<u32>, h1: vec4<u32>) -> vec2<u32> {
    // Build the 16-word message block m[0..15].
    // Input layout: nonce(8 bytes) || hash(32 bytes) = 40 bytes, zero-padded to 128 bytes.
    var m: array<vec2<u32>, 16>;
    // nonce in little-endian bytes → first two u32 words
    m[0] = vec2<u32>(nonce_lo, nonce_hi);
    // hash as 8 x u32 LE (via two vec4)
    m[1] = vec2<u32>(h0.x, h0.y);
    m[2] = vec2<u32>(h0.z, h0.w);
    m[3] = vec2<u32>(h1.x, h1.y);
    m[4] = vec2<u32>(h1.z, h1.w);
    // m[5..15] = 0 (padding)
    for (var i = 5u; i < 16u; i++) {
        m[i] = vec2<u32>(0u, 0u);
    }

    // Initialize working vector v[0..15]
    var v: array<vec2<u32>, 16>;
    // h = IV with parameter block XOR for output length 8
    // Parameter block: digest_length=8, fanout=1, depth=1, rest=0
    // IV[0] ^= 0x01010008 (output_len=8, fanout=1, depth=1, leaf_length=0 → 0x01010008)
    v[0] = u64_xor(IV[0], vec2<u32>(0x01010008u, 0u));
    v[1] = IV[1];
    v[2] = IV[2];
    v[3] = IV[3];
    v[4] = IV[4];
    v[5] = IV[5];
    v[6] = IV[6];
    v[7] = IV[7];
    // v[8..11] = IV constants
    v[8]  = IV[0];
    v[9]  = IV[1];
    v[10] = IV[2];
    v[11] = IV[3];
    // v[12] = IV[4] ^ counter_lo (40 bytes input = 0x28)
    v[12] = u64_xor(IV[4], vec2<u32>(40u, 0u));
    // v[13] = IV[5] ^ counter_hi (0 for single block)
    v[13] = IV[5];
    // v[14] = IV[6] ^ finalization flag (0xFFFFFFFFFFFFFFFF = last block)
    v[14] = u64_xor(IV[6], vec2<u32>(0xFFFFFFFFu, 0xFFFFFFFFu));
    v[15] = IV[7];

    // 12 rounds of mixing
    for (var round = 0u; round < 12u; round++) {
        let s = SIGMA[round];
        blake2b_G(&v, 0u, 4u,  8u, 12u, m[s[0]],  m[s[1]]);
        blake2b_G(&v, 1u, 5u,  9u, 13u, m[s[2]],  m[s[3]]);
        blake2b_G(&v, 2u, 6u, 10u, 14u, m[s[4]],  m[s[5]]);
        blake2b_G(&v, 3u, 7u, 11u, 15u, m[s[6]],  m[s[7]]);
        blake2b_G(&v, 0u, 5u, 10u, 15u, m[s[8]],  m[s[9]]);
        blake2b_G(&v, 1u, 6u, 11u, 12u, m[s[10]], m[s[11]]);
        blake2b_G(&v, 2u, 7u,  8u, 13u, m[s[12]], m[s[13]]);
        blake2b_G(&v, 3u, 4u,  9u, 14u, m[s[14]], m[s[15]]);
    }

    // Finalize: h[0] ^= v[0] ^ v[8]
    // The output is only 8 bytes (first word of h), little-endian.
    let hash_word_0 = u64_xor(u64_xor(v[0], v[8]), u64_xor(IV[0], vec2<u32>(0x01010008u, 0u)));
    return hash_word_0; // lo = difficulty_lo, hi = difficulty_hi
}

// ──────────────────────────────────────────────────────────────────────────────
// u64 comparison: returns true if a >= b
// ──────────────────────────────────────────────────────────────────────────────

fn u64_gte(a: vec2<u32>, b: vec2<u32>) -> bool {
    return (a.y > b.y) || (a.y == b.y && a.x >= b.x);
}

// ──────────────────────────────────────────────────────────────────────────────
// Compute kernel — one invocation per nonce candidate
// ──────────────────────────────────────────────────────────────────────────────

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    // If already found, skip
    if result[2] != 0u { return; }

    // Compute nonce = base_nonce + gid.x
    let base = vec2<u32>(u.base_nonce_lo, u.base_nonce_hi);
    let nonce = u64_add(base, vec2<u32>(gid.x, 0u));

    let diff = blake2b_8(nonce.x, nonce.y, u.hash0, u.hash1);
    let threshold = vec2<u32>(u.threshold_lo, u.threshold_hi);

    if u64_gte(diff, threshold) {
        // Try to claim the result (first writer wins via flag check)
        if result[2] == 0u {
            result[0] = nonce.x;
            result[1] = nonce.y;
            result[2] = 1u;
        }
    }
}
