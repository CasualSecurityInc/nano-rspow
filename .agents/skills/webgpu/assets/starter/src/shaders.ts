export const COMPUTE_SHADER = /* wgsl */ `
struct Particle {
  position: vec2f,
  velocity: vec2f,
  color: vec4f,
}

struct Params {
  viewport: vec2f,
  pointer: vec2f,
  delta_time: f32,
  time: f32,
  pointer_active: u32,
  particle_count: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> source: array<Particle>;
@group(0) @binding(2) var<storage, read_write> destination: array<Particle>;

fn wrap(value: f32, extent: f32) -> f32 {
  return value - floor(value / extent) * extent;
}

@compute @workgroup_size(64)
fn compute_main(@builtin(global_invocation_id) invocation: vec3u) {
  let index = invocation.x;
  if (index >= params.particle_count) {
    return;
  }

  var particle = source[index];
  let center = params.viewport * 0.5;
  let to_center = center - particle.position;
  let center_distance = max(length(to_center), 1.0);
  let tangent = vec2f(-to_center.y, to_center.x) / center_distance;

  var acceleration = to_center * 0.2 + tangent * 42.0;
  if (params.pointer_active != 0u) {
    let from_pointer = particle.position - params.pointer;
    let pointer_distance = max(length(from_pointer), 8.0);
    acceleration +=
      from_pointer / pointer_distance * (16000.0 / pointer_distance);
  }

  particle.velocity += acceleration * params.delta_time;
  particle.velocity *= exp(-0.32 * params.delta_time);

  let speed = length(particle.velocity);
  if (speed > 320.0) {
    particle.velocity *= 320.0 / speed;
  }

  particle.position += particle.velocity * params.delta_time;
  particle.position = vec2f(
    wrap(particle.position.x, max(params.viewport.x, 1.0)),
    wrap(particle.position.y, max(params.viewport.y, 1.0)),
  );

  destination[index] = particle;
}
`;

export const RENDER_SHADER = /* wgsl */ `
struct Particle {
  position: vec2f,
  velocity: vec2f,
  color: vec4f,
}

struct Params {
  viewport: vec2f,
  pointer: vec2f,
  delta_time: f32,
  time: f32,
  pointer_active: u32,
  particle_count: u32,
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) local_position: vec2f,
  @location(1) color: vec4f,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

const QUAD = array(
  vec2f(-1.0, -1.0),
  vec2f( 1.0, -1.0),
  vec2f(-1.0,  1.0),
  vec2f(-1.0,  1.0),
  vec2f( 1.0, -1.0),
  vec2f( 1.0,  1.0),
);

@vertex
fn vertex_main(
  @builtin(vertex_index) vertex_index: u32,
  @builtin(instance_index) instance_index: u32,
) -> VertexOutput {
  let particle = particles[instance_index];
  let local_position = QUAD[vertex_index];
  let speed = length(particle.velocity);
  let radius = 1.5 + min(speed / 140.0, 2.5);
  let pixel_position = particle.position + local_position * radius;
  let clip_position = vec2f(
    pixel_position.x / params.viewport.x * 2.0 - 1.0,
    1.0 - pixel_position.y / params.viewport.y * 2.0,
  );
  let pulse = 0.8 + 0.2 * sin(params.time * 1.7 + f32(instance_index) * 0.013);

  var output: VertexOutput;
  output.position = vec4f(clip_position, 0.0, 1.0);
  output.local_position = local_position;
  output.color = vec4f(particle.color.rgb * pulse, particle.color.a);
  return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let edge = 1.0 - smoothstep(0.55, 1.0, length(input.local_position));
  if (edge <= 0.001) {
    discard;
  }
  return vec4f(input.color.rgb, input.color.a * edge);
}
`;
