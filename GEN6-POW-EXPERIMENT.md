# Proof of Work on a GPU That Officially Couldn’t

*An experiment in running Nano proof-of-work on Intel’s Sandy Bridge graphics—and in letting evidence overrule a good story.*

The machine is `lemox.lan`, an aging Lenovo homelab host with an Intel Core i5-2540M and integrated HD Graphics 3000. Its CPU could already generate Nano proof-of-work. The GPU path in the CLI expected newer hardware, and Intel’s supported OpenCL route did not cover this generation.

That left a narrower question: could the GPU’s execution units run this workload through some other path?

We tried the Sandy Bridge media pipeline. It was designed to dispatch video-processing kernels, not to provide a general compute API. But it could dispatch EU instructions, and Nano’s proof-of-work kernel needed no communication between work items. Each item hashes one nonce and compares the result with a threshold. There is no shared-memory exchange or cross-thread coordination to implement.

The plan was to write one kernel in Gen6 EU assembly, submit it through i915’s media commands, and connect it to the existing CLI through a small OpenCL adapter.

## We stopped trusting hand-packed commands

The first rule was simple: do not submit a command dword because it looks right.

We checked command layouts against the Sandy Bridge Programmer’s Reference Manual, used Mesa definitions as a cross-check, and assembled EU instructions with `intel-gen4asm`. Most useful was a live capture of VAAPI submitting media work on this exact machine. An `LD_PRELOAD` shim recorded its execbuf submissions, buffers, and relocations during an H.264 encode.

That capture corrected our assumptions more than once. A hand-packed six-dword `MEDIA_OBJECT` caused a GPU reset. The working VAAPI packet was fourteen dwords. A surface width went into the wrong bits. An assembly subregister that looked like a dword index was actually a byte offset.

We also learned not to trust a successful wait by itself. After a GPU reset, the completion ioctl could report success because the batch had stopped running. We began checking i915 reset counts around each submission. A run counted only if the reset count stayed unchanged and its output matched the expected values.

First light came by transplant. We replayed VAAPI’s captured batch, then replaced its kernel buffer with our own two-instruction kernel: send the end-of-thread message. It completed. Our code had executed on the HD 3000’s EUs under a known-working dispatch.

## Prove the channels before hashing

We used small kernels to test one part of the path at a time. They wrote 16, 128, and 256 bytes to a results buffer, with guard regions to catch overruns. Other probes checked constant data delivery, per-thread inline data, indexed writes from multiple threads, SIMD lane variation, and 64-bit arithmetic.

Each probe had an exact expected output. Python served as an independent oracle for arithmetic and hashes. The GPU reset counter served as a separate validity check.

Once those pieces worked, we generated the Blake2b kernel. The Nano input was a 64-bit nonce followed by a 32-byte root. Blake2b processes that 40-byte input in one final block, producing an eight-byte digest. The kernel interprets that digest as a little-endian 64-bit value and compares it with the requested threshold.

One media thread handles eight nonces in SIMD8 mode. A later version handles sixteen in SIMD16. Each lane receives a different nonce through EU regioning. We verified lane variation directly rather than assuming that a media thread exposed a useful lane identifier.

Gen6 also lacked the add-with-carry instruction we first expected to use. We replaced it with an add, a comparison that sets per-lane flags, and a predicated increment of the high word. The resulting kernel matched Python’s `hashlib` across the tested inputs, carry cases, thresholds, and nonce boundaries.

## The measured result depends on temperature

The best tested kernel used SIMD16 and predicated carry. It reached about 13.6 million hashes per second during its warm-start burst. In a 120-second run, it averaged 9.03 MH/s. As the GPU clock fell with temperature, the final rate settled around 7.4 MH/s.

| Measurement | Rate |
|---|---:|
| Warm-start burst | 13.6 MH/s |
| 120-second mean | 9.03 MH/s |
| Late-run rate near 719 MHz | 7.4–7.8 MH/s |
| CPU backend reference | about 3.3 MH/s |

The GPU reached a reported 98 °C during the sustained run. Clock-normalized throughput stayed near 98% of its initial value, so the rate decline tracked the clock decline closely. The measurements describe this host and its cooling, not a general Sandy Bridge performance guarantee.

Moving from SIMD8 to SIMD16 improved measured throughput by roughly 1.3–1.5 times, not two times. Wider vectors helped, but the result did not support our initial assumption that instruction throughput would remain constant across widths. We kept the measured rates and dropped the speculative explanation.

At the measured rates, average receive-tier work took about 0.62 seconds on the GPU versus 2.55 seconds on the CPU. Average send-tier work took about 50 seconds versus 163 seconds. Search times vary because proof-of-work hits follow a geometric distribution. One lucky solve is not a throughput benchmark.

The solver rehashes every GPU-reported hit on the CPU before publishing it. A GPU error could waste time, but it cannot cause the program to publish an unchecked candidate.

## A narrow OpenCL adapter connects it to the CLI

The final integration was a small, experimental ICD that recognizes the project’s `pow_kernel` source and sends its work to the Sandy Bridge engine. The Rust CLI source stayed unchanged, though the binary had to be rebuilt with its OpenCL feature enabled.

This adapter is not a general OpenCL driver. It supports the API path needed by this one kernel. It does not compile arbitrary OpenCL programs. If the submitted source does not match the expected kernel, it fails cleanly rather than running something incompatible.

With the adapter installed, the existing CLI could select its OpenCL backend and run Nano work through the media engine. The benchmark and generated work were then checked through the CLI’s validation path.

## What the experiment produced

The result is more than a feasibility answer. There is a standalone Linux solver, a reusable engine library, the restricted ICD, the kernel generator, tested kernel binaries, build and installation scripts, and logs from the hardware runs.

Those deliverables remain specific to this setup: Linux, i915, Sandy Bridge media dispatch, and the Nano kernel contract. They are not a portable compute stack. The measurements also argue against treating this host as an unrestricted mining appliance. Its sustained rate depends on its thermal and power limits.

Still, the hardware did the work. The support gap was real: Intel did not provide the general compute driver we wanted. That did not make the execution units incapable of running the kernel. It meant we had to find a path the existing software stack had not packaged for us.

The project advanced when we let instruments veto our assumptions. The PRM corrected command semantics. VAAPI’s capture supplied working packets. The assembler resolved instruction syntax. Python checked arithmetic and hashes. Reset counters caught false completions.

That was the useful result: a working Nano proof-of-work engine on a GPU that had no supported compute API for it, with each published candidate checked before it left the process.
