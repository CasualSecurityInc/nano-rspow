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
// Blake2b G mixing function (inlined rotation constants)
// ──────────────────────────────────────────────────────────────────────────────

fn blake2b_G(v: ptr<function, array<vec2<u32>, 16>>, a: u32, b: u32, c: u32, d: u32, x: vec2<u32>, y: vec2<u32>) {
    (*v)[a] = u64_add(u64_add((*v)[a], (*v)[b]), x);
    (*v)[d] = rotr32(u64_xor((*v)[d], (*v)[a]));
    (*v)[c] = u64_add((*v)[c], (*v)[d]);
    (*v)[b] = rotr24(u64_xor((*v)[b], (*v)[c]));
    (*v)[a] = u64_add(u64_add((*v)[a], (*v)[b]), y);
    (*v)[d] = rotr16(u64_xor((*v)[d], (*v)[a]));
    (*v)[c] = u64_add((*v)[c], (*v)[d]);
    (*v)[b] = rotr63(u64_xor((*v)[b], (*v)[c]));
}

// ──────────────────────────────────────────────────────────────────────────────
// Blake2b-8 (output length 8 bytes) for a 40-byte input (nonce_le || hash)
// Rounds fully unrolled — no dynamic indexing into SIGMA.
// SIGMA schedule (12 rounds):
//   r0:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
//   r1: 14 10  4  8  9 15 13  6  1 12  0  2 11  7  5  3
//   r2: 11  8 12  0  5  2 15 13 10 14  3  6  7  1  9  4
//   r3:  7  9  3  1 13 12 11 14  2  6  5 10  4  0 15  8
//   r4:  9  0  5  7  2  4 10 15 14  1 11 12  6  8  3 13
//   r5:  2 12  6 10  0 11  8  3  4 13  7  5 15 14  1  9
//   r6: 12  5  1 15 14 13  4 10  0  7  6  3  9  2  8 11
//   r7: 13 11  7 14 12  1  3  9  5  0 15  4  8  6  2 10
//   r8:  6 15 14  9 11  3  0  8 12  2 13  7  1  4 10  5
//   r9: 10  2  8  4  7  6  1  5 15 11  9 14  3 12 13  0
//  r10:  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15  (= r0)
//  r11: 14 10  4  8  9 15 13  6  1 12  0  2 11  7  5  3  (= r1)
// ──────────────────────────────────────────────────────────────────────────────

