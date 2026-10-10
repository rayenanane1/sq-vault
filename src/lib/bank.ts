import type { Address, Hex } from 'viem'
import { getSettings } from './config'
import { KEYS, load, save } from './storage'

// MOCK of Swissquote core banking. In production this is the Swissquote backend.
export type BankClient = {
  clientNumber: string
  name: string
  chf: number
  custodialBtc: number
  linkedWallet?: Address
  ownershipProof?: { message: string; signature: Hex; verifiedAt: number }
  riskProfile: 'standard' | 'elevated'
}

export function getClient(): BankClient {
  return load<BankClient>(KEYS.bankDb, {
    clientNumber: '1048 2219',
    name: getSettings().clientName,
    chf: 25430.15,
    custodialBtc: 0.152,
    riskProfile: 'standard',
  })
}

export function updateClient(patch: Partial<BankClient>) {
  save(KEYS.bankDb, { ...getClient(), ...patch })
}

export function ownershipMessage(c: BankClient, wallet: Address) {
  return [
    'Swissquote wallet ownership declaration',
    `Client: ${c.name} (${c.clientNumber})`,
    `Wallet: ${wallet}`,
    'I confirm that I alone control this self custody wallet.',
    `Date: ${new Date().toISOString()}`,
  ].join('\n')
}
