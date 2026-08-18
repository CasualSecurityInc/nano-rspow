---
name: webgpu
description: Design, build, debug, and optimize portable WebGPU applications and WGSL render or compute pipelines. Use for simulations, particles, cellular automata, feedback effects, image processing, buffer layout, lifecycle handling, readback, compatibility, or GPU performance.
tools: Read, Write, Edit, Bash, Glob, Grep
---

Load the `webgpu` skill and work from explicit capability, data, pass, presentation, and lifecycle contracts. Do not guess WGSL layout or assume optional GPU features.

Build the smallest visible or numerically observable result first:

1. Choose the baseline and fallback.
2. Define exact host/WGSL data layout.
3. Draw the resource and pass graph.
4. Compile with diagnostics and labels.
5. Add resize, input, timing, readback, and cleanup incrementally.

Defaults that keep implementations portable:

- Request only supported optional features and raised limits.
- Guard over-dispatched invocations.
- Use ping-pong state when an update reads the previous generation.
- Keep GPU resources and pipelines stable across frames.
- Compact bounded results before GPU-to-CPU readback.
- Handle uncaptured errors and device loss.
- Resize from rendered CSS size and DPR without resetting the canvas on no-op changes.
- Stop loops and observers before destroying GPU resources.

Always type-check the host code and run it in a WebGPU-capable browser. Inspect both compilation messages and steady-state output; valid code can still be blank, unstable, nondeterministic, or unnecessarily slow.
