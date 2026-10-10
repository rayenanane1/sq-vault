import { concat, encodeFunctionData, getContractAddress, recoverMessageAddress, type Address, type Hex } from 'viem'
import { english, generateMnemonic, generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from 'viem/accounts'
import { recoveryModuleAbi, recoveryModuleBytecode } from './recoveryArtifact'
import { CREATE2_DEPLOYER, MODULE_SALT } from './config'
import { KEYS, load, save } from './storage'
import { isDeployed, publicClient, walletAbi, type Call } from './wallet'

export const MODULE_ADDRESS: Address = getContractAddress({
  opcode: 'CREATE2',
  from: CREATE2_DEPLOYER,
  salt: MODULE_SALT,
  bytecode: recoveryModuleBytecode,
})

export type Guardian = { label: string; address: Address; kind: 'bank' | 'contact' | 'kit' }

// ---------- Mock guardian key holders ----------
// In production the Swissquote key sits in an HSM behind video identification,
// and the trusted contact key on the contact's own phone. Here both live in this
// browser so the full flow can be shown on one laptop.

function getOrCreateKey(storageKey: string): Hex {
  let k = load<Hex | null>(storageKey, null)
  if (!k) {
    k = generatePrivateKey()
    save(storageKey, k)
  }
  return k
}
export const bankGuardian = () => privateKeyToAccount(getOrCreateKey(KEYS.bankGuardianKey))
export const contactGuardian = () => privateKeyToAccount(getOrCreateKey(KEYS.contactGuardianKey))

/** Offline recovery kit: 12 words the client prints and stores (safe, safe deposit box). Never stored by the app. */
export function newRecoveryKit() {
  const mnemonic = generateMnemonic(english)
  return { mnemonic, address: mnemonicToAccount(mnemonic).address }
}
/** Address of a mock guardian key if it exists in this browser, without creating one. */
export function peekGuardian(kind: 'bank' | 'contact'): Address | null {
  const k = load<Hex | null>(kind === 'bank' ? KEYS.bankGuardianKey : KEYS.contactGuardianKey, null)
  return k ? privateKeyToAccount(k).address : null
}
export const kitAccount = (mnemonic: string) => mnemonicToAccount(mnemonic.trim().toLowerCase().replace(/\s+/g, ' '))

// ---------- On chain reads ----------

export async function moduleDeployed() {
  return isDeployed(MODULE_ADDRESS)
}

export async function getModuleConfig(wallet: Address) {
  if (!(await moduleDeployed())) return null
  const [guardians, threshold, delay, nonce] = await publicClient.readContract({
    address: MODULE_ADDRESS,
    abi: recoveryModuleAbi,
    functionName: 'getConfig',
    args: [wallet],
  })
  if (threshold === 0) return null
  return { guardians: guardians as Address[], threshold, delay, nonce }
}

export async function getPending(wallet: Address) {
  if (!(await moduleDeployed())) return null
  const [x, y, executeAfter] = await publicClient.readContract({
    address: MODULE_ADDRESS,
    abi: recoveryModuleAbi,
    functionName: 'pending',
    args: [wallet],
  })
  if (executeAfter === 0n) return null
  return { x, y, executeAfter: Number(executeAfter) }
}

export async function readRecoveryHash(wallet: Address, x: Hex, y: Hex) {
  return publicClient.readContract({
    address: MODULE_ADDRESS,
    abi: recoveryModuleAbi,
    functionName: 'recoveryHash',
    args: [wallet, x, y],
  })
}

// ---------- Calls ----------

/** Batch run by the wallet once: deploy module if needed, make it an owner, register guardians. */
export async function protectionCalls(wallet: Address, guardians: Address[], threshold: number, delaySec: number): Promise<Call[]> {
  const calls: Call[] = []
  if (!(await moduleDeployed())) {
    calls.push({ to: CREATE2_DEPLOYER, data: concat([MODULE_SALT, recoveryModuleBytecode]) })
  }
  let alreadyOwner = false
  if (await isDeployed(wallet)) {
    alreadyOwner = await publicClient.readContract({ address: wallet, abi: walletAbi, functionName: 'isOwnerAddress', args: [MODULE_ADDRESS] })
  }
  if (!alreadyOwner) {
    calls.push({ to: wallet, data: encodeFunctionData({ abi: walletAbi, functionName: 'addOwnerAddress', args: [MODULE_ADDRESS] }) })
  }
  calls.push({
    to: MODULE_ADDRESS,
    data: encodeFunctionData({ abi: recoveryModuleAbi, functionName: 'setup', args: [guardians, threshold, delaySec] }),
  })
  return calls
}

export const cancelCall = (): Call => ({
  to: MODULE_ADDRESS,
  data: encodeFunctionData({ abi: recoveryModuleAbi, functionName: 'cancelRecovery' }),
})

export const executeCall = (wallet: Address): Call => ({
  to: MODULE_ADDRESS,
  data: encodeFunctionData({ abi: recoveryModuleAbi, functionName: 'executeRecovery', args: [wallet] }),
})

export async function initiateCall(wallet: Address, x: Hex, y: Hex, hash: Hex, sigs: Hex[]): Promise<Call> {
  // the contract wants signatures sorted by signer address
  const withSigner = await Promise.all(sigs.map(async (s) => ({ s, a: await recoverMessageAddress({ message: { raw: hash }, signature: s }) })))
  withSigner.sort((p, q) => (BigInt(p.a) < BigInt(q.a) ? -1 : 1))
  return {
    to: MODULE_ADDRESS,
    data: encodeFunctionData({ abi: recoveryModuleAbi, functionName: 'initiateRecovery', args: [wallet, x, y, withSigner.map((w) => w.s)] }),
  }
}

// ---------- Mock recovery coordination server ----------

export type Approval = { guardian: Address; label: string; signature: Hex; at: number; checks: string[] }
export type RecoveryRequest = {
  id: string
  wallet: Address
  clientName: string
  x: Hex
  y: Hex
  hash: Hex
  createdAt: number
  newDeviceLabel: string
  approvals: Approval[]
  status: 'collecting' | 'timelock' | 'done' | 'cancelled'
  initiateTx?: Hex
  executeTx?: Hex
}

export const listRequests = () => load<RecoveryRequest[]>(KEYS.recoveryRequests, [])
export const getRequest = (id: string) => listRequests().find((r) => r.id === id) ?? null
export function upsertRequest(r: RecoveryRequest) {
  const all = listRequests().filter((x) => x.id !== r.id)
  save(KEYS.recoveryRequests, [r, ...all])
}

export async function approveRequest(r: RecoveryRequest, signer: ReturnType<typeof privateKeyToAccount> | ReturnType<typeof mnemonicToAccount>, label: string, checks: string[]) {
  const signature = await signer.signMessage({ message: { raw: r.hash } })
  const approvals = r.approvals.filter((a) => a.guardian !== signer.address)
  approvals.push({ guardian: signer.address, label, signature, at: Date.now(), checks })
  const updated = { ...r, approvals }
  upsertRequest(updated)
  return updated
}
