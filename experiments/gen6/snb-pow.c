/* Standalone Nano work solver; GPU batch/state encoding shared with M3. */
#include "snb-gpu.h"
#include "blake8.h"
#include "snb-engine-api.h"
#include <pthread.h>
#include <stdatomic.h>
#include <stdbool.h>

struct search {
    uint64_t root[4], threshold, next, remaining;
    bool bounded, exhausted;
    pthread_mutex_t lock;
    atomic_bool stop;
    atomic_int error;
    atomic_uint_fast64_t cpu_tested, gpu_tested;
    bool found;
    uint64_t nonce, hash;
    const char *winner;
};

/* Serialize reservations, not hashing. Each reservation stops at a low-word
 * boundary and u64 end; workers never search overlapping nonce ranges. */
static uint64_t reserve(struct search *s, uint64_t wanted, uint64_t *base)
{
    pthread_mutex_lock(&s->lock);
    uint64_t count = 0;
    if (!s->exhausted && !atomic_load(&s->stop)) {
        count = wanted;
        uint64_t boundary = (UINT64_C(1) << 32) - (uint32_t)s->next;
        if (count > boundary) count = boundary;
        if (s->bounded && count > s->remaining) count = s->remaining;
        *base = s->next;
        if (count) {
            if (count - 1 == UINT64_MAX - s->next) s->exhausted = true;
            else s->next += count;
            if (s->bounded) {
                s->remaining -= count;
                if (!s->remaining) s->exhausted = true;
            }
        } else s->exhausted = true;
    }
    pthread_mutex_unlock(&s->lock);
    return count;
}

static void claim(struct search *s, uint64_t nonce, uint64_t hash, const char *by)
{
    pthread_mutex_lock(&s->lock);
    if (!atomic_load(&s->stop)) {
        s->nonce = nonce; s->hash = hash; s->winner = by; s->found = true;
        atomic_store(&s->stop, true); /* publish only after writing result */
    }
    pthread_mutex_unlock(&s->lock);
}

static void scalar_range(struct search *s, uint64_t base, uint64_t count)
{
    uint64_t tested = 0;
    while (tested < count && !atomic_load_explicit(&s->stop, memory_order_relaxed)) {
        uint64_t nonce = base + tested;
        uint64_t hash = blake8_hash(nonce, s->root);
        ++tested;
        if (hash >= s->threshold) { claim(s, nonce, hash, "cpu"); break; }
    }
    atomic_fetch_add(&s->cpu_tested, tested);
}

static void *cpu_worker(void *arg)
{
    struct search *s = arg;
    uint64_t base, count;
    while ((count = reserve(s, 4096, &base))) scalar_range(s, base, count);
    return NULL;
}

static int gpu_search(struct search *s, const uint8_t root[32], const char *kernel_path,
                      unsigned threads, unsigned lanes)
{
    snb_engine *engine = snb_engine_open(kernel_path, lanes);
    if (!engine) { fprintf(stderr, "%s\n", snb_engine_error()); return snb_engine_error_code(); }
    uint64_t base, count;
    int rc = 0;
    struct timespec last, now;
    clock_gettime(CLOCK_MONOTONIC, &last);
    while ((count = reserve(s, (uint64_t)threads * lanes, &base))) {
        struct snb_result result;
        int hit = snb_engine_search(engine, root, base, count, s->threshold, &result);
        atomic_fetch_add(&s->gpu_tested, result.gpu_hashes);
        atomic_fetch_add(&s->cpu_tested, result.cpu_hashes);
        if (hit < 0) { fprintf(stderr, "%s\n", snb_engine_error()); rc = snb_engine_error_code(); break; }
        if (hit) { claim(s, result.nonce, result.hash, result.on_gpu ? "gpu" : "cpu"); break; }
        clock_gettime(CLOCK_MONOTONIC, &now);
        if (elapsed_seconds(last, now) >= 5) {
            fprintf(stderr, "PROGRESS gpu=%" PRIuFAST64 " cpu=%" PRIuFAST64 "\n",
                    atomic_load(&s->gpu_tested), atomic_load(&s->cpu_tested));
            last=now;
        }
    }
    snb_engine_close(engine);
    return rc;
}

