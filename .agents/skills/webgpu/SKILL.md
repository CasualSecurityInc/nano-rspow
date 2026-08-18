---
name: webgpu
description: Design, implement, debug, review, and optimize portable WebGPU applications and WGSL shaders. Use when building render or compute pipelines; GPU simulations, cellular automata, particles, image processing, feedback effects, or data-parallel workloads; defining buffers, textures, bind groups, and host-shareable layouts; handling canvas sizing, optional features, errors, device loss, readback, and cleanup; or diagnosing validation, correctness, compatibility, and performance problems.
---

# WebGPU

Build the smallest observable GPU result first, then scale it. Treat every WebGPU feature as five explicit contracts:

1. Capability contract: baseline, optional features and limits, fallback.
2. Data contract: WGSL types, byte offsets, strides, usage flags.
3. Pass contract: reads, writes, ordering, ping-pong ownership.
4. Presentation contract: canvas format, physical size, alpha and color.
5. Lifecycle contract: creation, resize, errors, loss and destruction.

Copy [the full Vite starter](assets/starter/) for a new browser project. It contains a typed compute-and-render particle field with ping-pong buffers, compilation diagnostics, resize handling, pointer interaction, device-loss reporting, and cleanup.

## Work from a resource and pass graph

Before writing WGSL, list persistent resources and pass ownership:

```text
CPU seed ─writeBuffer─> state A
                         │
state A ─compute step─> state B ─render─> canvas
state B ─compute step─> state A ─render─> canvas
```

For every pass, record:

- entry point and dispatch/draw dimensions;
- bindings and shader visibility;
- resources read, written or copied;
- state that becomes authoritative after the pass;
- bounds guards and synchronization assumptions.

Use different resources when a pass needs the previous state while producing the next state. A pass boundary orders commands, but it does not make an algorithm with cross-invocation in-place reads deterministic.

## Build in this order

1. Decide whether unsupported WebGPU means fallback, reduced mode, or a clear failure.
2. Request an adapter and only the optional features and raised limits the workload actually uses.
3. Define WGSL structs and calculate exact host offsets and array strides.
4. Allocate persistent resources and label them.
5. Compile shader modules, inspect `getCompilationInfo()`, then create pipelines.
6. Create stable bind groups or rebuild them only when their resources change.
7. Encode a minimal pass, submit it, and verify visible or numeric output.
8. Add resize, input, simulation timing, readback, and teardown one concern at a time.
9. Profile only after correctness is stable at the intended workload.

## Keep these invariants

- Treat `adapter.features` and `adapter.limits` as possibilities. The device exposes only the capabilities requested and granted at `requestDevice()`.
- Never use “all structs are 16-byte aligned” as a packing rule. Calculate `AlignOf`, `SizeOf`, member offsets, array stride, and uniform-specific constraints.
- Guard every over-dispatched compute invocation before accessing resources.
- Keep `workgroupBarrier()` and `storageBarrier()` in uniform control flow for the participating workgroup.
- Do not create buffers, textures, samplers, bind groups, or pipelines every frame unless the workload truly changes their descriptors.
- Avoid full GPU-to-CPU readback in animation or pointer loops. Compact bounded results on the GPU and map a small staging buffer.
- Treat WGSL passed to `createShaderModule()` as executable input. Prefer bundled, reviewed shader source; do not make the application compile network-fetched or end-user-supplied WGSL at runtime by default.
- Resize the canvas backing store from its rendered CSS size and DPR, clamp it to device limits, and skip no-op assignments.
- Surface shader compilation messages, uncaptured errors, pipeline validation failures, and `device.lost`.
- Stop animation and observers before destroying resources; unconfigure owned canvas contexts and destroy the device when appropriate.

## Choose a pattern by workload

| Workload | Start with |
| --- | --- |
| Independent particles or records | Storage buffers, guarded 1D dispatch, instanced render |
| Neighbor-based particles | Spatial binning or tiled neighborhoods before pairwise work |
| Cellular automata or stencils | Ping-pong state, 2D dispatch, fixed simulation cadence |
| Trails, blur or iterative images | Ping-pong textures and explicit compute/render passes |
| Post-processing | Render to an intermediate texture, then composite |
| Interactive inspection | GPU filter/compact pass plus a bounded staging readback |
| Generated or modular shaders | Stable binding contract, composed pass phases, compile diagnostics |

Start with a portable core path. Gate `shader-f16`, timestamp queries, subgroups, storage formats, language extensions, and raised limits as optional accelerators—not silent requirements.

## Load the right detail

- Read [initialization-and-lifecycle.md](references/initialization-and-lifecycle.md) for adapters, devices, features, limits, canvas configuration, loss and cleanup.
- Read [wgsl-data-layout.md](references/wgsl-data-layout.md) before defining or debugging host-shareable buffers.
- Read [compute-patterns.md](references/compute-patterns.md) for workgroups, ping-pong state, fixed steps, grids, barriers and bounded readback.
- Read [rendering-patterns.md](references/rendering-patterns.md) for canvas sizing, instancing, intermediate targets and feedback.
- Read [debugging-and-performance.md](references/debugging-and-performance.md) for compilation messages, error scopes, labels, profiling and symptom-driven diagnosis.
- Read [creative-recipes.md](references/creative-recipes.md) when translating a visual or simulation idea into a pass graph.
- Read [compatibility.md](references/compatibility.md) when choosing fallbacks or optional features.
- Use [current-sources.md](references/current-sources.md) to verify unstable or recently added APIs against living primary sources.

## Validate the result

- Type-check the host code against current `@webgpu/types`; do not hide errors with `@ts-nocheck`.
- Run in a WebGPU-capable browser and inspect compilation messages and uncaptured errors.
- Test zero-sized/hidden startup, resize, DPR changes, background-tab timing, and teardown/recreate.
- Test the fallback or failure UI on a path where `navigator.gpu` is unavailable.
- Confirm buffer sizes, copy offsets, bytes-per-row, dynamic offsets, dispatch counts, and device limits.
- Inspect startup and steady state visually or assert bounded numeric results.
- Compare performance with readback and debug instrumentation disabled.
- When reviewing existing code, report correctness and lifecycle hazards before micro-optimizations.
