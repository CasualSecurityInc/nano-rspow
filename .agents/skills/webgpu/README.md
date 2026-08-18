# WebGPU Skill

An agent skill for designing, implementing, debugging, and optimizing portable WebGPU applications and WGSL shaders.

The guidance is framework-agnostic and covers render and compute pipelines, simulations, feedback effects, exact WGSL data layout, lifecycle resilience, bounded readback, compatibility, and performance. A typed Vite starter demonstrates the recommendations as a complete application.

## Install

Review the source in this repository, then use the current installation flow shown
on the [skills.sh catalog page](https://skills.sh/cazala/webgpu-skill/webgpu).

## Package

- [SKILL.md](SKILL.md) routes agents through the core workflow and task-specific references.
- [references/](references/) contains focused guidance and official living sources.
- [assets/starter/](assets/starter/) is a copyable, typed WebGPU particle application.
- [scripts/validate.mjs](scripts/validate.mjs) validates skill structure and resilience hooks.
- [agents/](agents/) provides agent-facing metadata.

## Validate

```sh
npm ci
npm test
```
