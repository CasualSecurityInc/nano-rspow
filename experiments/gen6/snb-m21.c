/*
 * M2.1 one-thread first-light harness. Default is dry; the only submission
 * path is explicit --submit. Each command/state dword is documented in
 * m2-session3-findings.md and has no placeholder values.
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

#include "m21dump_blob.h"

#define STATE_BYTES 8192u
#define CODE_BYTES 4096u
#define RESULT_BYTES 256u
#define BATCH_BYTES 4096u
#define ST_ID 0x080u
#define ST_BT 0x100u
#define ST_SURF 0x140u
#define GUARD_WORD 0xcdcdcdcdu

#define PC_HEADER 0x7a000002u
#define PC_CS_STALL_SCOREBOARD 0x00100002u
#define PIPELINE_SELECT_MEDIA 0x69040001u
#define SBA_HEADER 0x61010008u
#define VFE_HEADER 0x70000006u
#define CURBE_HEADER 0x70010002u
#define ID_LOAD_HEADER 0x70020002u
#define WALKER_HEADER 0x7103000fu
#define MEDIA_OBJECT_HEADER 0x7100000cu
#define MI_BATCH_BUFFER_END 0x05000000u

#define CHECK(call) do { \
    if ((call) < 0) { \
        fprintf(stderr, "%s:%d: %s: %s\n", __FILE__, __LINE__, #call, strerror(errno)); \
        exit(EXIT_FAILURE); \
    } \
} while (0)

static int drm_fd = -1;

static int get_reset_count(uint32_t *count)
{
    struct drm_i915_reset_stats stats = { .ctx_id = 0 };
    if (ioctl(drm_fd, DRM_IOCTL_I915_GET_RESET_STATS, &stats) < 0)
        return -1;
    *count = stats.reset_count;
    return 0;
}

static uint32_t gem_create(uint64_t size)
{
    struct drm_i915_gem_create c = { .size = size };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_CREATE, &c));
    return c.handle;
}

static void *gem_mmap(uint32_t handle, uint64_t size, int write_enable)
{
    struct drm_i915_gem_set_domain d = {
        .handle = handle, .read_domains = I915_GEM_DOMAIN_CPU,
        .write_domain = write_enable ? I915_GEM_DOMAIN_CPU : 0,
    };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_SET_DOMAIN, &d));
    struct drm_i915_gem_mmap m = { .handle = handle, .size = size };
    CHECK(ioctl(drm_fd, DRM_IOCTL_I915_GEM_MMAP, &m));
    return (void *)(uintptr_t)m.addr_ptr;
}

static void gem_close(uint32_t handle)
{
    struct drm_gem_close c = { .handle = handle };
    CHECK(ioctl(drm_fd, DRM_IOCTL_GEM_CLOSE, &c));
}

struct reloc_list {
    struct drm_i915_gem_relocation_entry entries[8];
    unsigned count;
};

static void add_reloc(struct reloc_list *list, uint32_t target, uint64_t delta,
                      uint64_t offset, uint32_t read_domains,
                      uint32_t write_domain)
{
    struct drm_i915_gem_relocation_entry *r = &list->entries[list->count++];
    memset(r, 0, sizeof(*r));
    r->target_handle = target;
    r->delta = delta;
    r->offset = offset;
    r->read_domains = read_domains;
    r->write_domain = write_domain;
}

static unsigned build_state(uint8_t *state, uint32_t code_handle,
                            uint32_t results_handle, struct reloc_list *relocs,
                            unsigned result_bytes, size_t kernel_bytes)
{
    uint32_t *id;
    uint32_t *bt;
    uint32_t *surf;

    memset(state, 0, STATE_BYTES);
    for (unsigned i = 0; i < 16; ++i)
        ((uint32_t *)state)[i] = 0xC0DE0000u | i;

    id = (uint32_t *)(state + ST_ID);
    id[0] = 0;
    id[1] = 0;                         /* exceptions/SPF off */
    id[2] = 0;                         /* no sampler */
    id[3] = 0x00000101u;               /* BT at +0x100, one entry, BTI 0 */
    id[4] = 0x00020000u;               /* CURBE read offset 0, length 2 */
    id[5] = id[6] = id[7] = 0;
    add_reloc(relocs, code_handle, 0, ST_ID,
              I915_GEM_DOMAIN_INSTRUCTION, 0);

    bt = (uint32_t *)(state + ST_BT);
    bt[0] = ST_SURF;                   /* surface-state offset from SSBA */

    surf = (uint32_t *)(state + ST_SURF);
    surf[0] = 0x80000100u;             /* buffer surface + render-cache RW */
    surf[1] = 0;
    unsigned e = result_bytes / 16u - 1u;
    /* VAAPI's logical width/height/depth fields, packed at gen6.xml offsets. */
    surf[2] = ((e & 0x7fu) << 6) | (((e >> 7) & 0x1fffu) << 19);
    surf[3] = (((e >> 20) & 0x7fu) << 21) | (15u << 3);
    surf[4] = surf[5] = surf[6] = surf[7] = 0;
    add_reloc(relocs, results_handle, 0, ST_SURF + 4,
              I915_GEM_DOMAIN_RENDER, I915_GEM_DOMAIN_RENDER);

    if (kernel_bytes > CODE_BYTES)
        return 0;
    return 1;
}

