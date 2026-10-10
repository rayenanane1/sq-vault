import { baseSepolia } from 'viem/chains'
import { KEYS, load } from './storage'

export const chain = baseSepolia
export const EXPLORER = 'https://sepolia.basescan.org'
export const PUBLIC_RPC = 'https://sepolia.base.org'

// Circle's official test USDC on Base Sepolia
export const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
export const USDC_DECIMALS = 6

// Arachnid deterministic CREATE2 deployer, present on Base Sepolia
export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as const
export const MODULE_SALT = '0x5351566175c74ccc0000000000000000000000000000000000000000000000a1' as const

// Uniswap Permit2, same address on every chain. Used for the approved dApp demo.
export const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const

export type Settings = {
  pimlicoKey: string
  stepUpLimitUsdc: number // above this amount a transfer needs step up checks
  recoveryDelaySec: number // 48h in production, short for the live demo
  clientName: string
}

export const DEFAULT_SETTINGS: Settings = {
  pimlicoKey: (import.meta.env.VITE_PIMLICO_API_KEY as string | undefined) ?? '',
  stepUpLimitUsdc: 5,
  recoveryDelaySec: 120,
  clientName: 'Rayen Anane',
}

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>(KEYS.settings, {}) }
}

export function bundlerUrl() {
  const key = getSettings().pimlicoKey.trim()
  return key
    ? `https://api.pimlico.io/v2/${chain.id}/rpc?apikey=${key}`
    : `https://public.pimlico.io/v2/${chain.id}/rpc`
}

export function hasPaymaster() {
  return getSettings().pimlicoKey.trim().length > 0
}

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`
