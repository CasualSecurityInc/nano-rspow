export const enum WorkType {
  Send = 'Send',
  Receive = 'Receive',
  Epoch1 = 'Epoch1',
  Dev = 'Dev'
}
export function generateWork(hashHex: string, workType: WorkType): Promise<string>
export function validateWork(hashHex: string, workHex: string, workType: WorkType): boolean
export function getBackendName(): string
export function recommendLocalPow(): boolean
export function clearPowTuningCache(): boolean
