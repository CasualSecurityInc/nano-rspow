#include "snb-gpu.h"

int main(int argc, char **argv)
{
    int submit = 0, solve = 0;
    const char *kernel_path = "m3.bin", *root_text = NULL, *dump_path = "m3-results.bin";
    uint64_t base = 0, threshold = 0, max_hashes = 0;
    unsigned threads = 1, lanes = 8, bench_ms = 0, bucket_ms = 0;
    int have_base = 0, have_threshold = 0;
    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "--submit")) submit = 1;
        else if (!strcmp(argv[i], "--solve")) { submit = 1; solve = 1; }
        else if (!strcmp(argv[i], "--kernel") && i + 1 < argc) kernel_path = argv[++i];
        else if (!strcmp(argv[i], "--root") && i + 1 < argc) root_text = argv[++i];
        else if (!strcmp(argv[i], "--base") && i + 1 < argc) { base = parse_u64(argv[++i], "base"); have_base = 1; }
        else if (!strcmp(argv[i], "--threshold") && i + 1 < argc) { threshold = parse_u64(argv[++i], "threshold"); have_threshold = 1; }
        else if (!strcmp(argv[i], "--threads") && i + 1 < argc) threads = (unsigned)parse_u64(argv[++i], "threads");
        else if (!strcmp(argv[i], "--lanes") && i + 1 < argc) lanes = (unsigned)parse_u64(argv[++i], "lanes");
        else if (!strcmp(argv[i], "--bench-ms") && i + 1 < argc) bench_ms = (unsigned)parse_u64(argv[++i], "bench duration");
        else if (!strcmp(argv[i], "--bucket-ms") && i + 1 < argc) bucket_ms = (unsigned)parse_u64(argv[++i], "bucket duration");
        else if (!strcmp(argv[i], "--max-hashes") && i + 1 < argc) max_hashes = parse_u64(argv[++i], "maximum hashes");
        else if (!strcmp(argv[i], "--dump") && i + 1 < argc) dump_path = argv[++i];
        else { fprintf(stderr, "usage: %s [--submit|--solve] --kernel FILE --root HEX64 --base U64 --threads N [--threshold U64] [--max-hashes N] [--dump FILE] [--bench-ms MS]\n", argv[0]); return 2; }
    }
    if (!root_text || !have_base || !threads || threads > MAX_THREADS ||
        (lanes != 8 && lanes != 16) || (base & (lanes - 1u)) ||
        (solve && (!have_threshold || bench_ms))) {
        fputs("root/base required; threads must be 1..4096, lanes 8 or 16, and base lane-aligned\n", stderr); return 2;
    }
    if (base > UINT64_MAX - ((uint64_t)threads * lanes - 1u) ||
        (uint32_t)base + (uint64_t)threads * lanes > (UINT64_C(1) << 32)) {
        fputs("batch crosses a 32-bit nonce boundary or wraps u64; split it at the boundary\n", stderr); return 2;
    }
    uint8_t root[32];
    if (parse_root(root_text, root) < 0) { fputs("root must be 64 hex digits\n", stderr); return 2; }
    uint8_t *kernel = NULL;
    size_t kernel_bytes = read_kernel(kernel_path, &kernel);
    size_t logical_result_bytes = (size_t)threads * lanes * 16u;
    /* Keep one full sentinel page beyond the logical surface, even when its
     * payload is already page-aligned. The surface itself remains logical-sized. */
    size_t results_bytes = (size_t)page_round(logical_result_bytes + 4096u);
    size_t batch_dwords_capacity = 64u + (size_t)threads * 14u;
    size_t batch_bytes = (size_t)page_round(batch_dwords_capacity * sizeof(uint32_t));
    size_t code_bytes = (size_t)page_round(kernel_bytes);
    if (results_bytes > (16u << 20) || batch_bytes > (4u << 20)) {
        fputs("requested dispatch exceeds harness BO limit\n", stderr); return 2;
    }

    if (!submit) {
        printf("dry run: kernel=%zu bytes, threads=%u lanes=%u, results=%zu bytes, batch capacity=%zu bytes; no GPU submission\n",
               kernel_bytes, threads, lanes, logical_result_bytes, batch_bytes);
        free(kernel);
        return 0;
    }
    drm_fd = open("/dev/dri/renderD128", O_RDWR | O_CLOEXEC);
    if (drm_fd < 0) { perror("/dev/dri/renderD128"); return 1; }

    uint32_t results_h = gem_create(results_bytes), state_h = gem_create(STATE_BYTES);
    uint32_t code_h = gem_create(code_bytes), sync_h = gem_create(4096), batch_h = gem_create(batch_bytes);
    uint8_t *state = gem_map(state_h, STATE_BYTES, 1);
    uint8_t *code = gem_map(code_h, code_bytes, 1);
    uint8_t *sync = gem_map(sync_h, 4096, 1);
    uint8_t *results = gem_map(results_h, results_bytes, 1);
    uint32_t *batch = gem_map(batch_h, batch_bytes, 1);
    memset(results, 0xcd, results_bytes);
    memset(code, 0, code_bytes); memcpy(code, kernel, kernel_bytes);
    memset(sync, 0, 4096); memset(batch, 0, batch_bytes);
    free(kernel);

    struct reloc_list state_relocs = {0}, batch_relocs = {0};
    init_state(state, code_h, results_h, &state_relocs, root, threshold, base, logical_result_bytes);
    size_t nwords = build_batch(batch, batch_bytes / 4, threads, state_h, sync_h, &batch_relocs);
    CHECK(munmap(state, STATE_BYTES)); CHECK(munmap(code, code_bytes));
    CHECK(munmap(sync, 4096)); CHECK(munmap(results, results_bytes)); CHECK(munmap(batch, batch_bytes));

    struct drm_i915_gem_exec_object2 objects[5] = {
        { .handle = results_h },
        { .handle = state_h, .relocation_count = state_relocs.count,
          .relocs_ptr = (uintptr_t)state_relocs.entries },
        { .handle = code_h }, { .handle = sync_h },
        { .handle = batch_h, .relocation_count = batch_relocs.count,
          .relocs_ptr = (uintptr_t)batch_relocs.entries },
    };
    uint32_t handles[5] = { results_h, state_h, code_h, sync_h, batch_h };
    (void)handles;

    struct timespec start, now;
    if (bench_ms) {
        clock_gettime(CLOCK_MONOTONIC, &start);
        uint64_t submissions = 0;
        uint64_t bucket_submissions = 0;
        unsigned bucket = 0;
        struct timespec bucket_start = start;
        do {
            uint32_t before;
            if (reset_count(&before) < 0) { perror("reset stats"); return 1; }
            int rc = submit_once(objects, 5, nwords * 4u, batch_h, before);
            if (rc) return rc == -2 ? 5 : 1;
            submissions++;
            clock_gettime(CLOCK_MONOTONIC, &now);
            double bucket_seconds = elapsed_seconds(bucket_start, now);
            if (bucket_ms && bucket_seconds * 1000.0 >= bucket_ms) {
                double rate = (double)(submissions - bucket_submissions) * threads * lanes / bucket_seconds / 1e6;
                printf("BUCKET k=%u elapsed=%.3fs rate=%.3f MH/s full=1 start_ns=%" PRIu64 " end_ns=%" PRIu64 "\n", ++bucket,
                       elapsed_seconds(start, now), rate,
                       (uint64_t)bucket_start.tv_sec * UINT64_C(1000000000) + (uint64_t)bucket_start.tv_nsec,
                       (uint64_t)now.tv_sec * UINT64_C(1000000000) + (uint64_t)now.tv_nsec);
                fflush(stdout);
                bucket_start = now;
                bucket_submissions = submissions;
            }
        } while (elapsed_seconds(start, now) * 1000.0 < bench_ms);
        if (bucket_ms && submissions > bucket_submissions) {
            double seconds = elapsed_seconds(bucket_start, now);
            double rate = (double)(submissions - bucket_submissions) * threads * lanes / seconds / 1e6;
            printf("BUCKET k=%u elapsed=%.3fs rate=%.3f MH/s full=0 start_ns=%" PRIu64 " end_ns=%" PRIu64 "\n", ++bucket,
                   elapsed_seconds(start, now), rate,
                   (uint64_t)bucket_start.tv_sec * UINT64_C(1000000000) + (uint64_t)bucket_start.tv_nsec,
                   (uint64_t)now.tv_sec * UINT64_C(1000000000) + (uint64_t)now.tv_nsec);
        }
        double elapsed = elapsed_seconds(start, now);
        double hashes = (double)submissions * threads * lanes;
        printf("BENCH: threads=%u lanes=%u submissions=%" PRIu64 " hashes=%.0f elapsed=%.6fs rate=%.3f MH/s loadavg=",
               threads, lanes, submissions, hashes, elapsed, hashes / elapsed / 1e6);
        double loads[3];
        if (getloadavg(loads, 3) == 3)
            printf("%.2f %.2f %.2f\n", loads[0], loads[1], loads[2]);
        else puts("unavailable");
    } else if (solve) {
        uint64_t tested = 0, batches = 0, current_base = base;
        uint8_t *mapped_state;
        uint8_t *mapped_results;
        for (;;) {
            mapped_state = gem_map(state_h, STATE_BYTES, 1);
            uint32_t *curbe = (uint32_t *)(mapped_state + ST_CURBE);
            curbe[10] = (uint32_t)current_base;
            curbe[11] = (uint32_t)(current_base >> 32);
            CHECK(munmap(mapped_state, STATE_BYTES));
            mapped_results = gem_map(results_h, results_bytes, 1);
            memset(mapped_results, 0xcd, results_bytes);
            CHECK(munmap(mapped_results, results_bytes));
            uint32_t before;
            if (reset_count(&before) < 0) { perror("reset stats"); return 1; }
            int rc = submit_once(objects, 5, nwords * 4u, batch_h, before);
            if (rc) return rc == -2 ? 5 : 1;
            batches++;
            tested += (uint64_t)threads * lanes;
            mapped_results = gem_map(results_h, results_bytes, 0);
            uint32_t *words = (uint32_t *)mapped_results;
            int found = 0;
            uint64_t found_nonce = 0;
            for (unsigned t = 0; t < threads && !found; ++t) {
                for (unsigned lane = 0; lane < lanes; ++lane) {
                    size_t slot = (size_t)t * lanes * 4u;
                    size_t hit_word = lanes == 8 ? slot + 24u + lane :
                                      slot + (lane / 8u) * 32u + 24u + (lane % 8u);
                    if (words[hit_word] & 1u) {
                        found = 1;
                        found_nonce = current_base + (uint64_t)t * lanes + lane;
                        break;
                    }
                }
            }
            if (found) {
                FILE *out = fopen(dump_path, "wb");
                if (!out) { perror(dump_path); return 1; }
                int ok = fwrite(mapped_results, 1, results_bytes, out) == results_bytes;
                if (fclose(out) || !ok) { fputs("failed to write result dump\n", stderr); return 1; }
                CHECK(munmap(mapped_results, results_bytes));
                printf("SOLVED nonce=0x%016" PRIx64 " tested=%" PRIu64
                       " batches=%" PRIu64 " output=%s root=", found_nonce, tested, batches, dump_path);
                for (unsigned i = 0; i < 32; ++i) printf("%02x", root[i]);
                printf(" threshold=0x%016" PRIx64 " base=0x%016" PRIx64 "\n",
                       threshold, current_base);
                break;
            }
            CHECK(munmap(mapped_results, results_bytes));
            if (max_hashes && tested >= max_hashes) {
                printf("NO HIT: tested=%" PRIu64 " batches=%" PRIu64 "\n", tested, batches);
                return 3;
            }
            uint64_t advance = (uint64_t)threads * lanes;
            if (current_base > UINT64_MAX - advance) {
                fputs("nonce space exhausted\n", stderr); return 4;
            }
            current_base += advance;
            if ((current_base & 0xffffffffu) + advance > (UINT64_C(1) << 32)) {
                /* The batch itself may not straddle a high-word boundary.
                 * An 8-aligned range can advance exactly to the next boundary. */
                current_base = (current_base + 0xffffffffu) & ~UINT64_C(0xffffffff);
            }
            if (!(batches & 255u))
                fprintf(stderr, "progress: tested=%" PRIu64 " next=0x%016" PRIx64 "\n", tested, current_base);
        }
    } else {
        uint32_t before;
        if (reset_count(&before) < 0) { perror("reset stats"); return 1; }
        int rc = submit_once(objects, 5, nwords * 4u, batch_h, before);
        if (rc) return rc == -2 ? 5 : 1;
        results = gem_map(results_h, results_bytes, 0);
        FILE *out = fopen(dump_path, "wb");
        if (!out) { perror(dump_path); return 1; }
        int ok = fwrite(results, 1, results_bytes, out) == results_bytes;
        if (fclose(out) || !ok) { fputs("failed to write result dump\n", stderr); return 1; }
        CHECK(munmap(results, results_bytes));
        printf("COMPLETE (reset-clean): threads=%u lanes=%u hashes=%u output=%s bytes=%zu root=",
               threads, lanes, threads * lanes, dump_path, results_bytes);
        for (unsigned i = 0; i < 32; ++i) printf("%02x", root[i]);
        printf(" base=0x%016" PRIx64 " threshold=0x%016" PRIx64 "\n", base, threshold);
    }
    gem_close(batch_h); gem_close(sync_h); gem_close(code_h); gem_close(state_h); gem_close(results_h);
    CHECK(close(drm_fd));
    return 0;
}
