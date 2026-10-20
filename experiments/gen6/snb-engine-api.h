#ifndef SNB_ENGINE_API_H
#define SNB_ENGINE_API_H
#include <stdint.h>
typedef struct snb_engine snb_engine;
struct snb_result {
    uint64_t nonce, hash, gpu_hashes, cpu_hashes;
    int on_gpu;
};
snb_engine *snb_engine_open(const char *kernel_path, unsigned lanes);
/* Search count successive nonces modulo 2^64. Return 1 hit, 0 miss, -1 error.
 * The caller serializes access to each engine. Counts describe actual work. */
int snb_engine_search(snb_engine *, const uint8_t root[32], uint64_t base,
                      uint64_t count, uint64_t threshold, struct snb_result *);
void snb_engine_close(snb_engine *);
const char *snb_engine_error(void);
int snb_engine_error_code(void);
#endif
