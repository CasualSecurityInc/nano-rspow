# WGSL data layout

Use this reference before creating uniform or storage buffers, packing data in JavaScript, or diagnosing corrupt values.

## Contents

- Natural alignment and size
- Struct offsets and array stride
- Uniform-specific constraints
- Mixed scalar packing
- Binding and copy alignment

## Calculate; do not guess

WGSL layout is recursive. For a host-shareable type:

- a member offset is `roundUp(memberAlignment, previousOffset + previousSize)`;
- struct alignment is the maximum member alignment;
- struct size is `roundUp(structAlignment, endOfLastMember)`;
- array stride is `roundUp(elementAlignment, elementSize)`, with additional uniform constraints on the portable baseline.

Common `f32`, `i32`, and `u32` shapes:

| Type | Alignment | Size |
| --- | ---: | ---: |
| scalar | 4 | 4 |
| `vec2<T>` | 8 | 8 |
| `vec3<T>` | 16 | 12 |
| `vec4<T>` | 16 | 16 |
| `mat2x2<f32>` | 8 | 16 |
| `mat3x3<f32>` | 16 | 48 |
| `mat4x4<f32>` | 16 | 64 |

A `vec3<f32>` occupies 12 bytes but requires 16-byte alignment. The next scalar may use offset 12 in a structure when the address-space constraints permit it; an array of `vec3<f32>` has a 16-byte stride.

Use `u32` for host-written flags rather than depending on host boolean packing.

## Storage example

```wgsl
struct Particle {
  position: vec2<f32>, // offset 0, size 8
  velocity: vec2<f32>, // offset 8, size 8
  color: vec4<f32>,    // offset 16, size 16
};                     // alignment 16, size/array stride 32

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
```

The matching JavaScript element contains eight `f32` values:

```ts
const floatsPerParticle = 8;
const stride = floatsPerParticle * Float32Array.BYTES_PER_ELEMENT;
const data = new Float32Array(count * floatsPerParticle);
```

Do not derive byte stride from a TypeScript object shape. Define the binary schema independently and document it next to both packer and WGSL.

## Mixed uniform example

```wgsl
struct Params {
  viewport: vec2<f32>, // 0
  pointer: vec2<f32>,  // 8
  dt: f32,             // 16
  time: f32,           // 20
  pointerActive: u32,  // 24
  count: u32,          // 28
};                     // size 32
```

Pack mixed scalar types with `DataView`:

```ts
const bytes = new ArrayBuffer(32);
const view = new DataView(bytes);
view.setFloat32(0, viewportX, true);
view.setFloat32(4, viewportY, true);
view.setFloat32(8, pointerX, true);
view.setFloat32(12, pointerY, true);
view.setFloat32(16, dt, true);
view.setFloat32(20, time, true);
view.setUint32(24, pointerActive ? 1 : 0, true);
view.setUint32(28, count, true);
device.queue.writeBuffer(paramsBuffer, 0, bytes);
```

A `Float32Array` is not appropriate for fields that WGSL reads as integers; numeric equality does not imply identical bits.

## Uniform-specific constraints

Storage buffers use natural host-shareable layout. Uniform buffers have additional address-space constraints in the portable core:

- fixed-size array element stride is a multiple of 16 bytes;
- nested structure spacing may need 16-byte alignment;
- runtime-sized arrays are not normal uniform members.

Use `@align(...)` or `@size(...)` when the intended binary contract requires explicit padding, or pack uniform arrays into `vec4` slots. Do not call these rules “std140”; follow the current WGSL address-space layout rules.

Newer language features can relax some uniform constraints. Gate those features explicitly and keep a portable layout unless the product controls its runtime.

## Runtime-sized arrays

A runtime-sized array must be the last member of a storage-buffer structure:

```wgsl
struct Records {
  header: vec4<u32>,
  values: array<f32>,
};
```

Use `arrayLength(&records.values)` only where the bound buffer range determines the runtime count. Still pass an explicit logical count when the allocation has spare capacity.

## Alignment outside WGSL structs

Also verify API-level constraints:

- `queue.writeBuffer` buffer offsets and byte counts use 4-byte granularity.
- `copyBufferToBuffer` offsets and size use 4-byte granularity.
- Dynamic uniform offsets are multiples of `device.limits.minUniformBufferOffsetAlignment`.
- Dynamic storage offsets are multiples of `device.limits.minStorageBufferOffsetAlignment`.
- Buffer-to-texture copies normally require `bytesPerRow` to be a multiple of 256.
- Buffer binding sizes must fit the relevant device limit and the actual allocation.

Use a small layout table or tested packer for every shared struct. When generated WGSL changes structure shape, regenerate the packer or fail loudly rather than silently reusing the old stride.
