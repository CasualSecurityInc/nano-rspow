# Compute patterns

Use this reference for data-parallel dispatch, simulations, workgroup memory, barriers, ping-pong state, spatial indexing, and readback.

## Contents

- Dispatch and workgroup sizing
- Ping-pong ownership
- Phase-based simulation
- Fixed-step timing
- Neighborhood work
- Bounded readback

## Guard the dispatch

Start with a simple portable workgroup such as 64 threads for a 1D workload or `8 × 8` for a 2D grid. Tune after measuring the intended devices.

```wgsl
override WORKGROUP_SIZE: u32 = 64u;

@compute @workgroup_size(WORKGROUP_SIZE)
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let index = gid.x;
  if (index >= params.count) {
    return;
  }
  // Safe resource access follows.
}
```

Validate all of:

- total invocations against `maxComputeInvocationsPerWorkgroup`;
- each axis against `maxComputeWorkgroupSizeX/Y/Z`;
- workgroup storage against `maxComputeWorkgroupStorageSize`;
- dispatch dimensions against `maxComputeWorkgroupsPerDimension`.

If a logical workload exceeds dispatch limits, add a base index or tile origin and issue multiple dispatches.

Workgroup size is not automatically equal to subgroup size. Gate subgroup operations as an optional path.

## Ping-pong state for previous-generation semantics

When each invocation reads neighboring or otherwise cross-index state from generation N, write generation N+1 to a different resource:

```wgsl
@group(0) @binding(0) var<storage, read> src: array<Cell>;
@group(0) @binding(1) var<storage, read_write> dst: array<Cell>;
```

Create two bind groups:

- A → B
- B → A

After submission, swap the authoritative index. Render from the destination written by the compute pass. Reusing one buffer is safe only when each invocation's reads cannot observe another invocation's writes in a way that changes the algorithm.

The same rule applies to feedback textures: sample one texture and write another.

## Compose phases instead of one giant shader

Use pass boundaries for global dependencies:

1. clear counters or derived state;
2. build spatial bins or precompute state;
3. apply forces or rules;
4. integrate;
5. iterate constraints;
6. correct or compact results;
7. render.

Commands encoded in one command buffer execute in order. Separate compute passes provide the memory visibility needed between dependent dispatches. Do not try to synchronize the entire dispatch with a workgroup barrier; barriers synchronize only a workgroup.

## Keep barriers in uniform control flow

`workgroupBarrier()` and `storageBarrier()` must be reached uniformly by the participating invocations. Do not return some invocations before a barrier:

```wgsl
var<workgroup> tile: array<f32, 64>;

@compute @workgroup_size(64)
fn reduce(
  @builtin(local_invocation_index) localIndex: u32,
  @builtin(global_invocation_id) gid: vec3<u32>
) {
  tile[localIndex] = select(0.0, input[gid.x], gid.x < params.count);
  workgroupBarrier();
  // All invocations reach the barrier, including out-of-range lanes.
}
```

Use a mask or neutral value before the barrier; guard external writes after it.

## Decouple simulation from display

Use an accumulator for fixed-rate simulation and cap catch-up:

```ts
accumulator += Math.min((now - previous) / 1000, 0.1);
let steps = 0;
while (accumulator >= fixedDt && steps < maxStepsPerFrame) {
  encodeStep(encoder, fixedDt);
  accumulator -= fixedDt;
  steps++;
}
if (steps === maxStepsPerFrame) accumulator = 0;
```

Render once per animation frame from the latest state. This keeps simulation speed stable without allowing a backgrounded tab to enqueue an unbounded number of steps.

## Make neighborhood cost explicit

Avoid O(N²) particle scans beyond small demonstrations. A common uniform-grid sequence is:

1. clear per-cell counts;
2. assign each item to a cell with atomics;
3. store or compact item indices per cell;
4. query the nearby cells only;
5. cap neighbors or overflow deliberately.

Choose cell size near the largest query radius. Track overflow rather than silently writing out of bounds. For dense grids or highly variable occupancy, consider count/scan/scatter instead of a fixed maximum per cell.

For image and cellular workloads, load a tile plus halo into workgroup memory only when reuse pays for the extra synchronization and complexity.

## Compact before readback

Do not map a simulation buffer in a frame or pointer loop. Filter or reduce on the GPU into a bounded output:

```wgsl
let outputIndex = atomicAdd(&resultCount, 1u);
if (outputIndex < params.capacity) {
  results[outputIndex] = Candidate(index, score);
}
```

Then:

1. copy the small count buffer to `MAP_READ`;
2. map it and clamp to capacity;
3. copy/map only the bounded result range;
4. report whether the atomic count exceeded capacity.

`mapAsync()` waits until prior GPU use of that buffer is complete. Avoid an additional `queue.onSubmittedWorkDone()` unless the application truly needs all previously submitted queue work to finish; it widens the stall.

For recurring small readbacks, rotate through staging buffers so the CPU reads an older result while the GPU produces the next one. Keep the latency explicit.
