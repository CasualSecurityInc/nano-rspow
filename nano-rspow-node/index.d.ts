import type { PowEngine } from '@openrai/nano-pow-contract'

/** Current Nano mainnet work presets. */
export enum WorkType {
  Send = 'Send',
  Receive = 'Receive'
}

/** Historical presets for use with explicit custom-threshold APIs. */
export enum LegacyWorkType {
  Epoch1 = 'Epoch1'
}

/** Test-only presets for use with explicit custom-threshold APIs. */
export enum TestingWorkType {
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
export function legacyWorkTypeToHex(workType: LegacyWorkType): WorkThreshold
export function testingWorkTypeToHex(workType: TestingWorkType): WorkThreshold