int main(int argc, char **argv)
{
    const char *mode = "gpu", *root_text = NULL, *kernel = NULL;
    uint64_t base = 0, threshold = 0, max_hashes = 0;
    long online = sysconf(_SC_NPROCESSORS_ONLN);
    unsigned lanes = 16, threads = 4096;
    unsigned workers = online > 3 ? 3u : online > 1 ? (unsigned)online - 1u : 1u;
    bool have_threshold = false, have_workers = false;
    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "--help")) {
            puts("snb-pow --root HEX64 --threshold U64 [--mode gpu|cpu|hybrid] (default gpu)\n"
                 "  --kernel FILE       built 12-round predicated kernel (default SIMD16)\n"
                 "  --lanes 8|16        kernel width; must match the built blob\n"
                 "  --base U64          aligned first nonce (default 0)\n"
                 "  --threads 1..4096   GPU media packets per batch (default 4096)\n"
                 "  --cpu-workers 1..8  default: 1 in hybrid; min(3, online-1), at least 1 in cpu\n"
                 "  --max-hashes N      exact global work limit; 0 means unbounded\n"
                 "Exit 0: CPU-verified work; 3: no hit/exhausted; 5: GPU reset; 1/2: error.\n"
                 "A final partial GPU vector is searched on the CPU and counted separately.");
            return 0;
        }
        if (i + 1 >= argc) { fprintf(stderr, "missing value for %s\n", argv[i]); return 2; }
        const char *key = argv[i++], *value = argv[i];
        if (!strcmp(key, "--mode")) mode = value;
        else if (!strcmp(key, "--root")) root_text = value;
        else if (!strcmp(key, "--kernel")) kernel = value;
        else if (!strcmp(key, "--base")) base = parse_u64(value, "base");
        else if (!strcmp(key, "--threshold")) { threshold = parse_u64(value, "threshold"); have_threshold = true; }
        else if (!strcmp(key, "--max-hashes")) max_hashes = parse_u64(value, "max hashes");
        else if (!strcmp(key, "--lanes")) { uint64_t v = parse_u64(value, "lanes"); if (v != 8 && v != 16) return 2; lanes = (unsigned)v; }
        else if (!strcmp(key, "--threads")) { uint64_t v = parse_u64(value, "threads"); if (!v || v > MAX_THREADS) return 2; threads = (unsigned)v; }
        else if (!strcmp(key, "--cpu-workers")) { uint64_t v = parse_u64(value, "workers"); if (!v || v > 8) return 2; workers = (unsigned)v; have_workers = true; }
        else { fprintf(stderr, "unknown option %s\n", key); return 2; }
    }
    if (!root_text || !have_threshold || (base & (lanes - 1u)) ||
        (strcmp(mode, "cpu") && strcmp(mode, "gpu") && strcmp(mode, "hybrid"))) {
        fputs("usage: snb-pow --root HEX64 --threshold U64 [--mode gpu|cpu|hybrid] "
              "[--kernel FILE] [--lanes 8|16] [--base U64] [--threads 1..4096] "
              "[--cpu-workers 1..8] [--max-hashes N]\n", stderr); return 2;
    }
    uint8_t root[32];
    if (parse_root(root_text, root) < 0) { fputs("invalid root\n", stderr); return 2; }
    if (!have_workers && !strcmp(mode, "hybrid")) workers = 1;
    char default_kernel[4096];
    if (!kernel) {
        const char *name = lanes == 16 ? "m3-12-l16-pred.bin" : "m3-12-l8-pred.bin";
        char executable[4096];
        ssize_t length = readlink("/proc/self/exe", executable, sizeof executable - 1);
        if (length > 0 && (size_t)length < sizeof executable - 1) {
            executable[length] = '\0';
            char *slash = strrchr(executable, '/');
            if (slash) {
                *slash = '\0';
                int n = snprintf(default_kernel, sizeof default_kernel, "%s/%s", executable, name);
                if (n < 0 || (size_t)n >= sizeof default_kernel) return 2;
                kernel = default_kernel;
            }
        }
        if (!kernel) kernel = name;
    }
    struct search s = { .threshold = threshold, .next = base,
        .remaining = max_hashes, .bounded = max_hashes != 0,
        .lock = PTHREAD_MUTEX_INITIALIZER, .stop = ATOMIC_VAR_INIT(false),
        .error = ATOMIC_VAR_INIT(0), .cpu_tested = ATOMIC_VAR_INIT(0),
        .gpu_tested = ATOMIC_VAR_INIT(0) };
    for (unsigned i = 0; i < 4; ++i)
        for (unsigned b = 0; b < 8; ++b) s.root[i] |= (uint64_t)root[i * 8 + b] << (8 * b);
    struct timespec begin, end;
    clock_gettime(CLOCK_MONOTONIC, &begin);
    pthread_t ids[8]; unsigned started = 0;
    if (strcmp(mode, "gpu")) {
        for (unsigned i = 0; i < workers; ++i) {
            int e = pthread_create(&ids[started], NULL, cpu_worker, &s);
            if (e) { fprintf(stderr, "pthread_create: %s\n", strerror(e)); atomic_store(&s.error, 1); atomic_store(&s.stop, true); break; }
            ++started;
        }
    }
    int rc = 0;
    if (strcmp(mode, "cpu") && !atomic_load(&s.stop)) rc = gpu_search(&s, root, kernel, threads, lanes);
    if (rc) { atomic_store(&s.error, rc); atomic_store(&s.stop, true); }
    for (unsigned i = 0; i < started; ++i) pthread_join(ids[i], NULL);
    clock_gettime(CLOCK_MONOTONIC, &end);
    double wall = elapsed_seconds(begin, end);
    uint64_t gpu = atomic_load(&s.gpu_tested), cpu = atomic_load(&s.cpu_tested);
    if (s.found && !atomic_load(&s.error)) {
        printf("SOLVED mode=%s by=%s workers=%u lanes=%u nonce=0x%016" PRIx64 " h0=0x%016" PRIx64
               " threshold=0x%016" PRIx64 " root=%s\n", mode, s.winner, started, lanes,
               s.nonce, s.hash, threshold, root_text);
    } else printf("%s mode=%s\n", atomic_load(&s.error) ? "ERROR" : "NO HIT", mode);
    printf("STATS wall=%.6fs gpu=%" PRIu64 " cpu=%" PRIu64 " total=%" PRIu64
           " gpu_rate=%.3f cpu_rate=%.3f total_rate=%.3f MH/s\n",
           wall, gpu, cpu, gpu + cpu, gpu / wall / 1e6, cpu / wall / 1e6, (gpu + cpu) / wall / 1e6);
    pthread_mutex_destroy(&s.lock);
    return atomic_load(&s.error) ? atomic_load(&s.error) : s.found ? 0 : 3;
}
