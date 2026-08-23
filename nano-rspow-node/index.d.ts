import type { PowEngine } from '@openrai/nano-pow-contract'

export enum WorkType {
  Send = 'Send',
  Receive = 'Receive',
  LegacyEpoch1 = 'LegacyEpoch1',
  /** @deprecated Use LegacyEpoch1. Not for current mainnet epoch blocks. */
  Epoch1 = 'Epoch1',
  Dev = 'Dev'
}

export type WorkThreshold = string & { readonly __brand: 'WorkThreshold' }

export function generateWork(hashHex: string, workType: WorkType): Promise<string>
export function generateWorkWithThreshold(hashHex: string, thresholdHex: string): Promise<string>
export function validateWork(hashHex: string, workHex: string, workType: WorkType): boolean
export function validateWorkWithThreshold(hashHex: string, workHex: string, thresholdHex: string): boolean
export function createPowEngine(): PowEngine
export function getBackendName(): string
export function recommendLocalPow(): boolean
export function clearPowTuningCache(): boolean
export function workTypeToHex(workType: WorkType): WorkThreshold
