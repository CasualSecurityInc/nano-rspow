/* Replay captured i915 execbuf2 submissions with preserved reloc domains. */
#define _GNU_SOURCE
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

#define MAX_OBJECTS 512u
#define MI_BATCH_BUFFER_END 0x05000000u

struct saved_reloc {
    uint64_t offset;
    uint32_t target;
    uint64_t delta;
    uint32_t read_domains;
    uint32_t write_domain;
    int domains_known;
};

struct saved_object {
    uint32_t old_handle;
    uint64_t size;
    uint64_t alignment;
    uint64_t old_offset;
    uint64_t old_flags;
    struct saved_reloc *relocs;
    unsigned expected_relocs;
    unsigned nrelocs;
    char path[1024];
};

static int drm_fd = -1;
static struct saved_object objects[MAX_OBJECTS];

static void fail(const char *what)
{
    fprintf(stderr, "%s: %s\n", what, strerror(errno));
    exit(1);
}

static uint32_t gem_create(uint64_t size)
{
    struct drm_i915_gem_create request = { .size = size };
    if (ioctl(drm_fd, DRM_IOCTL_I915_GEM_CREATE, &request) < 0)
        fail("GEM_CREATE");
    return request.handle;
}

static void *gem_mmap(uint32_t handle, uint64_t size)
{
    struct drm_i915_gem_mmap request = { .handle = handle, .size = size };
    if (ioctl(drm_fd, DRM_IOCTL_I915_GEM_MMAP, &request) < 0)
        fail("GEM_MMAP");
    return (void *)(uintptr_t)request.addr_ptr;
}

static int get_reset_count(uint32_t *count)
{
    struct drm_i915_reset_stats stats = { .ctx_id = 0 };
    if (ioctl(drm_fd, DRM_IOCTL_I915_GET_RESET_STATS, &stats) < 0)
        return -1;
    *count = stats.reset_count;
    return 0;
}

static int object_index(uint32_t old_handle, unsigned count)
{
    for (unsigned i = 0; i < count; ++i)
        if (objects[i].old_handle == old_handle)
            return (int)i;
    return -1;
}

static unsigned read_manifest(const char *capdir, const char *sub,
                             unsigned *ring, unsigned *batch_len,
                             unsigned *batch_off, unsigned *count)
{
    char path[1200], line[1024];
    snprintf(path, sizeof path, "%s/%s.manifest", capdir, sub);
    FILE *f = fopen(path, "r");
    if (!f) fail(path);
    unsigned seq = 0, n = 0;
    while (fgets(line, sizeof line, f)) {
        if (sscanf(line, "seq %u ring %u batch_len %u batch_off %u count %u",
                   &seq, ring, batch_len, batch_off, count) == 5)
            continue;
        if (!strncmp(line, "obj ", 4)) {
            unsigned index, old_handle, reloc_count;
            unsigned long long size, alignment = 0, offset = 0, flags = 0;
            int fields = sscanf(line + 4, "%u %u %llu %u %llu %llu %llu",
                                &index, &old_handle, &size, &reloc_count,
                                &alignment, &offset, &flags);
            if (fields < 4 || n >= MAX_OBJECTS) {
                fprintf(stderr, "bad object row or too many objects in %s\n", path);
                fclose(f); exit(1);
            }
            struct saved_object *o = &objects[n++];
            memset(o, 0, sizeof *o);
            o->old_handle = old_handle;
            o->size = size;
            o->expected_relocs = reloc_count;
            o->alignment = fields >= 5 ? alignment : 0;
            o->old_offset = fields >= 6 ? offset : 0;
            o->old_flags = fields >= 7 ? flags : 0;
            o->relocs = calloc(reloc_count ? reloc_count : 1, sizeof *o->relocs);
            if (!o->relocs) fail("calloc relocations");
            snprintf(o->path, sizeof o->path, "%s/bo-%03u-%u-%u.bin",
                     capdir, seq, index, old_handle);
        } else if (!strncmp(line, "reloc ", 6) && n) {
            unsigned long long offset, delta;
            unsigned target, read_domains = 0, write_domain = 0;
            int fields = sscanf(line + 6, "%llu %u %llu %u %u",
                                &offset, &target, &delta, &read_domains, &write_domain);
            struct saved_object *o = &objects[n - 1];
            if (fields < 3 || o->nrelocs >= o->expected_relocs) {
                fprintf(stderr, "bad or excess relocation row in %s\n", path);
                fclose(f); exit(1);
            }
            struct saved_reloc *r = &o->relocs[o->nrelocs++];
            r->offset = offset;
            r->target = target;
            r->delta = delta;
            r->read_domains = read_domains;
            r->write_domain = write_domain;
            r->domains_known = fields == 5;
        }
    }
    fclose(f);
    if (!n) { fprintf(stderr, "%s: no objects\n", path); exit(1); }
    for (unsigned i = 0; i < n; ++i) {
        if (objects[i].nrelocs != objects[i].expected_relocs) {
            fprintf(stderr, "object %u: manifest says %u relocations, found %u\n",
                    i, objects[i].expected_relocs, objects[i].nrelocs);
            exit(1);
        }
    }
    return n;
}

