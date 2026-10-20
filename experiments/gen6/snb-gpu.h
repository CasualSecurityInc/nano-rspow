#ifndef SNB_GPU_H
#define SNB_GPU_H
/*
 * M3 Gen6 Blake2b harness. Uses the Session 6 proven media preamble and one
 * captured 14-dword MEDIA_OBJECT per media thread. Kernels support SIMD8 and
 * paired-GRF SIMD16; SIMD16 output is two adjacent SoA8 blocks. Dry-run is default.
 *
 * Build on lemox:
 *   cc -O2 -Wall -Wextra -Werror $(pkg-config --cflags libdrm) -o snb-m3 snb-m3.c
 * Examples:
 *   ./snb-m3 --kernel m3.bin --root <64 hex> --base 0 --threads 1
 *   ./snb-m3 --submit --kernel m3.bin --root <64 hex> --base 0 --threads 8 --dump r.bin
 *   ./snb-m3 --submit --kernel m3.bin --root <64 hex> --base 0 --threads 60 --lanes 16 --bench-ms 2000
 */
#include <i915_drm.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>

#define STATE_BYTES 8192u
#define ST_CURBE 0x000u
#define ST_ID 0x080u
#define ST_BT 0x100u
#define ST_SURF 0x140u
#define GUARD_WORD 0xcdcdcdcdu
#define MEDIA_OBJECT_HEADER 0x7100000cu
#define MI_BATCH_BUFFER_END 0x05000000u
#define PC_HEADER 0x7a000002u
#define PC_CS_STALL_SCOREBOARD 0x00100002u
#define PIPELINE_SELECT_MEDIA 0x69040001u
#define SBA_HEADER 0x61010008u
#define VFE_HEADER 0x70000006u
#define CURBE_HEADER 0x70010002u
#define ID_LOAD_HEADER 0x70020002u
#define MAX_THREADS 4096u
#define MAX_CODE_BYTES (1u << 20)

#define CHECK(call) do { \
    if ((call) < 0) { \
        fprintf(stderr, "%s:%d: %s: %s\n", __FILE__, __LINE__, #call, strerror(errno)); \
        exit(EXIT_FAILURE); \
    } \
} while (0)

struct reloc_list {
    struct drm_i915_gem_relocation_entry entries[8];
    unsigned count;
};

static int drm_fd = -1;

static inline int reset_count(uint32_t *value)
{
    struct drm_i915_reset_stats stats = { .ctx_id = 0 };
    if (ioctl(drm_fd, DRM_IOCTL_I915_GET_RESET_STATS, &stats) < 0)
        return -1;
    *value = stats.reset_count;
    return 0;
}

static inline uint32_t gem_create(uint64_t size)
{
    struct drm_i915_gem_create request = { .size = size };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_CREATE, &request));
    return request.handle;
}

static inline void *gem_map(uint32_t handle, uint64_t size, int write_enable)
{
    struct drm_i915_gem_set_domain domain = {
        .handle = handle,
        .read_domains = I915_GEM_DOMAIN_CPU,
        .write_domain = write_enable ? I915_GEM_DOMAIN_CPU : 0,
    };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_SET_DOMAIN, &domain));
    struct drm_i915_gem_mmap request = { .handle = handle, .size = size };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_MMAP, &request));
    return (void *)(uintptr_t)request.addr_ptr;
}

static inline void gem_close(uint32_t handle)
{
    struct drm_gem_close request = { .handle = handle };
    CHECK(ioctl(drm_fd, DRM_IOCTL_GEM_CLOSE, &request));
}

static inline uint64_t page_round(uint64_t size)
{
    return (size + 4095u) & ~UINT64_C(4095);
}

static inline double elapsed_seconds(struct timespec start, struct timespec end)
{
    return (double)(end.tv_sec - start.tv_sec) +
           (double)(end.tv_nsec - start.tv_nsec) / 1e9;
}

