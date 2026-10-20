#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <unistd.h>
#include <i915_drm.h>

static int (*real_ioctl)(int, unsigned long, ...);
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static uint64_t bo_size[65536];
static char capdir[512];
static unsigned seq;
static int initialized;
static int capture_only;

static int call_ioctl(int fd, unsigned long req, void *arg)
{
    if (!real_ioctl) real_ioctl = dlsym(RTLD_NEXT, "ioctl");
    return real_ioctl(fd, req, arg);
}

static void dump_bo(int fd, uint32_t handle, uint64_t size, const char *name)
{
    if (!size || size > (4ull << 20)) return;
    struct drm_i915_gem_mmap m = { .handle = handle, .size = size };
    if (call_ioctl(fd, DRM_IOCTL_I915_GEM_MMAP, &m) < 0) return;
    char path[1200]; snprintf(path, sizeof path, "%s/%s", capdir, name);
    FILE *f = fopen(path, "wb");
    if (f) { fwrite((void *)(uintptr_t)m.addr_ptr, 1, size, f); fclose(f); }
    munmap((void *)(uintptr_t)m.addr_ptr, size);
}

int ioctl(int fd, unsigned long req, ...)
{
    if (!real_ioctl) real_ioctl = dlsym(RTLD_NEXT, "ioctl");
    va_list ap; va_start(ap, req); void *arg = va_arg(ap, void *); va_end(ap);
    if (!initialized) {
        const char *d = getenv("CAP_DIR"); if (!d) d = "/tmp/snbcap";
        mkdir(d, 0777); snprintf(capdir, sizeof capdir, "%s", d);
        capture_only = getenv("CAP_ONLY") && !strcmp(getenv("CAP_ONLY"), "1");
        initialized = 1;
    }
    if (req == DRM_IOCTL_I915_GEM_CREATE) {
        int rc = call_ioctl(fd, req, arg);
        if (!rc) {
            struct drm_i915_gem_create *c = arg;
            pthread_mutex_lock(&lock);
            if (c->handle < 65536) bo_size[c->handle] = c->size;
            pthread_mutex_unlock(&lock);
        }
        return rc;
    }
    if (req == DRM_IOCTL_GEM_CLOSE) {
        struct drm_gem_close *c = arg;
        pthread_mutex_lock(&lock);
        if (c->handle < 65536) bo_size[c->handle] = 0;
        pthread_mutex_unlock(&lock);
    }
    if (req == DRM_IOCTL_I915_GEM_EXECBUFFER2 || req == DRM_IOCTL_I915_GEM_EXECBUFFER2_WR) {
        pthread_mutex_lock(&lock);
        unsigned s = ++seq;
        struct drm_i915_gem_execbuffer2 *eb = arg;
        struct drm_i915_gem_exec_object2 *objs = NULL;
        if (eb->buffer_count && eb->buffer_count <= 4096) {
            objs = malloc(eb->buffer_count * sizeof *objs);
            if (objs) memcpy(objs, (void *)(uintptr_t)eb->buffers_ptr,
                             eb->buffer_count * sizeof *objs);
        }
        char path[600]; snprintf(path, sizeof path, "%s/sub-%03u.manifest", capdir, s);
        FILE *mf = fopen(path, "w");
        if (mf && objs) {
            fprintf(mf, "seq %u ring %llu batch_len %u batch_off %u count %u\n", s,
                    (unsigned long long)(eb->flags & 0x3), eb->batch_len,
                    eb->batch_start_offset, eb->buffer_count);
            for (unsigned i = 0; i < eb->buffer_count; i++) {
                uint32_t h = objs[i].handle;
                uint64_t sz = h < 65536 ? bo_size[h] : 0;
                fprintf(mf, "obj %u %u %llu %u %llu %llu %llu\n", i, h,
                        (unsigned long long)sz, objs[i].relocation_count,
                        (unsigned long long)objs[i].alignment,
                        (unsigned long long)objs[i].offset,
                        (unsigned long long)objs[i].flags);
                if (objs[i].relocation_count && objs[i].relocation_count <= 4096) {
                    struct drm_i915_gem_relocation_entry *rl =
                        malloc(objs[i].relocation_count * sizeof *rl);
                    if (rl) {
                        memcpy(rl, (void *)(uintptr_t)objs[i].relocs_ptr,
                               objs[i].relocation_count * sizeof *rl);
                        for (unsigned j = 0; j < objs[i].relocation_count; j++)
                            fprintf(mf, "reloc %llu %u %llu %u %u\n",
                                    (unsigned long long)rl[j].offset,
                                    rl[j].target_handle,
                                    (unsigned long long)rl[j].delta,
                                    rl[j].read_domains, rl[j].write_domain);
                        free(rl);
                    }
                }
                if (sz) {
                    snprintf(path, sizeof path, "bo-%03u-%u-%u.bin", s, i, h);
                    dump_bo(fd, h, sz, path);
                }
            }
            fclose(mf);
        } else if (mf) fclose(mf);
        free(objs);
        pthread_mutex_unlock(&lock);
        if (capture_only) {
            errno = ECANCELED;
            return -1;
        }
    }
    return call_ioctl(fd, req, arg);
}
