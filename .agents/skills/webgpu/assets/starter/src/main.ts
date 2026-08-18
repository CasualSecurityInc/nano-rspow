import "./style.css";
import {
  createCheckedShaderModule,
  initializeWebGPU,
  syncCanvasSize,
} from "./gpu.ts";
import { COMPUTE_SHADER, RENDER_SHADER } from "./shaders.ts";

const PARTICLE_STRIDE = 8;
const PARTICLE_STRIDE_BYTES = PARTICLE_STRIDE * Float32Array.BYTES_PER_ELEMENT;
const PARAMS_SIZE_BYTES = 32;
const WORKGROUP_SIZE = 64;

const canvasElement = document.querySelector("canvas");
if (!(canvasElement instanceof HTMLCanvasElement)) {
  throw new Error("The starter page is missing its canvas element.");
}
const canvas = canvasElement;

const statusElement = document.querySelector(".status");
if (!(statusElement instanceof HTMLElement)) {
  throw new Error("The starter page is missing its status element.");
}
const status = statusElement;

function setStatus(message: string, isError = false): void {
  status.textContent = message;
  status.dataset.error = String(isError);
}

function createParticles(
  count: number,
  width: number,
  height: number,
): Float32Array {
  const particles = new Float32Array(count * PARTICLE_STRIDE);
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const maximumRadius = Math.min(width, height) * 0.42;

  for (let index = 0; index < count; index += 1) {
    const offset = index * PARTICLE_STRIDE;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * maximumRadius;
    const tangentSpeed = 20 + Math.random() * 85;
    const hue = index / count;

    particles[offset] = centerX + Math.cos(angle) * radius;
    particles[offset + 1] = centerY + Math.sin(angle) * radius;
    particles[offset + 2] = -Math.sin(angle) * tangentSpeed;
    particles[offset + 3] = Math.cos(angle) * tangentSpeed;
    particles[offset + 4] = 0.25 + 0.55 * Math.sin(hue * Math.PI);
    particles[offset + 5] = 0.45 + 0.5 * Math.sin(hue * Math.PI * 2 + 2);
    particles[offset + 6] = 0.75 + 0.25 * Math.cos(hue * Math.PI * 2);
    particles[offset + 7] = 0.72;
  }

  return particles;
}