static inline void add_reloc(struct reloc_list *list, uint32_t target, uint64_t delta,
                      uint64_t offset, uint32_t read_domains, uint32_t write_domain)
{
    if (list->count >= sizeof(list->entries) / sizeof(list->entries[0])) {
        fputs("internal error: relocation list full\n", stderr);
        exit(2);
    }
    struct drm_i915_gem_relocation_entry *reloc = &list->entries[list->count++];
    memset(reloc, 0, sizeof(*reloc));
    reloc->target_handle = target;
    reloc->delta = delta;
    reloc->offset = offset;
    reloc->read_domains = read_domains;
    reloc->write_domain = write_domain;
}

static inline int parse_root(const char *text, uint8_t root[32])
{
    if (strlen(text) != 64)
        return -1;
    for (unsigned i = 0; i < 32; ++i) {
        unsigned byte = 0;
        for (unsigned j = 0; j < 2; ++j) {
            unsigned char c = (unsigned char)text[2 * i + j];
            unsigned digit;
            if (c >= '0' && c <= '9') digit = c - '0';
            else if (c >= 'a' && c <= 'f') digit = c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') digit = c - 'A' + 10;
            else return -1;
            byte = byte * 16 + digit;
        }
        root[i] = (uint8_t)byte;
    }
    return 0;
}

static inline uint64_t parse_u64(const char *text, const char *what)
{
    char *end = NULL;
    errno = 0;
    unsigned long long value = strtoull(text, &end, 0);
    if (errno || end == text || *end || text[0] < '0' || text[0] > '9') {
        fprintf(stderr, "invalid %s: %s\n", what, text);
        exit(2);
    }
    return (uint64_t)value;
}

static inline size_t read_kernel(const char *path, uint8_t **data_out)
{
    FILE *file = fopen(path, "rb");
    if (!file) { perror(path); exit(2); }
    if (fseek(file, 0, SEEK_END) != 0) { perror("fseek"); exit(2); }
    long size = ftell(file);
    if (size <= 0 || (unsigned long)size > MAX_CODE_BYTES || (size & 15)) {
        fprintf(stderr, "kernel must be 16-byte aligned and <= %u bytes\n", MAX_CODE_BYTES);
        exit(2);
    }
    rewind(file);
    uint8_t *data = malloc((size_t)size);
    if (!data || fread(data, 1, (size_t)size, file) != (size_t)size) {
        fputs("failed to read kernel\n", stderr); exit(2);
    }
    fclose(file);
    *data_out = data;
    return (size_t)size;
}

static inline void init_state(uint8_t *state, uint32_t code_handle, uint32_t results_handle,
                       struct reloc_list *relocs, const uint8_t root[32],
                       uint64_t threshold, uint64_t base, size_t result_bytes)
{
    memset(state, 0, STATE_BYTES);
    uint32_t *curbe = (uint32_t *)(state + ST_CURBE);
    for (unsigned i = 0; i < 8; ++i)
        memcpy(&curbe[i], root + i * 4, 4);
    curbe[8] = (uint32_t)threshold;
    curbe[9] = (uint32_t)(threshold >> 32);
    curbe[10] = (uint32_t)base;
    curbe[11] = (uint32_t)(base >> 32);
    for (unsigned i = 0; i < 4; ++i)
        curbe[12 + i] = 0xc0de000cu + i;

    uint32_t *id = (uint32_t *)(state + ST_ID);
    id[0] = 0;
    id[1] = 0;
    id[2] = 0;
    id[3] = 0x00000101u;
    id[4] = 0x00020000u;
    add_reloc(relocs, code_handle, 0, ST_ID, I915_GEM_DOMAIN_INSTRUCTION, 0);

    *(uint32_t *)(state + ST_BT) = ST_SURF;
    uint32_t *surf = (uint32_t *)(state + ST_SURF);
    surf[0] = 0x80000100u;
    unsigned entries_minus_one = (unsigned)(result_bytes / 16u - 1u);
    surf[2] = ((entries_minus_one & 0x7fu) << 6) |
              (((entries_minus_one >> 7) & 0x1fffu) << 19);
    surf[3] = (((entries_minus_one >> 20) & 0x7fu) << 21) | (15u << 3);
    add_reloc(relocs, results_handle, 0, ST_SURF + 4,
              I915_GEM_DOMAIN_RENDER, I915_GEM_DOMAIN_RENDER);
}