fn blake2b_8(nonce_lo: u32, nonce_hi: u32, h0: vec4<u32>, h1: vec4<u32>) -> vec2<u32> {
    // Build the 16-word message block m[0..15].
    // Input layout: nonce(8 bytes) || hash(32 bytes) = 40 bytes, zero-padded to 128 bytes.
    var m: array<vec2<u32>, 16>;
    m[0]  = vec2<u32>(nonce_lo, nonce_hi);
    m[1]  = vec2<u32>(h0.x, h0.y);
    m[2]  = vec2<u32>(h0.z, h0.w);
    m[3]  = vec2<u32>(h1.x, h1.y);
    m[4]  = vec2<u32>(h1.z, h1.w);
    m[5]  = vec2<u32>(0u, 0u);
    m[6]  = vec2<u32>(0u, 0u);
    m[7]  = vec2<u32>(0u, 0u);
    m[8]  = vec2<u32>(0u, 0u);
    m[9]  = vec2<u32>(0u, 0u);
    m[10] = vec2<u32>(0u, 0u);
    m[11] = vec2<u32>(0u, 0u);
    m[12] = vec2<u32>(0u, 0u);
    m[13] = vec2<u32>(0u, 0u);
    m[14] = vec2<u32>(0u, 0u);
    m[15] = vec2<u32>(0u, 0u);

    // Initialize working vector v[0..15]
    var v: array<vec2<u32>, 16>;
    // h = IV with parameter block XOR for output length 8
    // Parameter block: digest_length=8, fanout=1, depth=1, rest=0 → 0x01010008
    v[0]  = u64_xor(IV0, vec2<u32>(0x01010008u, 0u));
    v[1]  = IV1;
    v[2]  = IV2;
    v[3]  = IV3;
    v[4]  = IV4;
    v[5]  = IV5;
    v[6]  = IV6;
    v[7]  = IV7;
    v[8]  = IV0;
    v[9]  = IV1;
    v[10] = IV2;
    v[11] = IV3;
    // v[12] = IV4 ^ counter (40 bytes input = 0x28)
    v[12] = u64_xor(IV4, vec2<u32>(40u, 0u));
    v[13] = IV5;
    // v[14] = IV6 ^ finalization flag (0xFFFFFFFFFFFFFFFF)
    v[14] = u64_xor(IV6, vec2<u32>(0xFFFFFFFFu, 0xFFFFFFFFu));
    v[15] = IV7;

    // Round 0: sigma = 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[0],  m[1]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[2],  m[3]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[4],  m[5]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[6],  m[7]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[8],  m[9]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[10], m[11]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[12], m[13]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[14], m[15]);

    // Round 1: sigma = 14 10 4 8 9 15 13 6 1 12 0 2 11 7 5 3
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[14], m[10]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[4],  m[8]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[9],  m[15]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[13], m[6]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[1],  m[12]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[0],  m[2]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[11], m[7]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[5],  m[3]);

    // Round 2: sigma = 11 8 12 0 5 2 15 13 10 14 3 6 7 1 9 4
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[11], m[8]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[12], m[0]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[5],  m[2]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[15], m[13]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[10], m[14]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[3],  m[6]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[7],  m[1]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[9],  m[4]);

    // Round 3: sigma = 7 9 3 1 13 12 11 14 2 6 5 10 4 0 15 8
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[7],  m[9]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[3],  m[1]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[13], m[12]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[11], m[14]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[2],  m[6]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[5],  m[10]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[4],  m[0]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[15], m[8]);

    // Round 4: sigma = 9 0 5 7 2 4 10 15 14 1 11 12 6 8 3 13
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[9],  m[0]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[5],  m[7]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[2],  m[4]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[10], m[15]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[14], m[1]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[11], m[12]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[6],  m[8]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[3],  m[13]);

    // Round 5: sigma = 2 12 6 10 0 11 8 3 4 13 7 5 15 14 1 9
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[2],  m[12]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[6],  m[10]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[0],  m[11]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[8],  m[3]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[4],  m[13]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[7],  m[5]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[15], m[14]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[1],  m[9]);

    // Round 6: sigma = 12 5 1 15 14 13 4 10 0 7 6 3 9 2 8 11
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[12], m[5]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[1],  m[15]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[14], m[13]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[4],  m[10]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[0],  m[7]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[6],  m[3]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[9],  m[2]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[8],  m[11]);

    // Round 7: sigma = 13 11 7 14 12 1 3 9 5 0 15 4 8 6 2 10
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[13], m[11]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[7],  m[14]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[12], m[1]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[3],  m[9]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[5],  m[0]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[15], m[4]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[8],  m[6]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[2],  m[10]);

    // Round 8: sigma = 6 15 14 9 11 3 0 8 12 2 13 7 1 4 10 5
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[6],  m[15]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[14], m[9]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[11], m[3]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[0],  m[8]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[12], m[2]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[13], m[7]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[1],  m[4]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[10], m[5]);

    // Round 9: sigma = 10 2 8 4 7 6 1 5 15 11 9 14 3 12 13 0
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[10], m[2]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[8],  m[4]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[7],  m[6]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[1],  m[5]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[15], m[11]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[9],  m[14]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[3],  m[12]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[13], m[0]);

    // Round 10: sigma = 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 (= round 0)
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[0],  m[1]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[2],  m[3]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[4],  m[5]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[6],  m[7]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[8],  m[9]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[10], m[11]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[12], m[13]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[14], m[15]);

    // Round 11: sigma = 14 10 4 8 9 15 13 6 1 12 0 2 11 7 5 3 (= round 1)
    blake2b_G(&v, 0u, 4u,  8u, 12u, m[14], m[10]);
    blake2b_G(&v, 1u, 5u,  9u, 13u, m[4],  m[8]);
    blake2b_G(&v, 2u, 6u, 10u, 14u, m[9],  m[15]);
    blake2b_G(&v, 3u, 7u, 11u, 15u, m[13], m[6]);
    blake2b_G(&v, 0u, 5u, 10u, 15u, m[1],  m[12]);
    blake2b_G(&v, 1u, 6u, 11u, 12u, m[0],  m[2]);
    blake2b_G(&v, 2u, 7u,  8u, 13u, m[11], m[7]);
    blake2b_G(&v, 3u, 4u,  9u, 14u, m[5],  m[3]);

    // Finalize: h[0] ^= v[0] ^ v[8]
    let hash_word_0 = u64_xor(u64_xor(v[0], v[8]), u64_xor(IV0, vec2<u32>(0x01010008u, 0u)));
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
