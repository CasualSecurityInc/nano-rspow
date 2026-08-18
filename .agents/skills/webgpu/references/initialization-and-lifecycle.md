# Initialization and lifecycle

Use this reference when creating or reviewing adapter, device, canvas, resize, error, loss, and teardown code.

## Contents

- Capability negotiation
- Device and canvas setup
- Compilation diagnostics
- Canvas sizing
- Device loss
- Teardown

## Negotiate capabilities deliberately

WebGPU requires a secure context. Treat a missing `navigator.gpu`, a missing adapter, and device creation failure as separate outcomes.

Do not request every adapter feature or its maximum limits. That reduces portability and can make `requestDevice()` fail on otherwise usable hardware. Start from the core defaults and request only capabilities required by the selected path.

```ts
async function requestGpu(
  neededFeatures: GPUFeatureName[] = [],
  neededLimits: Record<string, number> = {}
): Promise<{ adapter: GPUAdapter; device: GPUDevice }> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is unavailable; use the fallback experience.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No WebGPU adapter is available.");

  for (const feature of neededFeatures) {
    if (!adapter.features.has(feature)) {
      throw new Error(`Required WebGPU feature is unavailable: ${feature}`);
    }
  }

  for (const [name, value] of Object.entries(neededLimits)) {
    const supported = adapter.limits[name as keyof GPUSupportedLimits];
    if (typeof supported !== "number" || supported < value) {
      throw new Error(`Required WebGPU limit is unavailable: ${name} >= ${value}`);
    }
  }

  const device = await adapter.requestDevice({
    requiredFeatures: neededFeatures,
    requiredLimits: neededLimits,
  });
  return { adapter, device };
}
```

For a reduced mode, filter optional features and select a matching shader/pipeline path. Do not pass an unsupported feature to `requiredFeatures`.

## Configure the canvas once per device

```ts
const context = canvas.getContext("webgpu");
if (!context) throw new Error("Could not create a WebGPU canvas context.");

const format = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device,
  format,
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
  alphaMode: "opaque",
});
```

Use the same `format` in the presentation pipeline target. Acquire `context.getCurrentTexture()` inside the frame; do not retain swapchain textures between frames.

Choose `alphaMode: "opaque"` for an opaque application. With `"premultiplied"`, make the fragment output and blend state consistent with premultiplied canvas composition.

## Surface asynchronous errors

WebGPU validation is intentionally asynchronous. Add labels, a global uncaptured-error handler, scoped errors around fallible operations, and shader compilation diagnostics.

```ts
device.addEventListener("uncapturederror", (event) => {
  console.error("Uncaptured WebGPU error:", event.error);
});

async function checkedModule(
  device: GPUDevice,
  label: string,
  code: string
): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === "error");
  if (errors.length > 0) {
    throw new Error(
      errors
        .map((message) => `${label}:${message.lineNum}:${message.linePos} ${message.message}`)
        .join("\n")
    );
  }
  return module;
}
```

Prefer `createComputePipelineAsync()` and `createRenderPipelineAsync()` during loading or structural rebuilds. They surface `GPUPipelineError` through rejection and avoid doing expensive pipeline work synchronously on the calling task.

Use balanced error scopes for validation or allocation that the application must recover from:

```ts
device.pushErrorScope("validation");
const pipeline = device.createComputePipeline(descriptor);
const error = await device.popErrorScope();
if (error) throw new Error(error.message);
```

Do not wrap the whole application in one long-lived scope; that obscures ownership and can capture unrelated errors.

## Size from rendered CSS pixels

Canvas CSS size and backing-store size are different. Observe the rendered element, multiply by DPR, clamp to `device.limits.maxTextureDimension2D`, and skip no-op assignments.

```ts
function resizeCanvas(canvas: HTMLCanvasElement, device: GPUDevice): boolean {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const max = device.limits.maxTextureDimension2D;
  const width = Math.max(1, Math.min(max, Math.round(rect.width * dpr)));
  const height = Math.max(1, Math.min(max, Math.round(rect.height * dpr)));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}
```

Repeatedly assigning equal `canvas.width` or `canvas.height` clears presentation state and can cause flashes. Recreate size-dependent intermediate textures only after a real size change, and destroy the old textures.

## Handle device loss as a lifecycle transition

`requestDevice()` can return a device that becomes lost immediately or later. Once lost, rebuild from a new adapter/device or move to the fallback; resources from the old device cannot be reused.

```ts
void device.lost.then((info) => {
  if (info.reason === "destroyed") return;
  showFatalError(new Error(`WebGPU device lost: ${info.message || info.reason}`));
});
```

Keep CPU-side descriptors and seed data when recovery matters. Make initialization and destruction idempotent so a lost device can be replaced without overlapping loops or observers.

## Tear down in ownership order

1. Stop `requestAnimationFrame`, timers, workers, and input.
2. Disconnect `ResizeObserver` and other observers.
3. Prevent new command encoding.
4. Destroy owned large buffers, textures, and query sets.
5. Call `context.unconfigure()` for an owned canvas context.
6. Call `device.destroy()` when the application owns the device.

Do not destroy a shared device from a component that only owns some resources.