static unsigned build_batch(uint32_t *b, unsigned x, int media_object,
                            uint32_t state_handle, uint32_t sync_handle,
                            struct reloc_list *relocs,
                            const uint32_t inline_data[8], unsigned count, int index_inline, int dispatch)
{
    unsigned n = 0;

    b[n++] = PC_HEADER; b[n++] = PC_CS_STALL_SCOREBOARD; b[n++] = 0; b[n++] = 0;
    b[n++] = PC_HEADER; b[n++] = 0x00004000u; /* Gen6 WRITE_QWORD workaround */
    b[n] = 0;
    add_reloc(relocs, sync_handle, 0, 4u * n,
              I915_GEM_DOMAIN_INSTRUCTION, I915_GEM_DOMAIN_INSTRUCTION);
    n++;
    b[n++] = 0;
    b[n++] = PC_HEADER; b[n++] = 0x00001400u; b[n++] = 0; b[n++] = 0;
    b[n++] = PIPELINE_SELECT_MEDIA;

    b[n++] = SBA_HEADER;
    b[n++] = 1;                        /* General base modify, base 0 */
    b[n] = 0; add_reloc(relocs, state_handle, 1, 4u * n,
                         I915_GEM_DOMAIN_INSTRUCTION, 0); n++;
    b[n++] = 1;                        /* Dynamic base modify, base 0 */
    b[n++] = 1;                        /* Indirect base modify, base 0 */
    b[n++] = 1;                        /* Instruction base modify, base 0 */
    b[n++] = 1; b[n++] = 1; b[n++] = 1; b[n++] = 1;

    b[n++] = VFE_HEADER;
    b[n++] = 0;                        /* scratch disabled */
    b[n++] = 0x003b1000u;              /* 59 threads, 16 URB entries */
    b[n++] = 0;                        /* debug object ID */
    b[n++] = 0x003a0024u;              /* 58 URB regs, CURBE alloc 36 */
    b[n++] = 0; b[n++] = 0; b[n++] = 0;

    b[n++] = CURBE_HEADER;
    b[n++] = 0;
    b[n++] = 64;
    b[n] = 0; add_reloc(relocs, state_handle, 0, 4u * n,
                         I915_GEM_DOMAIN_INSTRUCTION, 0); n++;

    b[n++] = ID_LOAD_HEADER;
    b[n++] = 0;
    b[n++] = 32;
    b[n] = 0; add_reloc(relocs, state_handle, ST_ID, 4u * n,
                         I915_GEM_DOMAIN_INSTRUCTION, 0); n++;

    if (dispatch && media_object) {
      for (unsigned t = 0; t < count; ++t) {
        b[n++] = MEDIA_OBJECT_HEADER;  /* 14-dword packet copied from capture/session4/sub-002 */
        b[n++] = 0;                    /* interface descriptor index 0 */
        b[n++] = 0;                    /* no scoreboard/indirect data */
        b[n++] = 0;
        b[n++] = 0;                    /* scoreboard X/Y */
        b[n++] = 0;                    /* scoreboard mask */
        /* Eight inline dwords copied from VAAPI's captured Gen6 MEDIA_OBJECT.
         * The EOT probe ignores them; this uses a packet shape proven on SNB. */
        for (unsigned i = 0; i < 8; ++i)
            b[n++] = (index_inline && i == 0) ? t : inline_data[i];
      }
    } else if (dispatch) {
        b[n++] = WALKER_HEADER;
        b[n++] = 0;                    /* interface descriptor index 0 */
        b[n++] = 0;                    /* no children, indirect data, scoreboard */
        b[n++] = 0; b[n++] = 0; b[n++] = 0;
        b[n++] = 0;
        b[n++] = 0x03ff03ffu;          /* cross-check: max loop counts */
        b[n++] = 0x00010001u;          /* block resolution X/Y = 1/1 */
        b[n++] = 0;                    /* local start */
        b[n++] = 0;                    /* local end */
        b[n++] = 0x00010000u;          /* local outer stride Y = 1 */
        b[n++] = 1;                    /* local inner unit X = 1 */
        b[n++] = 0x00010001u;          /* global resolution X/Y = 1/1 */
        b[n++] = x & 0x1ffu;           /* global start X [PRM] */
        b[n++] = 1;                    /* global outer stride X = 1 */
        b[n++] = 0x00010000u;          /* global inner unit Y = 1 */
    }

    b[n++] = MI_BATCH_BUFFER_END;
    if (n & 1u)
        b[n++] = 0;
    return n;
}

