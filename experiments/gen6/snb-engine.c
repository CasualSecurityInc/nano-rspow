#define _GNU_SOURCE
#include "snb-engine-api.h"
#include "snb-engine.h"
#include "blake8.h"
/* Only the proven state/command packers are reused below. External failures
 * use the fallible helpers here, never the standalone header's CHECK/exit. */
#include "snb-gpu.h"
#include <dlfcn.h>
#include <stdarg.h>
#include <stdbool.h>

struct snb_engine {
    int fd;
    unsigned lanes, active;
    uint32_t h[5], resets;
    size_t rs, bs, logical, nwords;
    uint8_t *state;
    uint32_t *results, *batch;
    struct reloc_list sr, br;
    struct drm_i915_gem_exec_object2 objects[5];
    bool failed;
};
static _Thread_local char error_text[320];
static _Thread_local int error_code=1;
int snb_engine_error_code(void) { return error_code; }
const char *snb_engine_error(void) { return error_text; }
static int fail(const char *format, ...)
{
    va_list ap; va_start(ap, format);
    vsnprintf(error_text, sizeof error_text, format, ap);
    va_end(ap); return -1;
}
static int call(snb_engine *e, unsigned long request, void *arg)
{
    if (ioctl(e->fd, request, arg) < 0)
        return fail("i915 ioctl 0x%lx: %s", request, strerror(errno));
    return 0;
}
static int domain(snb_engine *e, uint32_t handle, int write)
{
    struct drm_i915_gem_set_domain d = {.handle=handle,
        .read_domains=I915_GEM_DOMAIN_CPU, .write_domain=write ? I915_GEM_DOMAIN_CPU : 0};
    return call(e, DRM_IOCTL_I915_GEM_SET_DOMAIN, &d);
}
static void *map_bo(snb_engine *e, uint32_t handle, size_t size)
{
    if (domain(e, handle, 1)) return NULL;
    struct drm_i915_gem_mmap m = {.handle=handle, .size=size};
    if (call(e, DRM_IOCTL_I915_GEM_MMAP, &m)) return NULL;
    return (void *)(uintptr_t)m.addr_ptr;
}
static int resets(snb_engine *e)
{
    struct drm_i915_reset_stats r = {0};
    if (call(e, DRM_IOCTL_I915_GET_RESET_STATS, &r)) return -1;
    if (r.reset_count != e->resets) {
        error_code=5;
        return fail("GPU reset invalidated engine: %u -> %u", e->resets, r.reset_count);
    }
    return 0;
}
void snb_engine_close(snb_engine *e)
{
    if (!e) return;
    if (e->state) munmap(e->state, STATE_BYTES);
    if (e->results) munmap(e->results, e->rs);
    if (e->batch) munmap(e->batch, e->bs);
    if (e->fd >= 0) {
        if (getenv("SNBCL_DEBUG") && e->h[0]) {
            struct drm_i915_reset_stats r={0};
            if (!ioctl(e->fd,DRM_IOCTL_I915_GET_RESET_STATS,&r))
                fprintf(stderr,"snb-engine: reset_start=%u reset_end=%u\n",e->resets,r.reset_count);
        }
        for (unsigned i=0; i<5; ++i) if (e->h[i]) {
            struct drm_gem_close c = {.handle=e->h[i]};
            ioctl(e->fd, DRM_IOCTL_GEM_CLOSE, &c);
        }
        close(e->fd);
    }
    free(e);
}
static int default_path(char path[4096], unsigned lanes)
{
    const char *env = getenv("SNBCL_KERNEL");
    if (env) {
        if (snprintf(path,4096,"%s",env)>=4096) return fail("kernel path too long");
        return 0;
    }
    Dl_info info;
    if (!dladdr((void *)&snb_engine_open,&info) || !info.dli_fname)
        return fail("cannot locate engine binary; provide kernel path");
    char resolved[4096];
    if (!realpath(info.dli_fname,resolved)) return fail("resolve engine path: %s",strerror(errno));
    char *slash=strrchr(resolved,'/');
    if (!slash) return fail("engine path lacks directory");
    *slash=0;
    if (snprintf(path,4096,"%s/m3-12-l%u-pred.bin",resolved,lanes)>=4096)
        return fail("kernel path too long");
    return 0;
}
snb_engine *snb_engine_open(const char *path, unsigned lanes)
{
    error_text[0]=0; error_code=1;
    if (lanes!=8 && lanes!=16) { error_code=2; fail("engine width must be 8 or 16"); return NULL; }
    char selected[4096];
    if (!path) { if (default_path(selected,lanes)) return NULL; path=selected; }
    FILE *f=fopen(path,"rb");
    if (!f) { error_code=2; fail("open kernel %s: %s",path,strerror(errno)); return NULL; }
    size_t bytes=lanes==16 ? ENGINE16_BYTES : ENGINE8_BYTES;
    uint8_t *blob=malloc(bytes);
    if (!blob) { fclose(f); fail("allocate kernel"); return NULL; }
    size_t got=fread(blob,1,bytes,f); int extra=fgetc(f), io_error=ferror(f); fclose(f);
    uint64_t sum=UINT64_C(0xcbf29ce484222325);
    for (size_t i=0; i<got; ++i) sum=(sum^blob[i])*UINT64_C(0x100000001b3);
    if (got!=bytes || extra!=EOF || io_error || sum!=(lanes==16 ? ENGINE16_CHECKSUM : ENGINE8_CHECKSUM)) {
        free(blob); error_code=2; fail("kernel checksum/width mismatch: %s",path); return NULL;
    }
    snb_engine *e=calloc(1,sizeof *e);
    if (!e) { free(blob); fail("allocate engine"); return NULL; }
    const char *device=getenv("SNBCL_DEVICE");
    e->fd=open(device ? device : "/dev/dri/renderD128",O_RDWR|O_CLOEXEC);
    if (e->fd<0) { fail("open render node: %s",strerror(errno)); goto bad; }
    int chipset=0;
    struct drm_i915_getparam gp={.param=I915_PARAM_CHIPSET_ID,.value=&chipset};
    if (call(e,DRM_IOCTL_I915_GETPARAM,&gp)) goto bad;
    if (chipset!=0x0126) { fail("unsupported PCI device 0x%04x; this engine is pinned to lemox GT2",chipset); goto bad; }
    struct drm_i915_reset_stats r={0};
    if (call(e,DRM_IOCTL_I915_GET_RESET_STATS,&r)) goto bad;
    e->resets=r.reset_count; e->lanes=lanes;
    e->logical=(size_t)MAX_THREADS*lanes*16;
    e->rs=page_round(e->logical+4096); e->bs=page_round((64+(size_t)MAX_THREADS*14)*4);
    size_t sizes[5]={e->rs,STATE_BYTES,page_round(bytes),4096,e->bs};
    for (unsigned i=0; i<5; ++i) {
        struct drm_i915_gem_create c={.size=sizes[i]};
        if (call(e,DRM_IOCTL_I915_GEM_CREATE,&c)) goto bad;
        e->h[i]=c.handle;
    }
    e->state=map_bo(e,e->h[1],STATE_BYTES);
    e->results=map_bo(e,e->h[0],e->rs);
    e->batch=map_bo(e,e->h[4],e->bs);
    if (!e->state || !e->results || !e->batch) goto bad;
    uint8_t *code=map_bo(e,e->h[2],sizes[2]);
    if (!code) goto bad;
    memset(code,0,sizes[2]); memcpy(code,blob,bytes); munmap(code,sizes[2]);
    uint8_t *sync=map_bo(e,e->h[3],4096);
    if (!sync) goto bad;
    memset(sync,0,4096); munmap(sync,4096);
    memset(e->results,0xcd,e->rs); memset(e->batch,0,e->bs);
    uint8_t root[32]={0};
    init_state(e->state,e->h[2],e->h[0],&e->sr,root,0,0,e->logical);
    for (unsigned i=0; i<5; ++i) e->objects[i].handle=e->h[i];
    e->objects[1].relocation_count=e->sr.count;
    e->objects[1].relocs_ptr=(uintptr_t)e->sr.entries;
    e->objects[4].relocs_ptr=(uintptr_t)e->br.entries;
    if (getenv("SNBCL_DEBUG")) fprintf(stderr,"snb-engine: open PCI=0126 SIMD%u resets=%u kernel=%s\n",lanes,e->resets,path);
    free(blob); return e;
bad:
    free(blob); snb_engine_close(e); return NULL;
}

