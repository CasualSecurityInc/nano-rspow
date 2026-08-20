export const enum WorkType {
  Send = 'Send',
  Receive = 'Receive',
  LegacyEpoch1 = 'LegacyEpoch1',
  /** @deprecated Use LegacyEpoch1. Not for current mainnet epoch blocks. */
  Epoch1 = 'Epoch1',
  Dev = 'Dev'
}

export type WorkThreshold = string & { readonly __brand: 'WorkThreshold' }

export function generateWork(hashHex: string, workType: WorkType): Promise<string>
export function validateWork(hashHex: string, workHex: string, workType: WorkType): boolean
export function getBackendName(): string
export function recommendLocalPow(): boolean
export function clearPowTuningCache(): boolean
export function workTypeToHex(workType: WorkType): WorkThreshold
