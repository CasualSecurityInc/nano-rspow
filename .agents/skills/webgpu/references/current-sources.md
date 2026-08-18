# Current primary sources

WebGPU and WGSL continue to evolve. Use these living primary sources when an API, feature name, limit, layout rule, browser behavior, or shader capability may have changed.

## Specifications and types

- [Latest published WebGPU specification](https://www.w3.org/TR/webgpu/)
- [WebGPU editor's draft](https://gpuweb.github.io/gpuweb/)
- [Latest published WGSL specification](https://www.w3.org/TR/WGSL/)
- [WGSL editor's draft](https://gpuweb.github.io/gpuweb/wgsl/)
- [GPUWeb API type reference](https://gpuweb.github.io/types/)
- [Official WebGPU TypeScript definitions](https://github.com/gpuweb/types)

Prefer the latest published W3C draft for portable normative behavior. Check the editor's draft when reviewing a newly added API, then verify browser implementation before using it.

## Design and conformance

- [WebGPU explainer](https://gpuweb.github.io/gpuweb/explainer/)
- [WebGPU conformance test suite](https://github.com/gpuweb/cts)
- [GPU for the Web issue tracker](https://github.com/gpuweb/gpuweb/issues)

Use the explainer for ownership, mapping, error, and device-loss rationale. Use the CTS and issue tracker to distinguish a specification rule from an implementation bug or unresolved design.

## Browser implementation notes

- [Chrome WebGPU documentation](https://developer.chrome.com/docs/web-platform/webgpu/)
- [WebKit WebGPU updates](https://webkit.org/blog/category/webgpu/)
- [Firefox graphics development](https://mozillagfx.wordpress.com/)

Browser-vendor documentation is useful for rollout status, flags, platform coverage, and implementation diagnostics. Do not substitute a single implementation's extension or behavior for the portable WebGPU contract.

## Verification checklist

Before using a recently added surface:

1. Confirm it in current WebGPU/WGSL definitions.
2. Check whether it is core, an optional device feature, or a WGSL language feature.
3. Check browser and platform implementation status.
4. Add a feature/limit/language probe.
5. Keep a core fallback or clear unsupported path.
6. Test shader compilation and pipeline creation on the target engines.
