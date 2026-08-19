/* tslint:disable */
/* eslint-disable */

export class GenerateResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly is_gpu: boolean;
    readonly nonce: string;
}

/**
 * A cancellation handle that can be passed to `generate_work_gpu` and
 * called from JavaScript to stop the GPU batch loop.
 */
export class WasmCancelToken {
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    constructor();
}

/**
 * Asynchronously generate Proof of Work for a 32-byte block hash (hex).
 *
 * Tries WebGPU first, then falls back to single-threaded CPU WASM.
 */
export function generate_work(hash_hex: string, threshold_hex: string): Promise<GenerateResult>;

/**
 * Synchronously generate Proof of Work forcing single-threaded WASM CPU execution.
 */
export function generate_work_cpu(hash_hex: string, threshold_hex: string): GenerateResult;

/**
 * Try up to max_nonces nonces in a single synchronous batch.
 * Returns the nonce as a hex string if found, or `null` if the batch
 * was exhausted. RNG state persists across calls.
 */
export function generate_work_cpu_batch(hash_hex: string, threshold_hex: string, max_nonces: number): any;

/**
 * Asynchronously generate Proof of Work forcing WebGPU execution.
 *
 * Pass a `WasmCancelToken` created via `new WasmCancelToken()` and call
 * `.cancel()` on it from JavaScript to abort the GPU batch loop (e.g. on timeout).
 */
export function generate_work_gpu(hash_hex: string, threshold_hex: string, cancel_token: WasmCancelToken): Promise<GenerateResult>;

/**
 * Synchronously validate if a nonce meets the difficulty threshold for a given block hash.
 */
export function validate_work(hash_hex: string, nonce_hex: string, threshold_hex: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_generateresult_free: (a: number, b: number) => void;
    readonly __wbg_wasmcanceltoken_free: (a: number, b: number) => void;
    readonly generate_work: (a: number, b: number, c: number, d: number) => any;
    readonly generate_work_cpu: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly generate_work_cpu_batch: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly generate_work_gpu: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly generateresult_is_gpu: (a: number) => number;
    readonly generateresult_nonce: (a: number) => [number, number];
    readonly validate_work: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly wasmcanceltoken_cancel: (a: number) => void;
    readonly wasmcanceltoken_new: () => number;
    readonly wasm_bindgen__convert__closures_____invoke__h494390435fc5ceaa: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h08e8530b2c1a3586: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h01517a4dd6c2751e: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