int snb_engine_search(snb_engine *e, const uint8_t root[32], uint64_t base,
                      uint64_t count, uint64_t threshold, struct snb_result *r)
{
    error_code=1;
    if (!e || !root || !r) return fail("invalid engine search arguments");
    memset(r,0,sizeof *r);
    if (e->failed) return fail("engine previously failed; reopen it");
    uint64_t root4[4]={0};
    for (unsigned i=0; i<32; ++i) root4[i/8]|=(uint64_t)root[i]<<(8*(i%8));
    while (count) {
        if ((base&(e->lanes-1)) || count<e->lanes) {
            uint64_t n=e->lanes-(base&(e->lanes-1));
            if (n>count) n=count;
            for (uint64_t i=0; i<n; ++i) {
                uint64_t nonce=base+i, hash=blake8_hash(nonce,root4);
                ++r->cpu_hashes;
                if (hash>=threshold) { r->nonce=nonce; r->hash=hash; return 1; }
            }
            base+=n; count-=n; continue;
        }
        uint64_t n=count/e->lanes;
        if (n>MAX_THREADS) n=MAX_THREADS;
        uint64_t boundary=((UINT64_C(1)<<32)-(uint32_t)base)/e->lanes;
        if (n>boundary) n=boundary;
        unsigned active=(unsigned)n;
        if (domain(e,e->h[1],1) || resets(e)) goto bad;
        uint32_t *curbe=(uint32_t *)(e->state+ST_CURBE);
        for (unsigned i=0;i<8;++i) memcpy(&curbe[i],root+i*4,4);
        curbe[8]=(uint32_t)threshold; curbe[9]=(uint32_t)(threshold>>32);
        curbe[10]=(uint32_t)base; curbe[11]=(uint32_t)(base>>32);
        if (e->active!=active) {
            if (domain(e,e->h[4],1)) goto bad;
            e->br.count=0;
            e->nwords=build_batch(e->batch,e->bs/4,active,e->h[1],e->h[3],&e->br);
            e->objects[4].relocation_count=e->br.count; e->active=active;
        }
        struct drm_i915_gem_execbuffer2 exec={.buffers_ptr=(uintptr_t)e->objects,
            .buffer_count=5,.batch_len=e->nwords*4,.flags=I915_EXEC_RENDER};
        if (call(e,DRM_IOCTL_I915_GEM_EXECBUFFER2,&exec)) goto bad;
        struct drm_i915_gem_wait wait={.bo_handle=e->h[4],.timeout_ns=INT64_C(60)*1000000000};
        if (call(e,DRM_IOCTL_I915_GEM_WAIT,&wait) || resets(e) || domain(e,e->h[0],0)) goto bad;
        r->gpu_hashes+=(uint64_t)active*e->lanes;
        for (size_t i=e->logical/4; i<e->rs/4; ++i)
            if (e->results[i]!=GUARD_WORD) { fail("GPU guard modified"); goto bad; }
        for (unsigned t=0; t<active; ++t) for (unsigned lane=0; lane<e->lanes; ++lane) {
            size_t off=(size_t)t*e->lanes*4+(lane/8)*32+lane%8;
            uint64_t nonce=base+(uint64_t)t*e->lanes+lane;
            if (e->results[off]!=(uint32_t)nonce || e->results[off+24]>1) {
                fail("invalid/stale GPU output"); goto bad;
            }
            if (e->results[off+24]) {
                uint64_t hash=blake8_hash(nonce,root4);
                uint64_t recorded=e->results[off+8]|((uint64_t)e->results[off+16]<<32);
                if (hash!=recorded || hash<threshold) { fail("GPU candidate failed CPU verification"); goto bad; }
                r->nonce=nonce; r->hash=hash; r->on_gpu=1; return 1;
            }
        }
        uint64_t advanced=(uint64_t)active*e->lanes;
        base+=advanced; count-=advanced;
    }
    return 0;
bad:
    e->failed=true; return -1;
}