async function start(): Promise<() => void> {
  const gpu = await initializeWebGPU(canvas, (message) => {
    setStatus(message, true);
  });
  const { device, context, format } = gpu;
  const initialSize = syncCanvasSize(canvas, device);
  const particleCount =
    initialSize.width < 900 || initialSize.height < 700 ? 12_000 : 28_000;
  const initialParticles = createParticles(
    particleCount,
    initialSize.width,
    initialSize.height,
  );
  const stateBufferSize = particleCount * PARTICLE_STRIDE_BYTES;

  const stateBuffers = [0, 1].map((index) => {
    const buffer = device.createBuffer({
      label: `particle state ${index}`,
      size: stateBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(buffer, 0, initialParticles);
    return buffer;
  });
  const paramsBuffer = device.createBuffer({
    label: "frame parameters",
    size: PARAMS_SIZE_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const [computeModule, renderModule] = await Promise.all([
    createCheckedShaderModule(device, "particle compute shader", COMPUTE_SHADER),
    createCheckedShaderModule(device, "particle render shader", RENDER_SHADER),
  ]);
  const [computePipeline, renderPipeline] = await Promise.all([
    device.createComputePipelineAsync({
      label: "particle update pipeline",
      layout: "auto",
      compute: { module: computeModule, entryPoint: "compute_main" },
    }),
    device.createRenderPipelineAsync({
      label: "particle render pipeline",
      layout: "auto",
      vertex: { module: renderModule, entryPoint: "vertex_main" },
      fragment: {
        module: renderModule,
        entryPoint: "fragment_main",
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: "src-alpha",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add",
              },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    }),
  ]);

  const computeBindGroups = stateBuffers.map((source, index) =>
    device.createBindGroup({
      label: `compute state ${index} to ${1 - index}`,
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer: source } },
        { binding: 2, resource: { buffer: stateBuffers[1 - index]! } },
      ],
    }),
  );
  const renderBindGroups = stateBuffers.map((buffer, index) =>
    device.createBindGroup({
      label: `render state ${index}`,
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuffer } },
        { binding: 1, resource: { buffer } },
      ],
    }),
  );

  const params = new ArrayBuffer(PARAMS_SIZE_BYTES);
  const paramsView = new DataView(params);
  const pointer = { x: initialSize.width * 0.5, y: initialSize.height * 0.5 };
  let pointerActive = false;
  let sourceIndex = 0;
  let previousTime = performance.now();
  let animationFrame = 0;
  let stopped = false;

  const updatePointer = (event: PointerEvent): void => {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = (event.clientX - bounds.left) * (canvas.width / bounds.width);
    pointer.y = (event.clientY - bounds.top) * (canvas.height / bounds.height);
  };
  const handlePointerMove = (event: PointerEvent): void => {
    updatePointer(event);
    pointerActive = true;
  };
  const handlePointerDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    updatePointer(event);
    pointerActive = true;
  };
  const handlePointerEnd = (event: PointerEvent): void => {
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    pointerActive = false;
  };
  const handlePointerLeave = (): void => {
    pointerActive = false;
  };

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerEnd);
  canvas.addEventListener("pointercancel", handlePointerEnd);
  canvas.addEventListener("pointerleave", handlePointerLeave);

  const resizeObserver = new ResizeObserver(() => {
    syncCanvasSize(canvas, device);
  });
  resizeObserver.observe(canvas);

  const frame = (time: number): void => {
    if (stopped) {
      return;
    }

    const size = syncCanvasSize(canvas, device);
    const deltaTime = Math.min(Math.max((time - previousTime) / 1000, 0), 0.05);
    previousTime = time;

    paramsView.setFloat32(0, size.width, true);
    paramsView.setFloat32(4, size.height, true);
    paramsView.setFloat32(8, pointer.x, true);
    paramsView.setFloat32(12, pointer.y, true);
    paramsView.setFloat32(16, deltaTime, true);
    paramsView.setFloat32(20, time / 1000, true);
    paramsView.setUint32(24, pointerActive ? 1 : 0, true);
    paramsView.setUint32(28, particleCount, true);
    device.queue.writeBuffer(paramsBuffer, 0, params);

    const destinationIndex = 1 - sourceIndex;
    const encoder = device.createCommandEncoder({ label: "particle frame" });
    const computePass = encoder.beginComputePass({ label: "update particles" });
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroups[sourceIndex]);
    computePass.dispatchWorkgroups(
      Math.ceil(particleCount / WORKGROUP_SIZE),
    );
    computePass.end();

    const renderPass = encoder.beginRenderPass({
      label: "draw particles",
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.015, g: 0.012, b: 0.045, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroups[destinationIndex]);
    renderPass.draw(6, particleCount);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    sourceIndex = destinationIndex;
    animationFrame = requestAnimationFrame(frame);
  };

  setStatus(
    `${particleCount.toLocaleString()} particles · compute + instanced render`,
  );
  animationFrame = requestAnimationFrame(frame);

  return () => {
    stopped = true;
    cancelAnimationFrame(animationFrame);
    resizeObserver.disconnect();
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointerup", handlePointerEnd);
    canvas.removeEventListener("pointercancel", handlePointerEnd);
    canvas.removeEventListener("pointerleave", handlePointerLeave);
    paramsBuffer.destroy();
    for (const buffer of stateBuffers) {
      buffer.destroy();
    }
    gpu.removeErrorHandlers();
    context.unconfigure();
    device.destroy();
  };
}

let cleanup: (() => void) | undefined;
try {
  cleanup = await start();
} catch (error) {
  console.error(error);
  setStatus(error instanceof Error ? error.message : String(error), true);
}

window.addEventListener(
  "beforeunload",
  () => {
    cleanup?.();
  },
  { once: true },
);
