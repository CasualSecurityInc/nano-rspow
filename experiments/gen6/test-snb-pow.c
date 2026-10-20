/* Test the production allocator itself at low-word/u64 boundaries and
 * concurrently; this test never opens a GPU device. */
#define main solver_main
#include "snb-pow.c"
#undef main
#include <assert.h>

static void init_search(struct search *s, uint64_t base, uint64_t count)
{
    memset(s, 0, sizeof *s);
    s->next = base; s->remaining = count; s->bounded = true;
    assert(!pthread_mutex_init(&s->lock, NULL));
    atomic_init(&s->stop, false); atomic_init(&s->error, 0);
    atomic_init(&s->cpu_tested, 0); atomic_init(&s->gpu_tested, 0);
}

static unsigned char coverage[100003];
static void *reserve_worker(void *arg)
{
    struct search *s = arg;
    uint64_t base, count;
    while ((count = reserve(s, 4096, &base))) {
        assert(base + count <= sizeof coverage);
        for (uint64_t i = base; i < base + count; ++i)
            __atomic_fetch_add(&coverage[i], 1, __ATOMIC_RELAXED);
    }
    return NULL;
}

int main(void)
{
    struct search s;
    init_search(&s, UINT64_C(0xfffffff0), 100);
    uint64_t base;
    assert(reserve(&s, 64, &base) == 16 && base == UINT64_C(0xfffffff0));
    assert(reserve(&s, 64, &base) == 64 && base == UINT64_C(0x100000000));
    assert(reserve(&s, 64, &base) == 20 && base == UINT64_C(0x100000040));
    assert(reserve(&s, 64, &base) == 0);
    pthread_mutex_destroy(&s.lock);
    init_search(&s, UINT64_MAX - 15, 100);
    assert(reserve(&s, 65536, &base) == 16 && base == UINT64_MAX - 15);
    assert(reserve(&s, 65536, &base) == 0);
    pthread_mutex_destroy(&s.lock);
    init_search(&s, 0, sizeof coverage);
    pthread_t workers[8];
    for (unsigned i = 0; i < 8; ++i) assert(!pthread_create(&workers[i], NULL, reserve_worker, &s));
    for (unsigned i = 0; i < 8; ++i) assert(!pthread_join(workers[i], NULL));
    for (unsigned i = 0; i < sizeof coverage; ++i) assert(coverage[i] == 1);
    claim(&s, 12, 34, "test");
    claim(&s, 56, 78, "loser");
    assert(s.found && s.nonce == 12 && s.hash == 34 && atomic_load(&s.stop));
    pthread_mutex_destroy(&s.lock);
    puts("PASS allocator: exact concurrent coverage, no overlaps, low-word/u64 boundaries, single published winner");
    return 0;
}
