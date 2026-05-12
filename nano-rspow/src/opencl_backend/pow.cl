// OpenCL Blake2b PoW compute shader for Nano (XNO) work generation.

// ulong right rotation
inline ulong rotr64(ulong x, uint n) {
    return (x >> n) | (x << (64 - n));
}

// Blake2b Initialization Vector
__constant ulong IV[8] = {
    0x6a09e667f3bcc908UL, 0xbb67ae8584caa73bUL,
    0x3c6ef372fe94f82bUL, 0xa54ff53a5f1d36f1UL,
    0x510e527fade682d1UL, 0x9b05688c2b3e6c1fUL,
    0x1f83d9abfb41bd6bUL, 0x5be0cd19137e2179UL
};

// Sigma permutation table
__constant uchar SIGMA[12][16] = {
    {  0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15 },
    { 14, 10,  4,  8,  9, 15, 13,  6,  1, 12,  0,  2, 11,  7,  5,  3 },
    { 11,  8, 12,  0,  5,  2, 15, 13, 10, 14,  3,  6,  7,  1,  9,  4 },
    {  7,  9,  3,  1, 13, 12, 11, 14,  2,  6,  5, 10,  4,  0, 15,  8 },
    {  9,  0,  5,  7,  2,  4, 10, 15, 14,  1, 11, 12,  6,  8,  3, 13 },
    {  2, 12,  6, 10,  0, 11,  8,  3,  4, 13,  7,  5, 15, 14,  1,  9 },
    { 12,  5,  1, 15, 14, 13,  4, 10,  0,  7,  6,  3,  9,  2,  8, 11 },
    { 13, 11,  7, 14, 12,  1,  3,  9,  5,  0, 15,  4,  8,  6,  2, 10 },
    {  6, 15, 14,  9, 11,  3,  0,  8, 12,  2, 13,  7,  1,  4, 10,  5 },
    { 10,  2,  8,  4,  7,  6,  1,  5, 15, 11,  9, 14,  3, 12, 13,  0 },
    {  0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15 },
    { 14, 10,  4,  8,  9, 15, 13,  6,  1, 12,  0,  2, 11,  7,  5,  3 }
};

#define G(a, b, c, d, x, y) \
    v[a] = v[a] + v[b] + x; \
    v[d] = rotr64(v[d] ^ v[a], 32); \
    v[c] = v[c] + v[d]; \
    v[b] = rotr64(v[b] ^ v[c], 24); \
    v[a] = v[a] + v[b] + y; \
    v[d] = rotr64(v[d] ^ v[a], 16); \
    v[c] = v[c] + v[d]; \
    v[b] = rotr64(v[b] ^ v[c], 63);

ulong blake2b_8(ulong nonce, ulong h0, ulong h1, ulong h2, ulong h3) {
    ulong m[16];
    m[0] = nonce;
    m[1] = h0;
    m[2] = h1;
    m[3] = h2;
    m[4] = h3;
    for (int i = 5; i < 16; i++) {
        m[i] = 0;
    }

    ulong v[16];
    v[0] = IV[0] ^ 0x01010008UL;
    v[1] = IV[1];
    v[2] = IV[2];
    v[3] = IV[3];
    v[4] = IV[4];
    v[5] = IV[5];
    v[6] = IV[6];
    v[7] = IV[7];
    v[8] = IV[0];
    v[9] = IV[1];
    v[10] = IV[2];
    v[11] = IV[3];
    v[12] = IV[4] ^ 40UL;
    v[13] = IV[5];
    v[14] = IV[6] ^ 0xFFFFFFFFFFFFFFFFUL;
    v[15] = IV[7];

    for (int round = 0; round < 12; round++) {
        G(0, 4, 8, 12, m[SIGMA[round][0]], m[SIGMA[round][1]]);
        G(1, 5, 9, 13, m[SIGMA[round][2]], m[SIGMA[round][3]]);
        G(2, 6, 10, 14, m[SIGMA[round][4]], m[SIGMA[round][5]]);
        G(3, 7, 11, 15, m[SIGMA[round][6]], m[SIGMA[round][7]]);
        G(0, 5, 10, 15, m[SIGMA[round][8]], m[SIGMA[round][9]]);
        G(1, 6, 11, 12, m[SIGMA[round][10]], m[SIGMA[round][11]]);
        G(2, 7, 8, 13, m[SIGMA[round][12]], m[SIGMA[round][13]]);
        G(3, 4, 9, 14, m[SIGMA[round][14]], m[SIGMA[round][15]]);
    }

    return v[0] ^ v[8] ^ IV[0] ^ 0x01010008UL;
}

__kernel void pow_kernel(
    ulong hash0,
    ulong hash1,
    ulong hash2,
    ulong hash3,
    ulong base_nonce,
    ulong threshold,
    __global ulong* result_nonce,
    __global volatile uint* result_found
) {
    uint gid = get_global_id(0);
    if (*result_found) {
        return;
    }

    ulong nonce = base_nonce + gid;
    ulong diff = blake2b_8(nonce, hash0, hash1, hash2, hash3);

    if (diff >= threshold) {
        if (atomic_cmpxchg(result_found, 0, 1) == 0) {
            *result_nonce = nonce;
        }
    }
}
