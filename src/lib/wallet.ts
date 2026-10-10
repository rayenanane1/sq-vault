import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  slice,
  type Address,
  type Hex,
} from 'viem'
import {
  createBundlerClient,
  createWebAuthnCredential,
  entryPoint06Address,
  toCoinbaseSmartAccount,
  toWebAuthnAccount,
} from 'viem/account-abstraction'
import { createPimlicoClient } from 'permissionless/clients/pimlico'
import { bundlerUrl, chain, hasPaymaster, PUBLIC_RPC, USDC, USDC_DECIMALS } from './config'
import { KEYS, load, save } from './storage'

export type Call = { to: Address; value?: bigint; data?: Hex }

export type PasskeyCredential = { id: string; publicKey: Hex }

/** What this device stores. Never a private key: the passkey lives in the device secure enclave. */
export type WalletRecord = {
  address: Address
  credential: PasskeyCredential
  ownerIndex: number
  deviceLabel: string
  createdAt: number
  protectionActive?: boolean
  guardians?: { label: string; address: Address }[]
}

export const publicClient = createPublicClient({ chain, transport: http(PUBLIC_RPC) })

export const walletAbi = parseAbi([
  'function addOwnerAddress(address owner)',
  'function addOwnerPublicKey(bytes32 x, bytes32 y)',
  'function removeOwnerAtIndex(uint256 index, bytes owner)',
  'function nextOwnerIndex() view returns (uint256)',
  'function ownerAtIndex(uint256 index) view returns (bytes)',
  'function ownerCount() view returns (uint256)',
  'function isOwnerAddress(address account) view returns (bool)',
  'function isOwnerPublicKey(bytes32 x, bytes32 y) view returns (bool)',
])

export function splitPublicKey(publicKey: Hex): { x: Hex; y: Hex } {
  return { x: slice(publicKey, 0, 32), y: slice(publicKey, 32, 64) }
}

/** Opens the native Face ID / Touch ID / Windows Hello prompt and creates a new passkey. */
export async function createPasskey(userName: string): Promise<PasskeyCredential> {
  const c = await createWebAuthnCredential({
    name: userName,
    rp: { id: window.location.hostname, name: 'SQ Vault' },
  } as Parameters<typeof createWebAuthnCredential>[0])
  return { id: c.id, publicKey: c.publicKey }
}

export async function toAccount(cred: PasskeyCredential, opts?: { address?: Address; ownerIndex?: number }) {
  const owner = toWebAuthnAccount({ credential: cred })
  return toCoinbaseSmartAccount({
    client: publicClient,
    owners: [owner],
    version: '1.1',
    address: opts?.address,
    ownerIndex: opts?.ownerIndex ?? 0,
  })
}

export async function accountFor(record: WalletRecord) {
  return toAccount(record.credential, {
    address: record.ownerIndex === 0 ? undefined : record.address,
    ownerIndex: record.ownerIndex,
  })
}

function clients(account: Awaited<ReturnType<typeof toAccount>>) {
  const pimlico = createPimlicoClient({
    transport: http(bundlerUrl()),
    entryPoint: { address: entryPoint06Address, version: '0.6' },
  })
  const bundler = createBundlerClient({
    account,
    client: publicClient,
    transport: http(bundlerUrl()),
    paymaster: hasPaymaster() ? pimlico : undefined,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
    },
  })
  return { bundler, pimlico }
}

/** Dry run of a set of calls through the bundler. Throws with the revert reason if it would fail. No signature needed. */
export async function simulateCalls(account: Awaited<ReturnType<typeof toAccount>>, calls: Call[]) {
  const { bundler } = clients(account)
  const op = await bundler.prepareUserOperation({ calls })
  return op
}

/** Signs with the passkey (biometric prompt), sends through the bundler, waits for inclusion. */
export async function sendCalls(account: Awaited<ReturnType<typeof toAccount>>, calls: Call[]) {
  const { bundler } = clients(account)
  const opHash = await bundler.sendUserOperation({ calls })
  const receipt = await bundler.waitForUserOperationReceipt({ hash: opHash, timeout: 120_000 })
  if (!receipt.success) throw new Error('The transaction was included but reverted on chain.')
  return { opHash, txHash: receipt.receipt.transactionHash as Hex }
}

export async function getBalances(address: Address) {
  const [eth, usdc] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] }),
  ])
  return {
    eth,
    usdc,
    ethFmt: Number(formatEther(eth)),
    usdcFmt: Number(formatUnits(usdc, USDC_DECIMALS)),
  }
}

export async function isDeployed(address: Address) {
  const code = await publicClient.getCode({ address })
  return !!code && code !== '0x'
}

export type OwnerEntry = { index: number; raw: Hex; kind: 'passkey' | 'address'; address?: Address }

export async function listOwners(wallet: Address): Promise<OwnerEntry[]> {
  if (!(await isDeployed(wallet))) return []
  const next = await publicClient.readContract({ address: wallet, abi: walletAbi, functionName: 'nextOwnerIndex' })
  const out: OwnerEntry[] = []
  for (let i = 0; i < Number(next); i++) {
    const raw = await publicClient.readContract({ address: wallet, abi: walletAbi, functionName: 'ownerAtIndex', args: [BigInt(i)] })
    if (!raw || raw === '0x') continue // removed owner
    if ((raw.length - 2) / 2 === 32) out.push({ index: i, raw, kind: 'address', address: slice(raw, 12, 32) as Address })
    else out.push({ index: i, raw, kind: 'passkey' })
  }
  return out
}

export function transferUsdcCall(to: Address, amount: bigint): Call {
  return { to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amount] }) }
}

// Local activity log (what this device sent). The chain is the source of truth.
export type Activity = { kind: string; label: string; txHash?: Hex; at: number; amount?: string }
export function logActivity(a: Activity) {
  const list = load<Activity[]>(KEYS.activity, [])
  save(KEYS.activity, [a, ...list].slice(0, 50))
}

export function getWallet(): WalletRecord | null {
  return load<WalletRecord | null>(KEYS.wallet, null)
}
export function setWallet(w: WalletRecord | null) {
  save(KEYS.wallet, w)
}

/** Turns bundler and WebAuthn errors into one sentence a client understands. */
export function humanError(e: unknown): string {
  const msg = e instanceof Error ? (e as Error & { shortMessage?: string }).shortMessage ?? e.message : String(e)
  if (/NotAllowedError|not allowed|cancel/i.test(msg)) return 'The biometric prompt was closed. Try again and confirm with Face ID, Touch ID or your device PIN.'
  if (/AA21|didn't pay prefund|insufficient funds/i.test(msg)) return 'The network fee could not be paid. Add a Pimlico key in Settings to sponsor fees, or send test ETH to this wallet.'
  if (/TimelockActive/i.test(msg)) return 'The security delay is still running. Wait until the countdown ends.'
  if (/ThresholdNotMet/i.test(msg)) return 'Not enough guardians approved this recovery yet.'
  if (/RecoveryAlreadyPending/i.test(msg)) return 'A recovery is already in progress for this wallet.'
  if (/transfer amount exceeds balance|exceeds balance/i.test(msg)) return 'Your balance is too low for this transfer.'
  if (/rate limit|429/i.test(msg)) return 'The public bundler is rate limited. Add a Pimlico key in Settings.'
  return msg.split('\n')[0].slice(0, 220)
}
