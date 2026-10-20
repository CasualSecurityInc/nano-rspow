#ifndef BLAKE8_H
#define BLAKE8_H
#include <stdint.h>
uint64_t blake8_hash(uint64_t nonce, const uint64_t root[4]);
#endif
