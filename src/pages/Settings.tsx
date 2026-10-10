import { useState } from 'react'
import { getSettings, type Settings as S } from '../lib/config'
import { MODULE_ADDRESS } from '../lib/recovery'
import { KEYS, save } from '../lib/storage'
import { addrUrl } from '../lib/config'
import { Icon } from '../ui'

export function Settings() {
  const [s, setS] = useState<S>(getSettings)
  const [saved, setSaved] = useState(false)
  const set = (patch: Partial<S>) => { setS({ ...s, ...patch }); setSaved(false) }

  function resetDemo() {
    if (!window.confirm('Delete all demo data in this browser? On chain wallets stay where they are.')) return
    try { Object.values(KEYS).forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
    window.location.hash = '#/'
    window.location.reload()
  }

  return (
    <div className="screen">
      <h2>Settings</h2>
      <div className="field">
        <label htmlFor="pk">Pimlico API key</label>
        <input id="pk" className="input mono" value={s.pimlicoKey} onChange={(e) => set({ pimlicoKey: e.target.value })} placeholder="pim_…" autoComplete="off" />
        <span className="hint">Turns on sponsored fees, so no ETH is needed. Free key at dashboard.pimlico.io. Testnet only.</span>
      </div>
      <div className="field">
        <label htmlFor="cn">Client name</label>
        <input id="cn" className="input" value={s.clientName} onChange={(e) => set({ clientName: e.target.value })} />
      </div>
      <div className="field">
        <label htmlFor="lim">Extra confirmation above (USDC)</label>
        <input id="lim" className="input" type="number" min={0} value={s.stepUpLimitUsdc} onChange={(e) => set({ stepUpLimitUsdc: Number(e.target.value) })} />
        <span className="hint">1 000 CHF in production. Low for the demo so testnet funds can trigger it.</span>
      </div>
      <div className="field">
        <label htmlFor="del">Recovery security delay (seconds)</label>
        <input id="del" className="input" type="number" min={30} value={s.recoveryDelaySec} onChange={(e) => set({ recoveryDelaySec: Number(e.target.value) })} />
        <span className="hint">172 800 seconds (48 h) in production. Applies to wallets activated after the change.</span>
      </div>
      <button className="btn" onClick={() => { save(KEYS.settings, s); setSaved(true) }}>{saved ? 'Saved' : 'Save settings'}</button>
      <div className="list">
        <div><Icon name="shield" /><div className="grow"><h3>Recovery module</h3><a className="mono muted" href={addrUrl(MODULE_ADDRESS)} target="_blank" rel="noreferrer">{MODULE_ADDRESS}</a></div></div>
        <div><Icon name="grid" /><div className="grow"><h3>Network</h3><p className="small muted">Base Sepolia testnet, ERC-4337 EntryPoint v0.6, Coinbase Smart Wallet v1.1</p></div></div>
      </div>
      <button className="btn secondary" onClick={resetDemo}>Reset demo data</button>
    </div>
  )
}
