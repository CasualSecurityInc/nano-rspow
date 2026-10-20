/*
 * M1: submit two MI_STORE_DATA_IMM writes through i915 and read them back.
 *
 * Build on lemox after installing libdrm-dev:
 *   cc -O2 -Wall -Wextra $(pkg-config --cflags libdrm) \
 *     -o snb-smoke snb-smoke.c
 * Run as a user with read/write access to /dev/dri/renderD128.
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
#include <unistd.h>

#define CHECK(call) do {                                                   \
    if ((call) < 0) {                                                      \
        fprintf(stderr, "%s:%d: %s: %s\n", __FILE__, __LINE__, #call,    \
                strerror(errno));                                         \
        exit(EXIT_FAILURE);                                                \
    }                                                                      \
} while (0)

#define PAGE_SIZE_BYTES 4096u
#define MI_STORE_DATA_IMM (0x20u << 23)
#define MI_BATCH_BUFFER_END (0x0au << 23)

static int drm_fd = -1;

static uint32_t gem_create(uint64_t size)
{
    struct drm_i915_gem_create create = { .size = size };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_CREATE, &create));
    return create.handle;
}

static void *gem_mmap(uint32_t handle, uint64_t size)
{
    struct drm_i915_gem_mmap map = { .handle = handle, .size = size };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_MMAP, &map));
    return (void *)(uintptr_t)map.addr_ptr;
}

static void gem_close(uint32_t handle)
{
    struct drm_gem_close close_arg = { .handle = handle };
    CHECK(ioctl(drm_fd, DRM_IOCTL_GEM_CLOSE, &close_arg));
}

int main(void)
{
    drm_fd = open("/dev/dri/renderD128", O_RDWR | O_CLOEXEC);
    if (drm_fd < 0) {
        perror("open /dev/dri/renderD128");
        return EXIT_FAILURE;
    }

    const uint64_t size = PAGE_SIZE_BYTES;
    const uint32_t result = gem_create(size);
    const uint32_t batch = gem_create(size);

    uint32_t *words = gem_mmap(batch, size);
    memset(words, 0, size);

    /* Gen6 MI_STORE_DATA_IMM is four dwords for a DWord store:
     * header, reserved, address, immediate data. The relocation slots below
     * point at each command's address dword (byte offsets 8 and 24). */
    words[0] = MI_STORE_DATA_IMM | 2u; /* total length 4 dwords, bias 2 */
    words[1] = 0;
    words[2] = 0;                      /* relocated to result + 0 */
    words[3] = UINT32_C(0xc0ffee42);

    words[4] = MI_STORE_DATA_IMM | 2u;
    words[5] = 0;
    words[6] = 0;                      /* relocated to result + 4 */
    words[7] = UINT32_C(0x12345678);

    words[8] = MI_BATCH_BUFFER_END;    /* 0x05000000 */
    words[9] = 0;                      /* pad batch length to 8-byte alignment */
    CHECK(munmap(words, size));

    struct drm_i915_gem_relocation_entry relocs[2] = {
        {
            .target_handle = result,
            .offset = 8,
            .read_domains = I915_GEM_DOMAIN_RENDER,
            .write_domain = I915_GEM_DOMAIN_RENDER,
        },
        {
            .target_handle = result,
            .delta = 4,
            .offset = 24,
            .read_domains = I915_GEM_DOMAIN_RENDER,
            .write_domain = I915_GEM_DOMAIN_RENDER,
        },
    };

    /* execbuffer2 executes the last object as its batch buffer. */
    struct drm_i915_gem_exec_object2 objects[2] = {
        { .handle = result },
        {
            .handle = batch,
            .relocation_count = 2,
            .relocs_ptr = (uintptr_t)relocs,
        },
    };
    struct drm_i915_gem_execbuffer2 exec = {
        .buffers_ptr = (uintptr_t)objects,
        .buffer_count = 2,
        .batch_len = 10u * sizeof(uint32_t),
        .flags = I915_EXEC_RENDER,
    };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_EXECBUFFER2, &exec));

    struct drm_i915_gem_wait wait = {
        .bo_handle = result,
        .timeout_ns = INT64_C(30) * 1000 * 1000 * 1000,
    };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_WAIT, &wait));

    uint32_t *values = gem_mmap(result, size);
    const uint32_t first = values[0];
    const uint32_t second = values[1];
    CHECK(munmap(values, size));

    const int passed = first == UINT32_C(0xc0ffee42) &&
                       second == UINT32_C(0x12345678);
    printf("%s: result[0]=0x%08" PRIx32 " result[1]=0x%08" PRIx32 "\n",
           passed ? "PASS" : "FAIL", first, second);

    gem_close(batch);
    gem_close(result);
    CHECK(close(drm_fd));
    return passed ? EXIT_SUCCESS : EXIT_FAILURE;
}
