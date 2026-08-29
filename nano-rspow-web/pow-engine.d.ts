import type { PowEngine } from '@openrai/nano-pow-contract';

/** Create the nano-pow-contract adapter for the WebAssembly/WebGPU engine. */
export declare function createPowEngine(): PowEngine;

/**
 * Return whether this browser should prefer local PoW.
 *
 * The first call performs a capability and CPU-throughput evaluation. Later
 * calls return its cached result unless `reprobe` is `true`.
 */
export declare function recommendLocalPow(reprobe?: boolean): Promise<boolean>;
