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
//
// Blake2b rounds are fully unrolled (no dynamic indexing into SIGMA) to ensure
// compatibility with Safari's Metal shader compiler.

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
@group(0) @binding(1) var<storage, read_write> result: array<atomic<u32>, 3>;
// result[0] = nonce_lo, result[1] = nonce_hi, result[2] = found flag (0 or 1)

// ──────────────────────────────────────────────────────────────────────────────
// u64 arithmetic helpers (vec2<u32>: x=lo, y=hi)
// ──────────────────────────────────────────────────────────────────────────────

fn u64_add(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
    let lo = a.x + b.x;
    let carry = select(0u, 1u, lo < a.x);
    return vec2<u32>(lo, a.y + b.y + carry);
}

fn u64_xor(a: vec2<u32>, b: vec2<u32>) -> vec2<u32> {
    return vec2<u32>(a.x ^ b.x, a.y ^ b.y);
}

// Right rotation of a 64-bit value by n bits (n must be a compile-time constant
// or small literal — no dynamic n to avoid Metal compiler issues)
fn rotr32(v: vec2<u32>) -> vec2<u32> {
    return vec2<u32>(v.y, v.x);
}
fn rotr24(v: vec2<u32>) -> vec2<u32> {
    return vec2<u32>((v.x >> 24u) | (v.y << 8u), (v.y >> 24u) | (v.x << 8u));
}
fn rotr16(v: vec2<u32>) -> vec2<u32> {
    return vec2<u32>((v.x >> 16u) | (v.y << 16u), (v.y >> 16u) | (v.x << 16u));
}
fn rotr63(v: vec2<u32>) -> vec2<u32> {
    // rotr63 = rotl1
    return vec2<u32>((v.x << 1u) | (v.y >> 31u), (v.y << 1u) | (v.x >> 31u));
}

// ──────────────────────────────────────────────────────────────────────────────
// Blake2b constants
// ──────────────────────────────────────────────────────────────────────────────

// Initialization vector (same as SHA-512 IV)
const IV0 = vec2<u32>(0xf3bcc908u, 0x6a09e667u);
const IV1 = vec2<u32>(0x84caa73bu, 0xbb67ae85u);
const IV2 = vec2<u32>(0xfe94f82bu, 0x3c6ef372u);
const IV3 = vec2<u32>(0x5f1d36f1u, 0xa54ff53au);
const IV4 = vec2<u32>(0xade682d1u, 0x510e527fu);
const IV5 = vec2<u32>(0x2b3e6c1fu, 0x9b05688cu);
const IV6 = vec2<u32>(0xfb41bd6bu, 0x1f83d9abu);
const IV7 = vec2<u32>(0x137e2179u, 0x5be0cd19u);

// ──────────────────────────────────────────────────────────────────────────────
// Blake2b-8 (output length 8 bytes) for a 40-byte input (nonce_le || hash)
// Fully optimized using 16 thread-local state registers and static zero propagation.
// ──────────────────────────────────────────────────────────────────────────────