int main(int argc, char **argv)
{
    int submit = 0, media_object = 1, dispatch = 1, index_inline = 0;
    unsigned count = 1, result_bytes = RESULT_BYTES;
    uint32_t kernel_storage[CODE_BYTES / 4];
    const uint32_t *kernel = m21_kernel;
    size_t kernel_bytes = sizeof(m21_kernel);
    uint32_t inline_data[8] = {
        0, 0, 0x000f0001u, 0x00300007u, 0, 0x00140008u, 0, 0
    };
    const char *dump_path = "payload.bin";
    unsigned x = 0;
    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "--submit")) submit = 1;
        else if (!strcmp(argv[i], "--media-object")) media_object = 1;
        else if (!strcmp(argv[i], "--dispatch") && i + 1 < argc) {
            const char *mode = argv[++i];
            if (!strcmp(mode, "walker")) media_object = 0;
            else if (!strcmp(mode, "media-object")) media_object = 1;
            else { fputs("dispatch must be media-object or walker\n", stderr); return 2; }
        }
        else if (!strcmp(argv[i], "--no-dispatch")) dispatch = 0;
        else if (!strcmp(argv[i], "--count") && i + 1 < argc)
            count = (unsigned)strtoul(argv[++i], NULL, 0);
        else if (!strcmp(argv[i], "--result-bytes") && i + 1 < argc)
            result_bytes = (unsigned)strtoul(argv[++i], NULL, 0);
        else if (!strcmp(argv[i], "--x") && i + 1 < argc) x = (unsigned)strtoul(argv[++i], NULL, 0);
        else if (!strcmp(argv[i], "--kernel") && i + 1 < argc) {
            const char *name = argv[++i];
            if (!strcmp(name, "1")) name = "dump";
            if (!strcmp(name, "2")) name = "dump2";
            if (!strcmp(name, "3")) name = "slots";
            char path[128];
            if (strspn(name, "abcdefghijklmnopqrstuvwxyz0123456789") != strlen(name) ||
                snprintf(path, sizeof path, "m21%s.bin", name) >= (int)sizeof path) {
                fputs("invalid kernel name\n", stderr); return 2;
            }
            FILE *f = fopen(path, "rb");
            if (!f) { perror(path); return 2; }
            kernel_bytes = fread(kernel_storage, 1, CODE_BYTES, f);
            int extra = fgetc(f);
            int error = ferror(f);
            fclose(f);
            if (extra != EOF || error) { fputs("kernel too large or unreadable\n", stderr); return 2; }
            kernel = kernel_storage;
            index_inline = !strcmp(name, "slots");
            if (index_inline)
                for (unsigned j = 0; j < 8; ++j) inline_data[j] = 0xfeed0000u | j;
        }
        else if (!strcmp(argv[i], "--dump") && i + 1 < argc) dump_path = argv[++i];
        else if (!strcmp(argv[i], "--inline") && i + 1 < argc) {
            char *save = NULL, *p = strtok_r(argv[++i], ",", &save);
            unsigned j = 0;
            while (p && j < 8) {
                char *end = NULL;
                unsigned long value = strtoul(p, &end, 0);
                if (end == p || *end || value > UINT32_MAX) {
                    fprintf(stderr, "invalid inline dword: %s\n", p); return 2;
                }
                inline_data[j++] = (uint32_t)value;
                p = strtok_r(NULL, ",", &save);
            }
            if (j != 8 || p) { fprintf(stderr, "--inline requires exactly 8 comma-separated dwords\n"); return 2; }
        }
        else {
            fprintf(stderr, "usage: %s [--submit] [--media-object] [--x 0..511] [--kernel dump|dump2|eot|pattern16|pattern128|pattern256|slots|lane|arith] [--count N] [--result-bytes N] [--no-dispatch] [--inline d0,...,d7] [--dump file]\n", argv[0]);
            return 2;
        }
    }
    if (!count || count > 60 || (!media_object && count != 1)) {
        fputs("count must be 1..60; walker is one-thread only\n", stderr); return 2;
    }
    if (index_inline && result_bytes < count * 32u) result_bytes = count * 32u;
    if (!result_bytes || result_bytes > 4096 || result_bytes % 16u) {
        fputs("result-bytes must be a positive multiple of 16, at most 4096\n", stderr); return 2;
    }
    if (x > 511) { fputs("X must be in [0,511]\n", stderr); return 2; }
    if (!kernel_bytes || kernel_bytes % 16u) {
        fputs("kernel blob is empty or malformed\n", stderr); return 2;
    }

    if (!submit) {
        uint32_t batch[BATCH_BYTES / 4] = {0};
        uint8_t state[STATE_BYTES];
        struct reloc_list state_relocs = {0};
        struct reloc_list dummy = {0};
        unsigned n = build_batch(batch, x, media_object, 0, 0, &dummy, inline_data, count, index_inline, dispatch);
        (void)build_state(state, 2, 1, &state_relocs, result_bytes, kernel_bytes);
        printf("dry run: X=%u dispatch=%s batch=%u dwords; no GPU submission\n",
               x, media_object ? "MEDIA_OBJECT" : "MEDIA_OBJECT_WALKER", n);
        for (unsigned i = 0; i < n; ++i)
            printf("  [%02u] %08x%s\n", i, batch[i],
                   (i == 6 || i == 15 || i == 34 || i == 38)
                       ? "  <relocation>" : "");
        printf("state: CURBE[0..15] at +0x000 (position magic)\n");
        for (unsigned i = 0; i < 8; ++i)
            printf("  IDRT[%u] +0x%03x = %08x%s\n", i, ST_ID + 4u * i,
                   ((uint32_t *)(state + ST_ID))[i], i == 0 ? "  <code relocation>" : "");
        printf("  BT[0]  +0x%03x = %08x\n", ST_BT,
               *(uint32_t *)(state + ST_BT));
        for (unsigned i = 0; i < 8; ++i)
            printf("  SURF[%u] +0x%03x = %08x%s\n", i, ST_SURF + 4u * i,
                   ((uint32_t *)(state + ST_SURF))[i], i == 1 ? "  <results relocation>" : "");
        printf("kernel=%zu bytes, CURBE=64B, ID=32B, surface=%uB, dump=4096B, count=%u\n", kernel_bytes, result_bytes, count);
        return 0;
    }

    drm_fd = open("/dev/dri/renderD128", O_RDWR | O_CLOEXEC);
    if (drm_fd < 0) { perror("open renderD128"); return 1; }

    uint32_t results_h = gem_create(4096);
    uint32_t state_h = gem_create(STATE_BYTES);
    uint32_t code_h = gem_create(CODE_BYTES);
    uint32_t sync_h = gem_create(4096);
    uint32_t batch_h = gem_create(BATCH_BYTES);
    uint8_t *state = gem_mmap(state_h, STATE_BYTES, 1);
    uint8_t *code = gem_mmap(code_h, CODE_BYTES, 1);
    uint8_t *sync = gem_mmap(sync_h, 4096, 1);
    uint32_t *results = gem_mmap(results_h, 4096, 1);
    uint32_t *batch = gem_mmap(batch_h, BATCH_BYTES, 1);
    for (unsigned i = 0; i < 4096 / 4; ++i) results[i] = GUARD_WORD;
    memset(code, 0, CODE_BYTES);
    memcpy(code, kernel, kernel_bytes);
    memset(sync, 0, 4096);
    memset(batch, 0, BATCH_BYTES);

    struct reloc_list state_relocs = {0}, batch_relocs = {0};
    if (!build_state(state, code_h, results_h, &state_relocs, result_bytes, kernel_bytes)) {
        fputs("state layout overflow\n", stderr); return 2;
    }
    unsigned nwords = build_batch(batch, x, media_object, state_h, sync_h, &batch_relocs,
                                  inline_data, count, index_inline, dispatch);
    CHECK(munmap(state, STATE_BYTES));
    CHECK(munmap(code, CODE_BYTES));
    CHECK(munmap(sync, 4096));
    CHECK(munmap(results, 4096));
    CHECK(munmap(batch, BATCH_BYTES));

    struct drm_i915_gem_exec_object2 objects[5] = {
        { .handle = results_h },
        { .handle = state_h,
          .relocation_count = state_relocs.count,
          .relocs_ptr = (uintptr_t)state_relocs.entries },
        { .handle = code_h },
        { .handle = sync_h },
        { .handle = batch_h,
          .relocation_count = batch_relocs.count,
          .relocs_ptr = (uintptr_t)batch_relocs.entries },
    };
    struct drm_i915_gem_execbuffer2 eb = {
        .buffers_ptr = (uintptr_t)objects,
        .buffer_count = 5,
        .batch_len = nwords * 4u,
        .flags = I915_EXEC_RENDER,
    };
    uint32_t resets_before = 0, resets_after = 0;
    if (get_reset_count(&resets_before) < 0) {
        perror("DRM_IOCTL_I915_GET_RESET_STATS before submit");
        return 1;
    }
    int exec_rc = ioctl(drm_fd, DRM_IOCTL_I915_GEM_EXECBUFFER2, &eb);
    int exec_errno = errno;
    if (exec_rc < 0) {
        if (get_reset_count(&resets_after) == 0 && resets_after != resets_before) {
            fprintf(stderr, "INVALID RUN: i915 reset count changed %u -> %u during execbuf\n",
                    resets_before, resets_after);
            return 5;
        }
        errno = exec_errno;
        CHECK(exec_rc);
    }

    struct drm_i915_gem_wait wait = {
        .bo_handle = batch_h,
        .timeout_ns = INT64_C(10) * 1000 * 1000 * 1000,
    };
    int wait_rc = ioctl(drm_fd, DRM_IOCTL_I915_GEM_WAIT, &wait);
    int wait_errno = errno;
    if (wait_rc == 0) results = gem_mmap(results_h, 4096, 0);
    if (get_reset_count(&resets_after) < 0) {
        perror("DRM_IOCTL_I915_GET_RESET_STATS after wait/readback");
        return 1;
    }
    if (resets_after != resets_before) {
        fprintf(stderr, "INVALID RUN: i915 reset count changed %u -> %u; discard output\n",
                resets_before, resets_after);
        return 5;
    }
    if (wait_rc < 0) {
        errno = wait_errno;
        CHECK(wait_rc);
    }

    FILE *dump = fopen(dump_path, "wb");
    if (!dump) { perror(dump_path); return 1; }
    int dump_ok = fwrite(results, 1, 4096, dump) == 4096;
    if (fclose(dump) != 0 || !dump_ok) { fputs("failed to write full result BO\n", stderr); return 1; }
    printf("COMPLETE (reset-clean %u); X=%u payload after %s dispatch:\n",
           resets_after, x, media_object ? "MEDIA_OBJECT" : "walker");
    for (unsigned i = 0; i < result_bytes / 4; ++i)
      if (results[i] != GUARD_WORD)
        printf("  dword[%02u] = %08x\n", i, results[i]);

    CHECK(munmap(results, 4096));
    gem_close(batch_h); gem_close(sync_h); gem_close(code_h); gem_close(state_h); gem_close(results_h);
    CHECK(close(drm_fd));
    return 0;
}
