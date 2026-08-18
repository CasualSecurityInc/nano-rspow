# Creative and simulation recipes

Use this reference when a request describes an effect or system rather than a specific WebGPU API.

## Start with a visual or numerical sentence

Describe:

- state: particles, cells, pixels, mesh instances, fields;
- evolution: orbit, diffuse, react, flock, propagate, constrain;
- presentation: points, quads, surface, palette, trails, post-process;
- interaction: pointer force, painting, camera, controls;
- budget: count, resolution, steps per second, target devices.

Example: “Twenty thousand cyan particles orbit a soft pointer field and leave slowly diffusing violet trails on desktop WebGPU.”

Translate that sentence into state resources and a pass graph before writing shaders.

## Particle field

Start with:

- two storage buffers containing position, velocity, and color;
- one guarded 1D compute dispatch;
- two compute bind groups for A→B and B→A;
- read-only render bind groups for A and B;
- instanced quads or sprites;
- one small parameter uniform.

Tune initial geometry and velocity before adding forces. Add spatial bins before adding large-radius neighbor behavior. Add a GPU-compacted local query for pointer tools instead of reading every particle.

Copy the complete implementation from [the starter](../assets/starter/).

## Cellular automaton or stencil

Use:

- ping-pong storage buffers or textures;
- an `8 × 8` or similar guarded 2D dispatch;
- rule-owned initial conditions;
- a fixed simulation cadence decoupled from rendering;
- a fullscreen render pass reading the latest generation.

For reaction-diffusion, write both channels on every path and use an initial state that can evolve. For continuous kernels, make neighborhood radius and grid resolution explicit performance controls.

Inspect startup, early evolution, and settled behavior. A valid shader can still receive an inert seed or converge to a featureless state.

## Trails and feedback

Use two scene/history textures:

1. sample history A;
2. apply decay/diffusion and composite new marks into B;
3. present B;
4. swap.

Keep the history format deliberate. Half-float or other extended formats may need optional capability checks; an `rgba8unorm` or render-pass fallback is often more portable.

Do not sample and write the same texture subresource in one pass.

## Fluid or multi-phase simulation

Split the solver into named passes such as:

1. clear/build neighborhood structure;
2. derive density or grid velocity;
3. apply pressure/forces;
4. integrate;
5. iterate constraints;
6. correct velocities;
7. render.

Keep intermediate state sized from the actual program contract. If generated modules add per-element state, regenerate allocation stride with the shader rather than reserving a guessed fixed amount.

## Image processing

Use a sampled input texture and separate output texture. Dispatch in 2D with bounds checks. Introduce workgroup tiles only if neighboring samples are reused enough to offset halo loading and barriers.

For multiple filters, prefer a small pass graph with reusable ping-pong textures. Fuse passes only after measuring bandwidth and ensuring fusion does not obscure correctness or prevent reuse.

## Modular shader systems

Define a descriptor per module:

- stable name and phase;
- inputs and binary layout;
- resources read/written;
- helper WGSL;
- entry-point contribution;
- rebuild triggers versus realtime uniform updates.

Compose a deterministic binding table and emit source maps or line annotations for generated WGSL. Treat changes to buffer shape, bindings, entry points, or workgroup memory as structural rebuilds; treat numeric parameters as uniform/storage updates.

## Iterate in layers

1. Make one pass visible or numerically testable.
2. Establish initial conditions and scale.
3. Add the primary evolution rule.
4. Add rendering and palette.
5. Add interaction.
6. Add one expensive feature at a time.
7. Inspect startup and steady state.
8. Increase count/resolution only after profiling.

Creative success requires coherent motion or evolution, not merely error-free GPU commands.
