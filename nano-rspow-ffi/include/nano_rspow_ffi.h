#ifndef NANO_RSPOW_FFI_H
#define NANO_RSPOW_FFI_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct nano_rspow_generator nano_rspow_generator;
typedef struct nano_rspow_request nano_rspow_request;

typedef enum nano_rspow_status {
    NANO_RSPOW_OK = 0,
    NANO_RSPOW_INVALID_ARGUMENT = 1,
    NANO_RSPOW_NULL_POINTER = 2,
    NANO_RSPOW_ALLOCATION_FAILURE = 3,
    NANO_RSPOW_GENERATION_FAILED = 4,
    NANO_RSPOW_CANCELLED = 5,
    NANO_RSPOW_BACKEND_UNAVAILABLE = 6,
    NANO_RSPOW_BUFFER_TOO_SMALL = 7,
    NANO_RSPOW_PANIC = 8
} nano_rspow_status;

enum {
    NANO_RSPOW_BACKEND_AUTO = 0,
    NANO_RSPOW_BACKEND_CPU = 1,
    NANO_RSPOW_BACKEND_WGPU = 2
};

typedef struct nano_rspow_work_result {
    uint64_t nonce;
    uint64_t difficulty;
    uint64_t threshold;
    uint8_t is_valid;
} nano_rspow_work_result;

typedef struct nano_rspow_diagnostics {
    uint8_t backend[32];
    uint8_t backend_api[32];
    uint8_t adapter_name[128];
    uint8_t driver_info[128];
    uint8_t has_gpu;
    uint32_t vendor_id;
    uint32_t device_id;
    uint32_t max_compute_workgroups_per_dimension;
    uint32_t dispatch_x;
    uint64_t nonces_per_dispatch;
    uint8_t tuning_source;
} nano_rspow_diagnostics;

uint32_t nano_rspow_abi_version(void);
const char *nano_rspow_status_message(nano_rspow_status status);

nano_rspow_status nano_rspow_generator_new(uint32_t backend, nano_rspow_generator **output);
void nano_rspow_generator_free(nano_rspow_generator *generator);
nano_rspow_status nano_rspow_generator_generate(const nano_rspow_generator *generator,
                                                const uint8_t *hash,
                                                uint64_t threshold,
                                                const nano_rspow_request *request,
                                                nano_rspow_work_result *output);
nano_rspow_status nano_rspow_generator_validate(const nano_rspow_generator *generator,
                                                const uint8_t *hash,
                                                uint64_t nonce,
                                                uint64_t threshold,
                                                nano_rspow_work_result *output);
nano_rspow_status nano_rspow_generator_diagnostics(const nano_rspow_generator *generator,
                                                   nano_rspow_diagnostics *output);
nano_rspow_status nano_rspow_generator_backend_name(const nano_rspow_generator *generator,
                                                    uint8_t *output,
                                                    size_t capacity,
                                                    size_t *required);

nano_rspow_status nano_rspow_request_new(nano_rspow_request **output);
nano_rspow_status nano_rspow_request_cancel(nano_rspow_request *request);
nano_rspow_status nano_rspow_request_is_cancelled(const nano_rspow_request *request,
                                                  uint8_t *output);
void nano_rspow_request_free(nano_rspow_request *request);

#ifdef __cplusplus
}
#endif

#endif
