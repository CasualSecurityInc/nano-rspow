# Compatibility and capability strategy

Use this reference when choosing browser/device support, optional GPU features, raised limits, fallbacks, or reduced modes.

## Choose product behavior first

Pick one:

1. **Fallback runtime** — preserve the experience with CPU, WebGL, Canvas2D, CSS, image, or video.
2. **Reduced mode** — keep a core WebGPU path but disable expensive or optional effects.
3. **Fail clearly** — explain the requirement and preserve useful navigation/content.

Do not leave a blank canvas.

## Separate the core path from accelerators

Build a baseline using core limits and formats. Add optional paths only after feature detection:

```ts
const wantsF16 = adapter.features.has("shader-f16");
const features: GPUFeatureName[] = wantsF16 ? ["shader-f16"] : [];
const device = await adapter.requestDevice({ requiredFeatures: features });
```

The `shader-f16` path also needs WGSL that enables and uses `f16`; keep a separate `f32` shader or generated variant.

Other capabilities commonly gated:

- `timestamp-query` for GPU timing;
- subgroups and subgroup-size controls;
- storage access for additional texture formats;
- texture compression families;
- depth clip control;
- indirect-first-instance behavior;
- raised binding, buffer, texture, workgroup, and dispatch limits.

Feature names evolve. Confirm them in current WebGPU types/specification before emitting code.

## Check language features separately

WGSL language extensions are exposed through `navigator.gpu.wgslLanguageFeatures`. Do not assume that a newly published WGSL feature is available merely because `navigator.gpu` exists.

Keep the portable layout and shader path as the default. If a language extension changes layout or syntax, generate an explicitly gated variant and validate it on every supported engine.

## Request the minimum raised limit

If the algorithm requires a higher-than-default limit:

1. calculate the actual required value;
2. compare it to `adapter.limits`;
3. request that value, not the adapter maximum;
4. provide a smaller workload or alternative layout when unavailable.

Requesting maxima can reduce portability, increase fingerprinting surface, and make device creation fail without improving the workload.

## Treat compatibility mode as an evolving surface

Recent WebGPU drafts define adapter feature levels such as core and compatibility. Browser availability and type definitions may lag the draft. Use this only when the target runtime is verified; do not put an unguarded draft-only option in the baseline starter.

## Test a support matrix

At minimum test:

- WebGPU unavailable;
- adapter unavailable;
- optional feature unavailable;
- integrated/mobile-class core limits;
- resize and DPR changes;
- device loss or explicit device destruction;
- hidden/zero-sized startup;
- a reduced workload near the minimum target.

When the product supports workers, test `OffscreenCanvas` and worker availability on the actual browser set rather than assuming the window and worker surfaces match.

Record the chosen capability strategy in the deliverable. A WebGPU implementation is incomplete when its unsupported-device behavior is unspecified.
