import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { encodeFunctionData, type Hex } from 'viem'
import { addrUrl, txUrl } from '../lib/config'
import { cancelCall, getModuleConfig, getPending, MODULE_ADDRESS } from '../lib/recovery'
import { KEYS, remove, save } from '../lib/storage'
import { accountFor, humanError, listOwners, logActivity, sendCalls, walletAbi } from '../lib/wallet'
import { Busy, Icon, fmtDuration, short, useNow, usePoll, useWallet } from '../ui'

export function Security() {
  const w = useWallet()!
  const nav = useNavigate()
  const now = useNow()
  const owners = usePoll(() => listOwners(w.address), 15000, [w.address])
  const cfg = usePoll(() => getModuleConfig(w.address), 15000, [w.address])
  const pending = usePoll(() => getPending(w.address), 5000, [w.address])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tx, setTx] = useState<Hex | null>(null)

  const myKey = w.credential.publicKey.toLowerCase()
  const pendingIsMine = pending.data && `${pending.data.x}${pending.data.y.slice(2)}`.toLowerCase() === myKey
  const labelFor = (addr: string) => w.guardians?.find((g) => g.address.toLowerCase() === addr.toLowerCase())?.label ?? 'Guardian'

  async function run(id: string, label: string, fn: () => Promise<{ txHash: Hex }>) {
    setBusy(id); setErr(null); setTx(null)
    try {
      const { txHash } = await fn()
      setTx(txHash)
      logActivity({ kind: 'security', label, txHash, at: Date.now() })
      owners.refresh(); pending.refresh(); cfg.refresh()
    } catch (e) { setErr(humanError(e)) } finally { setBusy(null) }
  }

  const cancel = () => run('cancel', 'Cancelled a recovery attempt', async () => sendCalls(await accountFor(w), [cancelCall()]))

  const removeOwner = (index: number, raw: Hex) =>
    run(`rm${index}`, 'Removed a lost device key', async () =>
      sendCalls(await accountFor(w), [{ to: w.address, data: encodeFunctionData({ abi: walletAbi, functionName: 'removeOwnerAtIndex', args: [BigInt(index), raw] }) }]),
    )

  function simulateLoss() {
    save(KEYS.lostWallet, w)
    remove(KEYS.wallet)
    nav('/')
  }

  return (
    <div className="screen">
      <h2>Security</h2>

      {pending.data && !pendingIsMine && (
        <div className="banner bad" role="alert">
          <Icon name="alert" />
          <div className="stack-sm grow">
            <strong>Recovery attempt in progress</strong>
            <span className="small">Two guardians approved adding a new device. It becomes active in {fmtDuration(pending.data.executeAfter - now / 1000)}. If you did not ask for this, cancel it. Only you can, because only you hold a key.</span>
            <button className="btn danger inline" style={{ alignSelf: 'flex-start' }} onClick={cancel} disabled={!!busy}>
              <Busy on={busy === 'cancel'}>Cancel this recovery</Busy>
            </button>
          </div>
        </div>
      )}

      <section className="stack">
        <h3>Keys that can sign</h3>
        <div className="list">
          {owners.data === null && <div className="muted small">Loading from chain…</div>}
          {owners.data?.length === 0 && <div className="muted small">Wallet not activated yet.</div>}
          {owners.data?.map((o) => {
            const isModule = o.kind === 'address' && o.address?.toLowerCase() === MODULE_ADDRESS.toLowerCase()
            const isMe = o.kind === 'passkey' && o.raw.toLowerCase() === myKey
            return (
              <div key={o.index}>
                <Icon name={isModule ? 'shield' : 'phone'} />
                <div className="grow">
                  <h3>{isModule ? 'Recovery module' : isMe ? `This ${w.deviceLabel}` : 'Other passkey'}</h3>
                  <p className="small muted">
                    {isModule ? 'Can only add a new key, after guardian approval and the security delay.' : isMe ? 'Face ID protected passkey. Slot ' + o.index : 'Slot ' + o.index + '. Remove it if this device is lost.'}
                  </p>
                </div>
                {!isModule && !isMe && (
                  <button className="btn secondary inline" onClick={() => removeOwner(o.index, o.raw)} disabled={!!busy}>
                    <Busy on={busy === `rm${o.index}`}>Remove</Busy>
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="stack">
        <div className="row-between">
          <h3>Guardians</h3>
          {cfg.data && <span className="chip neutral">{cfg.data.threshold} of {cfg.data.guardians.length}, {cfg.data.delay >= 3600 ? `${cfg.data.delay / 3600} h` : `${cfg.data.delay} s`} delay</span>}
        </div>
        <div className="list">
          {cfg.data?.guardians.map((g) => (
            <div key={g}>
              <Icon name={labelFor(g).startsWith('Swissquote') ? 'bank' : labelFor(g).includes('kit') ? 'key' : 'user'} />
              <div className="grow"><h3>{labelFor(g)}</h3><a className="mono muted" href={addrUrl(g)} target="_blank" rel="noreferrer">{short(g, 10)}</a></div>
            </div>
          )) ?? <div className="muted small">Loading from chain…</div>}
        </div>
        <p className="small muted">Guardians can only start a recovery. They can never sign a payment. Swissquote is one guardian out of three, so it can never act alone.</p>
      </section>

      {tx && <a className="banner ok" href={txUrl(tx)} target="_blank" rel="noreferrer"><Icon name="check" /><span>Done. View the transaction on BaseScan.</span></a>}
      {err && <div className="banner bad" role="alert"><Icon name="alert" /><span>{err}</span></div>}

      <section className="stack">
        <h3>Demo</h3>
        <button className="btn secondary" onClick={simulateLoss}><Icon name="phone" /> Simulate a lost phone</button>
        <p className="small muted">Removes this device's wallet from the browser, like losing the phone. Your funds stay on chain.</p>
      </section>
    </div>
  )
}
