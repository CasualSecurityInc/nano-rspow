# Debugging and performance

Use this reference when output is blank, corrupt, unstable, slow, device-dependent, or failing validation.

## Contents

- Diagnostics stack
- Symptom-driven debugging
- Performance priorities
- Measurement

## Build a diagnostics stack

Use all four layers during development:

1. Descriptive `label` fields on buffers, textures, bind groups, layouts, pipelines, passes, and encoders.
2. `GPUShaderModule.getCompilationInfo()` for WGSL errors and warnings with line/column data.
3. Short, owned error scopes around fallible validation or allocation.
4. A device-level `uncapturederror` listener and `device.lost` handler.

Prefer async pipeline creation during loading/rebuilds. Catch and display `GPUPipelineError`; a rejected pipeline should not turn into a silent blank canvas.

Insert debug groups or markers around multi-pass command streams:

```ts
encoder.pushDebugGroup("simulation");
encodeGridBuild(encoder);
encodeForces(encoder);
encoder.popDebugGroup();
```

## Keep shader provenance explicit

WGSL passed to `createShaderModule()` is executable program input. Bundle shader
source with the application or generate it only from reviewed, deterministic
fragments. Do not design the application to compile WGSL obtained at runtime
from arbitrary URLs, end-user input, tool responses, model responses, or error
messages by default. Agent-authored WGSL belongs in local source and must pass
normal review, compilation diagnostics, and runtime validation.

If a product explicitly requires runtime shader loading, constrain it as a code
loading boundary: allowlist origins and paths, authenticate the response when
appropriate, verify a pinned digest or signature before compilation, reject
unexpected size/encoding, and keep a bundled safe path. Compilation success is
not a trust check.

## Diagnose by symptom

### Blank canvas

- Confirm non-zero CSS size and backing-store size.
- Confirm context and pipeline target formats match.
- Check that the frame calls `getCurrentTexture()` after context configuration.
- Verify attachment load/store operations and clear color.
- Check clip-space position, winding/culling, viewport/scissor, draw counts, and instance counts.
- Surface compilation and uncaptured validation errors.
- Avoid resetting equal canvas dimensions every frame.

### Compute appears frozen

- Verify dispatch counts are non-zero.
- Check bounds guards and logical count.
- Confirm bind groups reference the current source/destination resources.
- Swap ping-pong ownership after the submitted step.
- Write every destination field needed by the next generation.
- Inspect scalar literal types (`1u`, `1i`, `1.0`) and buffer offsets.

### Corruption starts at a threshold

- Recalculate element stride and total allocation.
- Check spare-capacity logic versus logical count.
- Inspect array and nested-struct uniform constraints.
- Check spatial-bin overflow, atomic capacity, dynamic offsets, and device binding limits.
- Ensure generated shader layout and host packer were rebuilt together.

### Flicker or flashes on resize

- Skip no-op canvas assignments.
- Recreate size-dependent textures and their bind groups atomically.
- Render immediately after a real resize if the animation may be paused.
- Do not use a newly destroyed view or stale bind group.

### Works on one GPU only

- Remove unrequested features and raised limits.
- Check texture-format/sample-type compatibility.
- Test baseline workgroup sizes.
- Gate `f16`, subgroups, timestamps, storage formats, and WGSL language extensions.
- Eliminate out-of-bounds access and race-dependent in-place updates.

## Optimize the largest cost first

Prioritize:

1. Algorithmic complexity and total invocations.
2. GPU/CPU synchronization and readback.
3. Resource churn and pipeline rebuilds.
4. Bandwidth, state size, texture resolution, and overdraw.
5. Bind/draw/dispatch count.
6. Workgroup and memory-access tuning.
7. Shader arithmetic micro-optimizations.

Do not start by changing workgroup size while the workload still performs O(N²) neighbor scans or a full readback each frame.

## Keep recurring allocations out of the frame

Create persistent resources when dimensions and layouts are stable:

- pipelines and layouts;
- samplers;
- simulation and uniform buffers;
- ping-pong textures/buffers;
- bind groups for each ping-pong direction;
- staging buffers for bounded asynchronous readback.

Use `queue.writeBuffer()` for modest recurring updates. For large streaming uploads, compare mapped-at-creation staging or a ring-buffer strategy after profiling.

## Measure without changing semantics

- Record CPU frame time separately from GPU work.
- Gate timestamp queries through the optional `timestamp-query` feature.
- Use browser GPU tooling and implementation-specific diagnostics on target devices.
- Measure startup/pipeline compilation separately from steady-state frames.
- Profile at realistic resolution, state count, pass count, and interaction.
- Disable debug readback and excessive logging for performance measurements.

Use FPS as a symptom, not a complete metric. Track simulation steps per second, state size, dispatch dimensions, bytes uploaded/read back, and dropped catch-up steps where applicable.

After an optimization, re-run correctness checks. Faster race-dependent output is not a valid result.
