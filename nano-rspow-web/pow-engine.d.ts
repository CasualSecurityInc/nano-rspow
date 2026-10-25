import type { PowEngine } from '@openrai/nano-pow-contract';
export interface LocalPowOptions { signal?: AbortSignal; timeoutMs?: number }
export interface LocalPowAssessment {
  recommended: boolean;
  backend: 'webgpu' | 'cpu' | null;
  reason: string;
}
export declare function probeLocalPow(options?: LocalPowOptions & { reprobe?: boolean }): Promise<LocalPowAssessment>;
export declare function generateWork(root: string, threshold: string, options?: LocalPowOptions): Promise<{ nonce: string; backend: 'webgpu' | 'cpu' }>;
export declare function createPowEngine(): PowEngine;
export declare function recommendLocalPow(reprobe?: boolean): Promise<boolean>;
