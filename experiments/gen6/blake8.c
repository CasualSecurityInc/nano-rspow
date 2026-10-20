#include "blake8.h"

static const uint64_t iv[8] = {
    UINT64_C(0x6a09e667f3bcc908),
    UINT64_C(0xbb67ae8584caa73b),
    UINT64_C(0x3c6ef372fe94f82b),
    UINT64_C(0xa54ff53a5f1d36f1),
    UINT64_C(0x510e527fade682d1),
    UINT64_C(0x9b05688c2b3e6c1f),
    UINT64_C(0x1f83d9abfb41bd6b),
    UINT64_C(0x5be0cd19137e2179)
};
static const unsigned char sigma[10][16] = {
    {0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15},
    {14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3},
    {11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4},
    {7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8},
    {9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13},
    {2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9},
    {12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11},
    {13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10},
    {6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5},
    {10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0}
};

static uint64_t rotr(uint64_t x, unsigned n)
{
    return (x >> n) | (x << (64 - n));
}
#define G(a,b,c,d,x,y) do { \
    v[a] += v[b] + (x); v[d] = rotr(v[d] ^ v[a], 32); \
    v[c] += v[d]; v[b] = rotr(v[b] ^ v[c], 24); \
    v[a] += v[b] + (y); v[d] = rotr(v[d] ^ v[a], 16); \
    v[c] += v[d]; v[b] = rotr(v[b] ^ v[c], 63); \
} while (0)

uint64_t blake8_hash(uint64_t nonce, const uint64_t root[4])
{
    uint64_t m[16] = { nonce, root[0], root[1], root[2], root[3] };
    uint64_t v[16];
    for (unsigned i = 0; i < 8; ++i) v[i] = v[i + 8] = iv[i];
    v[0] ^= UINT64_C(0x01010008);
    v[12] ^= 40;
    v[14] ^= UINT64_MAX;
    for (unsigned r = 0; r < 12; ++r) {
        const unsigned char *s = sigma[r % 10];
        G(0,4,8,12,m[s[0]],m[s[1]]); G(1,5,9,13,m[s[2]],m[s[3]]);
        G(2,6,10,14,m[s[4]],m[s[5]]); G(3,7,11,15,m[s[6]],m[s[7]]);
        G(0,5,10,15,m[s[8]],m[s[9]]); G(1,6,11,12,m[s[10]],m[s[11]]);
        G(2,7,8,13,m[s[12]],m[s[13]]); G(3,4,9,14,m[s[14]],m[s[15]]);
    }
    return v[0] ^ v[8] ^ iv[0] ^ UINT64_C(0x01010008);
}