fn blake2b_8(nonce_lo: u32, nonce_hi: u32, h0: vec4<u32>, h1: vec4<u32>) -> vec2<u32> {
    // Build individual message words.
    // Input layout: nonce(8 bytes) || hash(32 bytes) = 40 bytes, zero-padded to 128 bytes.
    let m0  = vec2<u32>(nonce_lo, nonce_hi);
    let m1  = vec2<u32>(h0.x, h0.y);
    let m2  = vec2<u32>(h0.z, h0.w);
    let m3  = vec2<u32>(h1.x, h1.y);
    let m4  = vec2<u32>(h1.z, h1.w);
    const ZERO = vec2<u32>(0u, 0u);

    // Initialize 16 individual state variables directly mapping to GPU registers.
    // h = IV with parameter block XOR for output length 8
    // Parameter block: digest_length=8, fanout=1, depth=1, rest=0 → 0x01010008
    var v0  = u64_xor(IV0, vec2<u32>(0x01010008u, 0u));
    var v1  = IV1;
    var v2  = IV2;
    var v3  = IV3;
    var v4  = IV4;
    var v5  = IV5;
    var v6  = IV6;
    var v7  = IV7;
    var v8  = IV0;
    var v9  = IV1;
    var v10 = IV2;
    var v11 = IV3;
    // v[12] = IV4 ^ counter (40 bytes input = 0x28)
    var v12 = u64_xor(IV4, vec2<u32>(40u, 0u));
    var v13 = IV5;
    // v[14] = IV6 ^ finalization flag (0xFFFFFFFFFFFFFFFF)
    var v14 = u64_xor(IV6, vec2<u32>(0xFFFFFFFFu, 0xFFFFFFFFu));
    var v15 = IV7;

    // Round 0
    v0 = u64_add(u64_add(v0, v4), m0);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(u64_add(v0, v4), m1);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(u64_add(v1, v5), m2);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(u64_add(v1, v5), m3);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(u64_add(v2, v6), m4);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(v2, v6);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(v3, v7);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(v0, v5);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(v1, v6);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(v2, v7);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(v3, v4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 1
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(v0, v4);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(u64_add(v1, v5), m4);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(v1, v5);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(v2, v6);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(v2, v6);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(v3, v7);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(u64_add(v0, v5), m1);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(u64_add(v1, v6), m0);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(u64_add(v1, v6), m2);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(v2, v7);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(u64_add(v3, v4), m3);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 2
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(v0, v4);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(v1, v5);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(u64_add(v1, v5), m0);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(v2, v6);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(u64_add(v2, v6), m2);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(v3, v7);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(v0, v5);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(u64_add(v1, v6), m3);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(v1, v6);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(u64_add(v2, v7), m1);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(u64_add(v3, v4), m4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 3
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(v0, v4);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(u64_add(v1, v5), m3);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(u64_add(v1, v5), m1);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(v2, v6);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(v2, v6);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(v3, v7);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(u64_add(v0, v5), m2);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(v1, v6);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(u64_add(v2, v7), m4);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(u64_add(v2, v7), m0);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(v3, v4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 4
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(u64_add(v0, v4), m0);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(v1, v5);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(v1, v5);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(u64_add(v2, v6), m2);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(u64_add(v2, v6), m4);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(v3, v7);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(v0, v5);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(u64_add(v0, v5), m1);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(v1, v6);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(v2, v7);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(u64_add(v3, v4), m3);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(v3, v4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 5
    v0 = u64_add(u64_add(v0, v4), m2);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(v0, v4);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(v1, v5);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(v1, v5);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(u64_add(v2, v6), m0);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(v2, v6);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(v3, v7);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(u64_add(v3, v7), m3);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(u64_add(v0, v5), m4);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(v1, v6);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(v2, v7);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(u64_add(v3, v4), m1);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(v3, v4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 6
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(v0, v4);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(u64_add(v1, v5), m1);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(v1, v5);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(v2, v6);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(v2, v6);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(u64_add(v3, v7), m4);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(u64_add(v0, v5), m0);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(u64_add(v1, v6), m3);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(u64_add(v2, v7), m2);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(v3, v4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 7
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(v0, v4);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(v1, v5);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(v1, v5);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(v2, v6);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(u64_add(v2, v6), m1);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(u64_add(v3, v7), m3);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(v0, v5);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(u64_add(v0, v5), m0);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(u64_add(v1, v6), m4);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(v2, v7);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(u64_add(v3, v4), m2);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(v3, v4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 8
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(v0, v4);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(v1, v5);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(v1, v5);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(v2, v6);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(u64_add(v2, v6), m3);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(u64_add(v3, v7), m0);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(v0, v5);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(u64_add(v0, v5), m2);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(v1, v6);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(u64_add(v2, v7), m1);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(u64_add(v2, v7), m4);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(v3, v4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 9
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(u64_add(v0, v4), m2);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(v1, v5);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(u64_add(v1, v5), m4);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(v2, v6);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(v2, v6);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(u64_add(v3, v7), m1);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(v0, v5);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(v1, v6);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(u64_add(v2, v7), m3);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(v2, v7);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(u64_add(v3, v4), m0);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 10
    v0 = u64_add(u64_add(v0, v4), m0);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(u64_add(v0, v4), m1);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(u64_add(v1, v5), m2);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(u64_add(v1, v5), m3);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(u64_add(v2, v6), m4);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(v2, v6);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(v3, v7);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(v0, v5);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(v1, v6);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(v1, v6);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(v2, v7);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(v3, v4);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));

    // Round 11
    v0 = u64_add(v0, v4);
    v12 = rotr32(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr24(u64_xor(v4, v8));
    v0 = u64_add(v0, v4);
    v12 = rotr16(u64_xor(v12, v0));
    v8 = u64_add(v8, v12);
    v4 = rotr63(u64_xor(v4, v8));
    v1 = u64_add(u64_add(v1, v5), m4);
    v13 = rotr32(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr24(u64_xor(v5, v9));
    v1 = u64_add(v1, v5);
    v13 = rotr16(u64_xor(v13, v1));
    v9 = u64_add(v9, v13);
    v5 = rotr63(u64_xor(v5, v9));
    v2 = u64_add(v2, v6);
    v14 = rotr32(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr24(u64_xor(v6, v10));
    v2 = u64_add(v2, v6);
    v14 = rotr16(u64_xor(v14, v2));
    v10 = u64_add(v10, v14);
    v6 = rotr63(u64_xor(v6, v10));
    v3 = u64_add(v3, v7);
    v15 = rotr32(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr24(u64_xor(v7, v11));
    v3 = u64_add(v3, v7);
    v15 = rotr16(u64_xor(v15, v3));
    v11 = u64_add(v11, v15);
    v7 = rotr63(u64_xor(v7, v11));
    v0 = u64_add(u64_add(v0, v5), m1);
    v15 = rotr32(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr24(u64_xor(v5, v10));
    v0 = u64_add(v0, v5);
    v15 = rotr16(u64_xor(v15, v0));
    v10 = u64_add(v10, v15);
    v5 = rotr63(u64_xor(v5, v10));
    v1 = u64_add(u64_add(v1, v6), m0);
    v12 = rotr32(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr24(u64_xor(v6, v11));
    v1 = u64_add(u64_add(v1, v6), m2);
    v12 = rotr16(u64_xor(v12, v1));
    v11 = u64_add(v11, v12);
    v6 = rotr63(u64_xor(v6, v11));
    v2 = u64_add(v2, v7);
    v13 = rotr32(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr24(u64_xor(v7, v8));
    v2 = u64_add(v2, v7);
    v13 = rotr16(u64_xor(v13, v2));
    v8 = u64_add(v8, v13);
    v7 = rotr63(u64_xor(v7, v8));
    v3 = u64_add(v3, v4);
    v14 = rotr32(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr24(u64_xor(v4, v9));
    v3 = u64_add(u64_add(v3, v4), m3);
    v14 = rotr16(u64_xor(v14, v3));
    v9 = u64_add(v9, v14);
    v4 = rotr63(u64_xor(v4, v9));


    // Finalize: h[0] ^= v[0] ^ v[8]
    let hash_word_0 = u64_xor(u64_xor(v0, v8), u64_xor(IV0, vec2<u32>(0x01010008u, 0u)));
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

@compute @workgroup_size(WGS_PLACEHOLDER)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    // If already found, skip
    if atomicLoad(&result[2]) != 0u { return; }

    // Compute nonce = base_nonce + gid.x
    let base = vec2<u32>(u.base_nonce_lo, u.base_nonce_hi);
    let nonce = u64_add(base, vec2<u32>(gid.x, 0u));

    let diff = blake2b_8(nonce.x, nonce.y, u.hash0, u.hash1);
    let threshold = vec2<u32>(u.threshold_lo, u.threshold_hi);

    if u64_gte(diff, threshold) {
        atomicStore(&result[0], nonce.x);
        atomicStore(&result[1], nonce.y);
        atomicStore(&result[2], 1u);
    }
}
