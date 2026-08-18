# Rendering patterns

Use this reference for canvas presentation, instancing, intermediate textures, feedback, texture formats, blending, depth, and resize.

## Contents

- Presentation and physical pixels
- Render data access
- Instancing and fullscreen passes
- Intermediate and feedback textures
- Render-pass correctness

## Keep presentation state coherent

- Configure the context with the device and one preferred format.
- Use that exact format in the presentation pipeline target.
- Get a fresh current texture view for each presented frame.
- Size the backing store in physical pixels from the rendered CSS rectangle and DPR.
- Reallocate size-dependent depth and intermediate textures only after a real size change.
- Clamp dimensions to `maxTextureDimension2D`.

The canvas backing store may be larger than CSS coordinates. Convert pointer coordinates through the canvas bounding rectangle, then scale by `canvas.width / rect.width` and `canvas.height / rect.height` if shader state uses physical pixels.

## Use read-only storage in render stages

If compute writes particle state and a vertex shader reads it, declare a separate render-side binding:

```wgsl
@group(0) @binding(0) var<storage, read> particles: array<Particle>;
```

Do not reuse a `var<storage, read_write>` declaration in a vertex entry point. Keep compute and render shader modules or entry-point resource contracts explicit.

## Prefer instancing for repeated geometry

Render particles, sprites, lines, or tiles as a small static mesh plus per-instance storage:

```ts
pass.setPipeline(pipeline);
pass.setBindGroup(0, particleBindGroup);
pass.draw(6, particleCount);
```

Use `@builtin(instance_index)` to select the record. This avoids rebuilding vertex buffers when compute already owns the authoritative state.

Use a fullscreen triangle or four-vertex triangle strip for compositing and post-processing. Generate positions from `vertex_index` instead of uploading static fullscreen geometry.

## Treat feedback as explicit ping-pong

A trail or iterative image pipeline usually looks like:

```text
history A ─sample─┐
new marks ────────┼─ decay/diffuse/composite ─> history B
history B ──────────────────────────────────────> canvas
```

Next frame, reverse A and B. Create both textures with the union of usages they actually need, such as:

- `TEXTURE_BINDING` when sampled;
- `STORAGE_BINDING` for storage-texture compute;
- `RENDER_ATTACHMENT` when rasterized into;
- `COPY_SRC` or `COPY_DST` only for real copies/readback.

Do not bind the same subresource simultaneously as sampled input and writable output in one pass.

Check that a storage texture format and access mode are supported by the target path. Keep a render-pass alternative when portability matters.

## Make intermediate ownership obvious

For post-processing:

1. render the scene to an intermediate color texture;
2. end the pass;
3. sample or load it in compute/render post-processing;
4. write a different texture or the canvas;
5. destroy/recreate intermediates after resize.

Cache pipelines, samplers, layouts, and bind groups while their descriptors/resources remain stable. If a texture is recreated, rebuild bind groups that reference its view.

## Set load/store and blending intentionally

Every attachment needs deliberate operations:

- `loadOp: "clear"` for the first writer or explicit reset;
- `loadOp: "load"` only when preserving existing attachment content;
- `storeOp: "store"` when later passes or presentation need the result;
- `storeOp: "discard"` when the result is not consumed.

Choose clear colors and alpha behavior together. For straight-alpha fragment output, use a matching blend state. For opaque canvases, still write defined alpha.

Add depth only when ordering or depth testing needs it. Match depth texture size and sample count to the color attachment. Recreate multisampled and depth attachments together on resize.

## Keep color and sampling assumptions explicit

- Use filterable formats only with filtering samplers.
- Use unfilterable float bindings and non-filtering samplers when required.
- Distinguish normalized, integer, float, depth, and storage texture sample types.
- Clamp or define out-of-bounds behavior in shader logic.
- Gate extended canvas color spaces, tone mapping, and uncommon formats rather than assuming support.

For external images or video, use the current `copyExternalImageToTexture()` or external-texture path and test origin-cleanliness, color conversion, and frame lifetime on target browsers.
