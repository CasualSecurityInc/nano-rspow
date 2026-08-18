export interface WebGPUContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  removeErrorHandlers: () => void;
}

export interface CanvasSize {
  width: number;
  height: number;
  changed: boolean;
}

export async function initializeWebGPU(
  canvas: HTMLCanvasElement,
  onError: (message: string) => void,
): Promise<WebGPUContext> {
  if (!navigator.gpu) {
    throw new Error(
      "WebGPU is unavailable. Try a current browser with WebGPU enabled.",
    );
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: "high-performance",
  });
  if (!adapter) {
    throw new Error("No compatible WebGPU adapter was found.");
  }

  // Request only capabilities the application actually needs. This starter
  // uses the baseline feature set, so no optional features or limits are raised.
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) {
    device.destroy();
    throw new Error("Could not create a WebGPU canvas context.");
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: "opaque",
  });

  const handleUncapturedError = (event: GPUUncapturedErrorEvent): void => {
    onError(`WebGPU error: ${event.error.message}`);
  };
  device.addEventListener("uncapturederror", handleUncapturedError);

  void device.lost.then((info) => {
    if (info.reason !== "destroyed") {
      onError(`WebGPU device lost (${info.reason}): ${info.message}`);
    }
  });

  return {
    adapter,
    device,
    context,
    format,
    removeErrorHandlers: () => {
      device.removeEventListener("uncapturederror", handleUncapturedError);
    },
  };
}

export async function createCheckedShaderModule(
  device: GPUDevice,
  label: string,
  code: string,
): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const compilationInfo = await module.getCompilationInfo();
  const messages = compilationInfo.messages.filter(
    (message) => message.type !== "info",
  );

  for (const message of messages) {
    const location =
      message.lineNum > 0 ? `${message.lineNum}:${message.linePos}` : "unknown";
    const text = `${label} ${message.type} at ${location}: ${message.message}`;
    if (message.type === "error") {
      console.error(text);
    } else {
      console.warn(text);
    }
  }

  if (messages.some((message) => message.type === "error")) {
    throw new Error(`${label} failed WGSL validation. Check the console.`);
  }

  return module;
}

export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  device: GPUDevice,
  maximumDevicePixelRatio = 2,
): CanvasSize {
  const pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    maximumDevicePixelRatio,
  );
  const maximumDimension = device.limits.maxTextureDimension2D;
  const width = Math.max(
    1,
    Math.min(Math.round(canvas.clientWidth * pixelRatio), maximumDimension),
  );
  const height = Math.max(
    1,
    Math.min(Math.round(canvas.clientHeight * pixelRatio), maximumDimension),
  );
  const changed = canvas.width !== width || canvas.height !== height;

  if (changed) {
    canvas.width = width;
    canvas.height = height;
  }

  return { width, height, changed };
}
