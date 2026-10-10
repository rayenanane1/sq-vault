import { decodeFunctionData, erc20Abi, formatUnits, getAddress, isAddress, maxUint256, type Address } from 'viem'
import { PERMIT2, USDC, USDC_DECIMALS, getSettings } from './config'
import type { Call } from './wallet'

// Compliance engine. Runs in the app before the passkey prompt.
// MOCK: the sanctions list stands in for a screening provider API
// (Chainalysis, TRM, Elliptic) and the dApp list for a Swissquote review board.

export const SANCTIONED: Record<string, string> = {
  '0x8576acc5c05d6ce88f4e49bf65bdf0c62f91353c': 'Demo sanctions list entry (mock OFAC SDN match)',
  '0xd882cfc20f52f2599d84b8e8d58c7fb62cfe344b': 'Demo sanctions list entry (mock mixer cluster)',
  '0x1da5821544e25c636c1417ba96ade4cf6d2f9b5a': 'Demo sanctions list entry (mock ransomware cluster)',
}

export type DApp = { name: string; address: Address; status: 'approved' | 'blocked' | 'unreviewed'; note: string }
export const DAPPS: DApp[] = [
  { name: 'Uniswap Permit2', address: PERMIT2, status: 'approved', note: 'Token approvals for Uniswap swaps. Reviewed by Swissquote.' },
  { name: 'USDC by Circle', address: USDC, status: 'approved', note: 'Regulated stablecoin issuer.' },
  { name: 'Aave V3 Pool', address: '0x07eA79F68B2B3df564D0A34F8e19D9B1e339814b', status: 'approved', note: 'Lending market. Deposits allowed up to 10 000 CHF.' },
  { name: 'FreeMint Airdrop', address: '0x9e1a7f3b5c2d4e6f8a0b1c3d5e7f9a2b4c6d8e01', status: 'blocked', note: 'Known wallet drainer pattern. Asks for unlimited approvals.' },
]

export type Check = { id: string; label: string; status: 'pass' | 'warn' | 'block'; detail: string }
export type Review = { checks: Check[]; blocked: boolean; stepUp: boolean; summary: string }

export function screenAddress(a: string): Check {
  if (!isAddress(a)) return { id: 'sanctions', label: 'Sanctions screening', status: 'block', detail: 'This is not a valid address.' }
  const hit = SANCTIONED[a.toLowerCase()]
  return hit
    ? { id: 'sanctions', label: 'Sanctions screening', status: 'block', detail: `${hit}. Swissquote cannot let you send funds here.` }
    : { id: 'sanctions', label: 'Sanctions screening', status: 'pass', detail: 'No match on the screening list.' }
}

function dappFor(a: Address) {
  return DAPPS.find((d) => d.address.toLowerCase() === a.toLowerCase())
}

/** Reviews a batch of calls before signing. */
export function reviewCalls(calls: Call[]): Review {
  const checks: Check[] = []
  let usdcOut = 0n
  for (const c of calls) {
    // Plain value transfer
    if (!c.data || c.data === '0x') {
      checks.push(screenAddress(c.to))
      continue
    }
    // ERC20 calls
    if (c.to.toLowerCase() === USDC.toLowerCase()) {
      try {
        const d = decodeFunctionData({ abi: erc20Abi, data: c.data })
        if (d.functionName === 'transfer') {
          const [to, amount] = d.args as [Address, bigint]
          checks.push(screenAddress(to))
          usdcOut += amount
        }
        if (d.functionName === 'approve') {
          const [spender, amount] = d.args as [Address, bigint]
          const dapp = dappFor(spender)
          checks.push(screenAddress(spender))
          if (amount === maxUint256) {
            checks.push({ id: 'approve', label: 'Approval size', status: 'block', detail: 'Unlimited approval. A drainer could empty your USDC later. Approve only what you need.' })
          } else {
            checks.push({ id: 'approve', label: 'Approval size', status: 'pass', detail: `Limited to ${formatUnits(amount, USDC_DECIMALS)} USDC.` })
          }
          checks.push(
            !dapp
              ? { id: 'dapp', label: 'dApp review', status: 'block', detail: 'This contract is not on the Swissquote approved list.' }
              : dapp.status === 'approved'
                ? { id: 'dapp', label: 'dApp review', status: 'pass', detail: `${dapp.name} is approved.` }
                : { id: 'dapp', label: 'dApp review', status: 'block', detail: `${dapp.name}. ${dapp.note}` },
          )
        }
      } catch {
        checks.push({ id: 'decode', label: 'Transaction decoding', status: 'warn', detail: 'Unknown token call.' })
      }
      continue
    }
    // Other contract calls must target a reviewed dApp
    const dapp = dappFor(c.to)
    checks.push(
      dapp?.status === 'approved'
        ? { id: 'dapp', label: 'dApp review', status: 'pass', detail: `${dapp.name} is approved.` }
        : { id: 'dapp', label: 'dApp review', status: 'block', detail: dapp ? `${dapp.name}. ${dapp.note}` : `Contract ${getAddress(c.to)} is not on the approved list.` },
    )
  }

  const limit = getSettings().stepUpLimitUsdc
  const usdc = Number(formatUnits(usdcOut, USDC_DECIMALS))
  const stepUp = usdc > limit
  if (usdcOut > 0n) {
    checks.push(
      stepUp
        ? { id: 'amount', label: 'Amount check', status: 'warn', detail: `Above your ${limit} USDC limit. You will confirm twice and declare the recipient (travel rule).` }
        : { id: 'amount', label: 'Amount check', status: 'pass', detail: `Within your ${limit} USDC limit.` },
    )
  }
  const blocked = checks.some((c) => c.status === 'block')
  return {
    checks,
    blocked,
    stepUp,
    summary: blocked ? 'Blocked before signing' : stepUp ? 'Extra confirmation needed' : 'Ready to sign',
  }
}