static void print_list(const char *sub, unsigned ring, unsigned batch_len,
                       unsigned batch_off, unsigned count)
{
    printf("%s: ring=%u batch_len=%u batch_off=%u objects=%u\n",
           sub, ring, batch_len, batch_off, count);
    int missing_domains = 0;
    for (unsigned i = 0; i < count; ++i) {
        struct saved_object *o = &objects[i];
        unsigned unknown = 0;
        for (unsigned j = 0; j < o->nrelocs; ++j)
            unknown += !o->relocs[j].domains_known;
        missing_domains += unknown;
        printf("  obj[%u] old_handle=%u size=%" PRIu64 " relocations=%u "
               "domains_unknown=%u dump=%s\n", i, o->old_handle, o->size,
               o->nrelocs, unknown, access(o->path, R_OK) == 0 ? "yes" : "MISSING");
    }
    printf("  batch=obj[%u]\n", count - 1);
    if (missing_domains)
        printf("  REPLAY NOT SAFE: %u relocation(s) have no recorded domains; recapture with updated snb-cap.so\n",
               missing_domains);
}

int main(int argc, char **argv)
{
    if (argc < 3) {
        fprintf(stderr, "usage: %s CAPDIR sub-NNN [--list] [--truncate N] "
                        "[--override-bo INDEX FILE] [--timeout SEC]\n", argv[0]);
        return 2;
    }
    const char *capdir = argv[1], *sub = argv[2], *override_path = NULL;
    long truncate_at = -1, timeout_sec = 15;
    int override_index = -1, list_only = 0;
    for (int i = 3; i < argc; ++i) {
        if (!strcmp(argv[i], "--list")) list_only = 1;
        else if (!strcmp(argv[i], "--truncate") && i + 1 < argc)
            truncate_at = strtol(argv[++i], NULL, 0);
        else if (!strcmp(argv[i], "--timeout") && i + 1 < argc)
            timeout_sec = strtol(argv[++i], NULL, 0);
        else if (!strcmp(argv[i], "--override-bo") && i + 2 < argc) {
            override_index = (int)strtol(argv[++i], NULL, 0);
            override_path = argv[++i];
        } else {
            fprintf(stderr, "bad argument: %s\n", argv[i]);
            return 2;
        }
    }
    if (timeout_sec <= 0 || (override_path && override_index < 0)) return 2;

    unsigned ring = 0, batch_len = 0, batch_off = 0, declared_count = 0;
    unsigned count = read_manifest(capdir, sub, &ring, &batch_len, &batch_off,
                                   &declared_count);
    if (declared_count != count) {
        fprintf(stderr, "manifest object count is %u; parsed %u\n", declared_count, count);
        return 1;
    }
    if (list_only) {
        print_list(sub, ring, batch_len, batch_off, count);
        return 0;
    }
    if (override_path && (unsigned)override_index >= count) {
        fprintf(stderr, "override object index %d is out of range\n", override_index);
        return 2;
    }
    for (unsigned i = 0; i < count; ++i)
        for (unsigned j = 0; j < objects[i].nrelocs; ++j)
            if (!objects[i].relocs[j].domains_known) {
                fprintf(stderr, "refusing replay: object %u relocation %u lacks captured domains; recapture with updated snb-cap.so\n",
                        i, j);
                return 2;
            }
    if (truncate_at >= 0 &&
        ((unsigned long)truncate_at >= (batch_len / 4) ||
         (batch_off & 7u) || (batch_len & 7u))) {
        fprintf(stderr, "invalid truncation point or unaligned captured batch\n");
        return 2;
    }
    if (!batch_len || count == 0) { fprintf(stderr, "empty batch or object list\n"); return 1; }
    if ((uint64_t)batch_off + batch_len > objects[count - 1].size) {
        fprintf(stderr, "batch range exceeds last object size\n");
        return 1;
    }

    drm_fd = open("/dev/dri/renderD128", O_RDWR | O_CLOEXEC);
    if (drm_fd < 0) fail("open renderD128");
    uint32_t new_handles[MAX_OBJECTS];
    for (unsigned i = 0; i < count; ++i) {
        struct saved_object *o = &objects[i];
        if (!o->size || o->size > (64ull << 20)) {
            fprintf(stderr, "object %u has unsupported size=%" PRIu64 "\n", i, o->size);
            return 1;
        }
        new_handles[i] = gem_create(o->size);
        uint8_t *mapping = gem_mmap(new_handles[i], o->size);
        memset(mapping, 0, o->size);
        const char *input_path = (int)i == override_index ? override_path : o->path;
        FILE *input = fopen(input_path, "rb");
        if (!input) {
            fprintf(stderr, "object %u: cannot open %s\n", i, input_path);
            munmap(mapping, o->size);
            return 1;
        }
        size_t got = fread(mapping, 1, o->size, input);
        if (ferror(input)) { fclose(input); fail("read object file"); }
        int extra = (int)i == override_index && got == o->size ? fgetc(input) : EOF;
        fclose(input);
        if (extra != EOF) {
            fprintf(stderr, "override %s is larger than object %u (%" PRIu64 " bytes)\n",
                    input_path, i, o->size);
            munmap(mapping, o->size);
            return 1;
        }
        printf("obj[%u]: loaded %zu/%" PRIu64 " bytes%s\n", i, got,
               o->size, (int)i == override_index ? " (override)" : "");
        if (munmap(mapping, o->size) < 0) fail("munmap GEM object");
    }

    unsigned batch_index = count - 1;
    if (truncate_at >= 0) {
        struct saved_object *batch = &objects[batch_index];
        uint8_t *mapping = gem_mmap(new_handles[batch_index], batch->size);
        uint32_t *words = (uint32_t *)(mapping + batch_off);
        unsigned keep = (unsigned)truncate_at;
        words[keep] = MI_BATCH_BUFFER_END;
        unsigned used = keep + 1;
        if (used & 1u) words[used++] = 0;
        batch_len = used * 4;
        if (munmap(mapping, batch->size) < 0) fail("munmap truncated batch");
        printf("batch truncated to %u dwords (%u bytes)\n", used, batch_len);
    }

    struct drm_i915_gem_exec_object2 *exec_objects =
        calloc(count, sizeof *exec_objects);
    if (!exec_objects) fail("calloc exec objects");
    for (unsigned i = 0; i < count; ++i) {
        struct saved_object *o = &objects[i];
        struct drm_i915_gem_relocation_entry *relocs =
            calloc(o->nrelocs ? o->nrelocs : 1, sizeof *relocs);
        if (!relocs) fail("calloc exec relocations");
        for (unsigned j = 0; j < o->nrelocs; ++j) {
            struct saved_reloc *saved = &o->relocs[j];
            int target = object_index(saved->target, count);
            if (target < 0) {
                fprintf(stderr, "object %u relocation target handle %u is absent\n",
                        i, saved->target);
                return 1;
            }
            relocs[j].target_handle = new_handles[target];
            relocs[j].offset = saved->offset;
            relocs[j].delta = saved->delta;
            relocs[j].read_domains = saved->read_domains;
            relocs[j].write_domain = saved->write_domain;
        }
        exec_objects[i].handle = new_handles[i];
        exec_objects[i].relocation_count = o->nrelocs;
        exec_objects[i].relocs_ptr = (uintptr_t)relocs;
    }

    struct drm_i915_gem_execbuffer2 exec = {0};
    exec.buffers_ptr = (uintptr_t)exec_objects;
    exec.buffer_count = count;
    exec.batch_start_offset = batch_off;
    exec.batch_len = batch_len;
    exec.flags = ring & 3u;
    uint32_t resets_before = 0, resets_after = 0;
    int have_reset_stats = get_reset_count(&resets_before) == 0;
    printf("submitting %s: %u objects, ring=%u, batch=%u bytes, offset=%u\n",
           sub, count, ring & 3u, batch_len, batch_off);
    if (ioctl(drm_fd, DRM_IOCTL_I915_GEM_EXECBUFFER2, &exec) < 0)
        fail("EXECBUFFER2");

    struct drm_i915_gem_wait wait = {
        .bo_handle = new_handles[batch_index],
        .timeout_ns = (int64_t)timeout_sec * 1000000000LL,
    };
    if (ioctl(drm_fd, DRM_IOCTL_I915_GEM_WAIT, &wait) < 0) {
        if (errno == ETIME || errno == EBUSY) {
            fprintf(stderr, "TIMEOUT after %ld s; inspect dmesg before another submission\n",
                    timeout_sec);
            return 3;
        }
        fail("GEM_WAIT");
    }
    int have_after_stats = get_reset_count(&resets_after) == 0;
    if (have_reset_stats && have_after_stats && resets_after != resets_before) {
        fprintf(stderr, "GPU RESET during replay: reset count %u -> %u; batch did not complete cleanly\n",
                resets_before, resets_after);
        return 4;
    }
    if (!have_reset_stats || !have_after_stats)
        fprintf(stderr, "warning: reset statistics unavailable; check dmesg before treating idle as success\n");
    puts("COMPLETE: batch object became idle");
    return 0;
}
