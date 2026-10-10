import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isAddress, type Address } from 'viem'
import { getClient } from '../lib/bank'
import { txUrl } from '../lib/config'
import {
  approveRequest, executeCall, peekGuardian, getModuleConfig, getPending, getRequest, initiateCall, kitAccount, readRecoveryHash, upsertRequest, type RecoveryRequest,
} from '../lib/recovery'
import { KEYS, load, remove, save } from '../lib/storage'
import { createPasskey, humanError, listOwners, logActivity, sendCalls, setWallet, splitPublicKey, toAccount, type PasskeyCredential } from '../lib/wallet'
import { deviceName } from './Onboarding'
import { Busy, CheckDot, Icon, fmtDuration, short, useNow, usePoll, useStorageTick } from '../ui'

type Progress = { wallet: Address; credential?: PasskeyCredential; requestId?: string; guardians?: { label: string; address: Address }[] }

export function Recover() {
  const nav = useNavigate()
  useStorageTick()
  const [progress, setProgressState] = useState<Progress | null>(() => load<Progress | null>(KEYS.pendingNewOwner, null))
  const setProgress = (p: Progress | null) => { setProgressState(p); if (p) save(KEYS.pendingNewOwner, p); else remove(KEYS.pendingNewOwner) }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  const [kitWords, setKitWords] = useState('')
  const now = useNow()

  const req: RecoveryRequest | null = progress?.requestId ? getRequest(progress.requestId) : null
  const cfg = usePoll(() => (progress ? getModuleConfig(progress.wallet) : Promise.resolve(null)), 20000, [progress?.wallet])
  const pending = usePoll(() => (progress ? getPending(progress.wallet) : Promise.resolve(null)), 4000, [progress?.wallet])

  // Detect that the legitimate owner cancelled while we waited
  useEffect(() => {
    if (req?.status === 'timelock' && pending.data === null && !busy && Date.now() - (req.initiatedAt ?? 0) > 20000) {
      ;(async () => {
        const owners = await listOwners(req.wallet)
        const added = owners.some((o) => o.raw.toLowerCase() === progress?.credential?.publicKey.toLowerCase())
        if (!added) upsertRequest({ ...req, status: 'cancelled' })
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.data, req?.status])

  async function step(fn: () => Promise<void>) {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr(humanError(e)) } finally { setBusy(false) }
  }

  // 1. Identify the wallet through the Swissquote account
  if (!progress) {
    const client = getClient()
    return (
      <div className="screen">
        <h2>Recover your wallet</h2>
        <p className="muted">Sign in to your Swissquote account. We look up the wallet linked to it. You will need 2 of your 3 guardians.</p>
        <div className="banner info"><Icon name="bank" /><span className="small">Demo: Swissquote login is simulated. Client {client.clientNumber}, {client.name}.</span></div>
        {client.linkedWallet ? (
          <button className="btn" onClick={() => setProgress({ wallet: client.linkedWallet! })}>Sign in and find my wallet</button>
        ) : (
          <p className="small muted">No wallet is linked to this Swissquote account yet. Paste the address instead.</p>
        )}
        <div className="field">
          <label htmlFor="addr">Or enter the wallet address</label>
          <input id="addr" className="input mono" placeholder="0x…" value={manual} onChange={(e) => setManual(e.target.value.trim())} />
        </div>
        <button className="btn secondary" disabled={!isAddress(manual)} onClick={() => setProgress({ wallet: manual as Address })}>Use this address</button>
        <Link to="/" className="small muted">Back</Link>
      </div>
    )
  }

  // 2. New passkey on this device
  if (!progress.credential) {
    return (
      <div className="screen">
        <h2>Create a key on this new device</h2>
        <p className="muted">Wallet {short(progress.wallet, 10)}. This new key gets access only after your guardians approve and the security delay ends.</p>
        <button className="btn" disabled={busy} onClick={() => step(async () => {
          const credential = await createPasskey(`${getClient().name} · SQ Vault (new device)`)
          setProgress({ ...progress, credential })
        })}><Busy on={busy}>Create key with Face ID</Busy></button>
        {err && <div className="banner bad" role="alert"><Icon name="alert" /><span>{err}</span></div>}
        <button className="btn secondary" onClick={() => setProgress(null)}>Start over</button>
      </div>
    )
  }

  const cred = progress.credential
  const { x, y } = splitPublicKey(cred.publicKey)

  async function openRequest() {
    if (!cfg.data) throw new Error('This wallet has no recovery set up on chain.')
    const hash = await readRecoveryHash(progress!.wallet, x, y)
    const r: RecoveryRequest = {
      id: crypto.randomUUID(), wallet: progress!.wallet, clientName: getClient().name, x, y, hash,
      createdAt: Date.now(), newDeviceLabel: deviceName(), approvals: [], status: 'collecting',
    }
    upsertRequest(r)
    setProgress({ ...progress!, requestId: r.id })
  }

  // 3. Ask guardians
  if (!req) {
    return (
      <div className="screen">
        <h2>Ask your guardians</h2>
        <p className="muted">We send a recovery request to your guardians. Each one checks it is really you before approving.</p>
        {cfg.data === null && cfg.error === null && <p className="small muted">Reading your recovery rules…</p>}
        {cfg.data && <div className="banner info"><Icon name="shield" /><span className="small">{cfg.data.threshold} of {cfg.data.guardians.length} guardians needed. Security delay {fmtDuration(cfg.data.delay)}.</span></div>}
        <button className="btn" disabled={busy || !cfg.data} onClick={() => step(openRequest)}><Busy on={busy}>Send recovery request</Busy></button>
        {err && <div className="banner bad" role="alert"><Icon name="alert" /><span>{err}</span></div>}
      </div>
    )
  }

  const threshold = cfg.data?.threshold ?? 2
  const approvedBy = (a: Address) => req.approvals.find((p) => p.guardian.toLowerCase() === a.toLowerCase())
  const enough = req.approvals.length >= threshold

  async function useKit() {
    const acc = kitAccount(kitWords)
    if (!cfg.data?.guardians.some((g) => g.toLowerCase() === acc.address.toLowerCase())) throw new Error('These words do not match a guardian of this wallet.')
    await approveRequest(req!, acc, 'Recovery kit', ['Recovery words entered on the new device'])
    setKitWords('')
  }

  async function startDelay() {
    const executor = await toAccount(cred)
    const call = await initiateCall(req!.wallet, x, y, req!.hash, req!.approvals.slice(0, threshold).map((a) => a.signature))
    const { txHash } = await sendCalls(executor, [call])
    upsertRequest({ ...req!, status: 'timelock', initiateTx: txHash, initiatedAt: Date.now() })
    pending.refresh()
  }

  async function finish() {
    const executor = await toAccount(cred)
    const { txHash } = await sendCalls(executor, [executeCall(req!.wallet)])
    // the public RPC can lag a block behind the bundler, so retry a few times
    let mine: Awaited<ReturnType<typeof listOwners>>[number] | undefined
    for (let i = 0; i < 6 && !mine; i++) {
      const owners = await listOwners(req!.wallet)
      mine = owners.find((o) => o.raw.toLowerCase() === cred.publicKey.toLowerCase())
      if (!mine) await new Promise((r) => setTimeout(r, 2500))
    }
    if (!mine) throw new Error('The new key was not found on the wallet.')
    upsertRequest({ ...req!, status: 'done', executeTx: txHash })
    setWallet({
      address: req!.wallet, credential: cred, ownerIndex: mine.index, deviceLabel: deviceName(), createdAt: Date.now(), protectionActive: true,
      guardians: load<{ guardians?: { label: string; address: Address }[] } | null>(KEYS.lostWallet, null)?.guardians,
    })
    logActivity({ kind: 'security', label: 'Wallet recovered on a new device', txHash, at: Date.now() })
    remove(KEYS.pendingNewOwner)
    nav('/security')
  }

  // 4. Cancelled by the real owner
  if (req.status === 'cancelled') {
    return (
      <div className="screen">
        <div className="banner bad"><Icon name="x" /><span>The wallet owner cancelled this recovery from a device that still holds a key. No new key was added.</span></div>
        <button className="btn secondary" onClick={() => setProgress(null)}>Start over</button>
      </div>
    )
  }

  // 5. Timelock running
  if (req.status === 'timelock') {
    const left = pending.data ? pending.data.executeAfter - now / 1000 : null
    return (
      <div className="screen">
        <h2>Security delay running</h2>
        <p className="muted">Your guardians approved. During this delay your old device and your email get an alert, so a thief cannot take over quietly.</p>
        <div className="countdown" aria-live="polite">{left === null ? '…' : fmtDuration(left)}</div>
        <p className="small muted" style={{ textAlign: 'center' }}>48 hours in production. Shortened for the demo.</p>
        {req.initiateTx && <a className="small" href={txUrl(req.initiateTx)} target="_blank" rel="noreferrer">Recovery started on chain. View on BaseScan</a>}
        <button className="btn" disabled={busy || left === null || left > 0} onClick={() => step(finish)}><Busy on={busy}>Finish recovery</Busy></button>
        {err && <div className="banner bad" role="alert"><Icon name="alert" /><span>{err}</span></div>}
      </div>
    )
  }

  // 3b. Collecting approvals
  return (
    <div className="screen">
      <h2>Waiting for guardians</h2>
      <p className="muted">{req.approvals.length} of {threshold} approvals. This screen updates by itself.</p>
      <div className="list">
        {(cfg.data?.guardians ?? []).map((g) => {
          const a = approvedBy(g)
          const label = a?.label ?? (g.toLowerCase() === getGuardianHint('bank') ? 'Swissquote' : g.toLowerCase() === getGuardianHint('contact') ? 'Trusted contact' : 'Guardian')
          return (
            <div key={g}>
              <CheckDot status={a ? 'pass' : 'idle'} />
              <div className="grow"><h3>{label}</h3><p className="mono muted">{short(g, 10)}</p></div>
              {a ? <span className="chip ok">Approved</span> : <span className="chip neutral">Waiting</span>}
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a className="btn secondary inline" href="#/bank" target="_blank" rel="noreferrer"><Icon name="bank" size={16} /> Swissquote back office</a>
        <a className="btn secondary inline" href="#/guardian" target="_blank" rel="noreferrer"><Icon name="user" size={16} /> Trusted contact app</a>
      </div>
      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>Use my recovery kit instead</summary>
        <div className="stack" style={{ marginTop: 10 }}>
          <textarea className="input" rows={3} placeholder="Your 12 recovery words" value={kitWords} onChange={(e) => setKitWords(e.target.value)} />
          <button className="btn secondary" disabled={busy || kitWords.trim().split(/\s+/).length < 12} onClick={() => step(useKit)}>Approve with recovery kit</button>
        </div>
      </details>
      <button className="btn" disabled={!enough || busy} onClick={() => step(startDelay)}><Busy on={busy}>Start security delay</Busy></button>
      {err && <div className="banner bad" role="alert"><Icon name="alert" /><span>{err}</span></div>}
      <button className="btn secondary" onClick={() => setProgress(null)}>Cancel request</button>
    </div>
  )
}

function getGuardianHint(kind: 'bank' | 'contact') {
  return peekGuardian(kind)?.toLowerCase() ?? ''
}
