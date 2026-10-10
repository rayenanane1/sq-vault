import { Link } from 'react-router-dom'
import { getBalances, type Activity } from '../lib/wallet'
import { getPending, getModuleConfig } from '../lib/recovery'
import { hasPaymaster, txUrl } from '../lib/config'
import { splitPublicKey } from '../lib/wallet'
import { fmtUsd, Guilloche, Icon, KEYS, short, SwissCross, usePoll, useStored, useWallet, CopyButton, fmtDuration, useNow } from '../ui'

export function Home() {
  const w = useWallet()!
  const bal = usePoll(() => getBalances(w.address), 8000, [w.address])
  const cfg = usePoll(() => getModuleConfig(w.address), 20000, [w.address])
  const activity = useStored<Activity[]>(KEYS.activity, [])

  return (
    <div className="screen">
      <PendingRecoveryAlert />
      <section className="plate" aria-label="Wallet balance">
        <Guilloche />
        <div className="row">
          <span>Self custody wallet</span>
          <span className="cross"><SwissCross /></span>
        </div>
        <div className="bal">
          {bal.data ? fmtUsd(bal.data.usdcFmt) : '—'}<small>USDC</small>
        </div>
        <div className="row">
          <span>{bal.data ? `${bal.data.ethFmt.toFixed(5)} ETH` : 'Loading balance'}</span>
          <span className="mono" style={{ color: '#c3cbe0' }}>{short(w.address)}</span>
        </div>
        <div className="chips">
          <span className="chip"><Icon name="key" size={14} /> Key on this {w.deviceLabel}</span>
          <span className="chip"><Icon name="shield" size={14} /> {cfg.data ? `Recovery ${cfg.data.threshold} of ${cfg.data.guardians.length}` : 'Recovery not set'}</span>
          {hasPaymaster() && <span className="chip">Fees covered</span>}
        </div>
      </section>

      <nav className="actions" aria-label="Wallet actions">
        <Link to="/send" className="action"><Icon name="send" /> Send</Link>
        <Link to="/receive" className="action"><Icon name="receive" /> Receive</Link>
        <Link to="/dapps" className="action"><Icon name="grid" /> dApps</Link>
      </nav>

      <section className="stack">
        <div className="row-between"><h3>Activity</h3><button className="btn secondary inline" onClick={bal.refresh}>Refresh</button></div>
        {activity.length === 0 ? (
          <div className="banner info">
            <Icon name="plus" />
            <div className="stack-sm">
              <span>Your wallet is empty. Add test USDC from Circle's faucet on Base Sepolia.</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a className="btn inline" href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Open USDC faucet</a>
                <CopyButton text={w.address} label="Copy address" />
              </div>
            </div>
          </div>
        ) : (
          <div className="list">
            {activity.slice(0, 8).map((a, i) => (
              <div key={i}>
                <Icon name={a.kind === 'send' ? 'send' : a.kind === 'blocked' ? 'x' : 'shield'} />
                <div className="grow">
                  <div style={{ fontSize: 14, fontWeight: 550 }}>{a.label}</div>
                  <div className="small muted">{new Date(a.at).toLocaleString('de-CH')}</div>
                </div>
                {a.amount && <strong className="small">{a.amount}</strong>}
                {a.txHash && <a href={txUrl(a.txHash)} target="_blank" rel="noreferrer" aria-label="View transaction"><Icon name="external" size={16} /></a>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** Red alert shown on every screen of the legitimate device while a recovery is pending. */
export function PendingRecoveryAlert() {
  const w = useWallet()
  const pending = usePoll(() => (w ? getPending(w.address) : Promise.resolve(null)), 6000, [w?.address])
  const now = useNow()
  if (!w || !pending.data) return null
  const mine = (() => {
    const { x, y } = splitPublicKey(w.credential.publicKey)
    return pending.data.x.toLowerCase() === x.toLowerCase() && pending.data.y.toLowerCase() === y.toLowerCase()
  })()
  if (mine) return null
  const left = pending.data.executeAfter - now / 1000
  return (
    <div className="banner bad" role="alert">
      <Icon name="alert" />
      <div className="stack-sm grow">
        <strong>Someone is trying to recover your wallet</strong>
        <span className="small">A new device will be added in {fmtDuration(left)}. If this is not you, cancel now. Your funds stay safe.</span>
        <Link to="/security" className="btn danger inline" style={{ alignSelf: 'flex-start' }}>Review and cancel</Link>
      </div>
    </div>
  )
}