static inline size_t build_batch(uint32_t *batch, size_t capacity_dwords,
                          unsigned threads, uint32_t state_handle, uint32_t sync_handle,
                          struct reloc_list *relocs)
{
    size_t n = 0;
#define PUT(v) do { if (n >= capacity_dwords) { fputs("batch buffer overflow\n", stderr); exit(2); } batch[n++] = (v); } while (0)
    PUT(PC_HEADER); PUT(PC_CS_STALL_SCOREBOARD); PUT(0); PUT(0);
    PUT(PC_HEADER); PUT(0x00004000u);
    size_t sync_address_dword = n;
    PUT(0);
    add_reloc(relocs, sync_handle, 0, 4u * sync_address_dword,
              I915_GEM_DOMAIN_INSTRUCTION, I915_GEM_DOMAIN_INSTRUCTION);
    PUT(0);
    PUT(PC_HEADER); PUT(0x00001400u); PUT(0); PUT(0);
    PUT(PIPELINE_SELECT_MEDIA);
    PUT(SBA_HEADER); PUT(1);
    size_t state_base_dword = n;
    PUT(0);
    add_reloc(relocs, state_handle, 1, 4u * state_base_dword,
              I915_GEM_DOMAIN_INSTRUCTION, 0);
    PUT(1); PUT(1); PUT(1); PUT(1); PUT(1); PUT(1); PUT(1);
    PUT(VFE_HEADER); PUT(0); PUT(0x003b1000u); PUT(0); PUT(0x003a0024u); PUT(0); PUT(0); PUT(0);
    PUT(CURBE_HEADER); PUT(0); PUT(64);
    size_t curbe_address_dword = n;
    PUT(0);
    add_reloc(relocs, state_handle, 0, 4u * curbe_address_dword,
              I915_GEM_DOMAIN_INSTRUCTION, 0);
    PUT(ID_LOAD_HEADER); PUT(0); PUT(32);
    size_t idrt_address_dword = n;
    PUT(0);
    add_reloc(relocs, state_handle, ST_ID, 4u * idrt_address_dword,
              I915_GEM_DOMAIN_INSTRUCTION, 0);

    for (unsigned t = 0; t < threads; ++t) {
        PUT(MEDIA_OBJECT_HEADER);
        PUT(0); PUT(0); PUT(0); PUT(0); PUT(0);
        PUT(t); PUT(0); PUT(0); PUT(0); PUT(0); PUT(0); PUT(0); PUT(0);
    }
    PUT(MI_BATCH_BUFFER_END);
    if (n & 1u) PUT(0);
#undef PUT
    return n;
}

static inline int submit_once(struct drm_i915_gem_exec_object2 *objects,
                       unsigned object_count, size_t batch_bytes, uint32_t batch_handle,
                       uint32_t resets_before)
{
    struct drm_i915_gem_execbuffer2 exec = {
        .buffers_ptr = (uintptr_t)objects,
        .buffer_count = object_count,
        .batch_len = (uint32_t)batch_bytes,
        .flags = I915_EXEC_RENDER,
    };
    if (ioctl(drm_fd, DRM_IOCTL_I915_GEM_EXECBUFFER2, &exec) < 0) {
        perror("DRM_IOCTL_I915_GEM_EXECBUFFER2");
        return -1;
    }
    struct drm_i915_gem_wait wait = {
        .bo_handle = batch_handle,
        .timeout_ns = INT64_C(60) * 1000 * 1000 * 1000,
    };
    if (ioctl(drm_fd, DRM_IOCTL_I915_GEM_WAIT, &wait) < 0) {
        perror("DRM_IOCTL_I915_GEM_WAIT");
        return -1;
    }
    uint32_t resets_after;
    if (reset_count(&resets_after) < 0) { perror("reset stats"); return -1; }
    if (resets_after != resets_before) {
        fprintf(stderr, "INVALID RUN: i915 reset count changed %u -> %u\n",
                resets_before, resets_after);
        return -2;
    }
    return 0;
}


#endif
