import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { Address, Hex } from 'viem'
import { getSettings, hasPaymaster, txUrl } from '../lib/config'
import { bankGuardian, contactGuardian, newRecoveryKit, protectionCalls } from '../lib/recovery'
import { updateClient } from '../lib/bank'
import { createPasskey, humanError, logActivity, sendCalls, setWallet, toAccount, type PasskeyCredential, type WalletRecord } from '../lib/wallet'
import { Busy, CheckDot, Icon } from '../ui'

export function Welcome() {
  return (
    <div className="screen" style={{ justifyContent: 'space-between' }}>
      <div className="stack" style={{ marginTop: 24, gap: 16 }}>
        <h1>Your crypto. Your keys. One tap from your Swissquote account.</h1>
        <p className="muted">
          Hold USDC and ETH in a wallet only you can sign for. Unlock it with Face ID. If you lose your phone,
          your guardians help you get back in, and Swissquote can never move your funds.
        </p>
      </div>
      <div className="list" aria-label="How it works">
        <div><Icon name="key" /><div className="grow"><h3>No seed phrase to copy</h3><p className="small muted">Your key is a passkey stored in your phone's secure chip.</p></div></div>
        <div><Icon name="send" /><div className="grow"><h3>No gas token needed</h3><p className="small muted">Send USDC directly. Swissquote covers the network fee.</p></div></div>
        <div><Icon name="shield" /><div className="grow"><h3>Recovery with a 48 hour veto</h3><p className="small muted">2 of 3 guardians, and you can cancel any attempt you did not start.</p></div></div>
      </div>
      <div className="stack">
        <Link to="/create" className="btn">Create my wallet</Link>
        <Link to="/recover" className="btn secondary">I lost my phone, recover my wallet</Link>
      </div>
    </div>
  )
}

type Step = 'passkey' | 'guardians' | 'kit' | 'activate' | 'done'

export function Create() {
  const nav = useNavigate()
  const settings = getSettings()
  const [step, setStep] = useState<Step>('passkey')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [cred, setCred] = useState<PasskeyCredential | null>(null)
  const [address, setAddress] = useState<Address | null>(null)
  const [contactName, setContactName] = useState('Sarah Meier')
  const [kit] = useState(newRecoveryKit)
  const [kitSaved, setKitSaved] = useState(false)
  const [tx, setTx] = useState<Hex | null>(null)
  const order: Step[] = ['passkey', 'guardians', 'kit', 'activate']

  async function makePasskey() {
    setBusy(true); setErr(null)
    try {
      const c = await createPasskey(`${settings.clientName} · SQ Vault`)
      const acc = await toAccount(c)
      setCred(c); setAddress(acc.address)
      setStep('guardians')
    } catch (e) { setErr(humanError(e)) } finally { setBusy(false) }
  }

  const guardians = [
    { label: 'Swissquote (after video identification)', address: bankGuardian().address, kind: 'bank' as const },
    { label: `${contactName || 'Trusted contact'} (trusted contact)`, address: contactGuardian().address, kind: 'contact' as const },
    { label: 'Your offline recovery kit', address: kit.address, kind: 'kit' as const },
  ]

  async function activate() {
    if (!cred || !address) return
    setBusy(true); setErr(null)
    try {
      const account = await toAccount(cred)
      const calls = await protectionCalls(address, guardians.map((g) => g.address), 2, settings.recoveryDelaySec)
      const { txHash } = await sendCalls(account, calls)
      const record: WalletRecord = {
        address, credential: cred, ownerIndex: 0, deviceLabel: deviceName(), createdAt: Date.now(), protectionActive: true,
        guardians: guardians.map(({ label, address }) => ({ label, address })),
      }
      setWallet(record)
      updateClient({ linkedWallet: address })
      logActivity({ kind: 'setup', label: 'Wallet activated with 2 of 3 recovery', txHash, at: Date.now() })
      setTx(txHash)
      setStep('done')
    } catch (e) { setErr(humanError(e)) } finally { setBusy(false) }
  }

  function downloadKit() {
    const body = `SQ Vault recovery kit\n\nWallet: ${address}\nRecovery words (keep offline, never type them on a website you do not trust):\n${kit.mnemonic}\n\nThis kit is one of your three guardians. With one other guardian it can start a recovery.\n`
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }))
    const a = document.createElement('a'); a.href = url; a.download = 'sq-vault-recovery-kit.txt'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="screen">
      {step !== 'done' && (
        <div className="steps" aria-label={`Step ${order.indexOf(step) + 1} of 4`}>
          {order.map((s, i) => <span key={s} className={i <= order.indexOf(step) ? 'on' : ''} />)}
        </div>
      )}

      {step === 'passkey' && (
        <div className="stack" style={{ gap: 18 }}>
          <h2>Create your key</h2>
          <p className="muted">Your phone creates a private key inside its secure chip. It never leaves the device. Not even Swissquote can read it.</p>
          <div className="banner info"><Icon name="lock" /><span>You will see your device's Face ID, Touch ID or PIN prompt.</span></div>
          <button className="btn" onClick={makePasskey} disabled={busy}><Busy on={busy}>Create key with Face ID</Busy></button>
        </div>
      )}

      {step === 'guardians' && (
        <div className="stack" style={{ gap: 18 }}>
          <h2>Choose your guardians</h2>
          <p className="muted">If you lose this phone, any 2 of these 3 can start a recovery. None of them can touch your funds.</p>
          <div className="field">
            <label htmlFor="contact">Trusted contact</label>
            <input id="contact" className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            <span className="hint">They get an invite on their own phone. Demo: their key lives in the Guardian portal.</span>
          </div>
          <div className="list">
            {guardians.map((g) => (
              <div key={g.kind}>
                <Icon name={g.kind === 'bank' ? 'bank' : g.kind === 'contact' ? 'user' : 'key'} />
                <div className="grow"><h3>{g.label}</h3><p className="mono muted">{g.address}</p></div>
              </div>
            ))}
          </div>
          <button className="btn" onClick={() => setStep('kit')}>Continue</button>
        </div>
      )}

      {step === 'kit' && (
        <div className="stack" style={{ gap: 18 }}>
          <h2>Save your recovery kit</h2>
          <p className="muted">These 12 words are your third guardian. Print them and keep them somewhere safe. The app forgets them after this screen.</p>
          <div className="words">{kit.mnemonic.split(' ').map((w, i) => <span key={i}>{w}</span>)}</div>
          <button className="btn secondary" onClick={downloadKit}>Download kit</button>
          <label className="check-row"><input type="checkbox" checked={kitSaved} onChange={(e) => setKitSaved(e.target.checked)} /> I stored my recovery kit offline</label>
          <button className="btn" disabled={!kitSaved} onClick={() => setStep('activate')}>Continue</button>
        </div>
      )}

      {step === 'activate' && (
        <div className="stack" style={{ gap: 18 }}>
          <h2>Activate your wallet</h2>
          <p className="muted">One signature puts your wallet and its recovery rules on chain.</p>
          <div className="list">
            <div><CheckDot status="pass" /><div className="grow">Passkey on this device</div></div>
            <div><CheckDot status="pass" /><div className="grow">2 of 3 guardians</div></div>
            <div><CheckDot status="pass" /><div className="grow">Security delay {settings.recoveryDelaySec >= 3600 ? `${settings.recoveryDelaySec / 3600} h` : `${settings.recoveryDelaySec} s (demo, 48 h in production)`}</div></div>
            <div><CheckDot status={hasPaymaster() ? 'pass' : 'warn'} /><div className="grow">{hasPaymaster() ? 'Network fee paid by Swissquote' : 'No fee sponsor set. Add a Pimlico key in Settings, or fund the wallet with test ETH.'}</div></div>
          </div>
          <p className="mono muted">Wallet {address}</p>
          <button className="btn" onClick={activate} disabled={busy}><Busy on={busy}>Sign and activate</Busy></button>
        </div>
      )}

      {step === 'done' && (
        <div className="stack" style={{ gap: 18, marginTop: 24 }}>
          <span className="dot pass" style={{ width: 48, height: 48 }}><Icon name="check" size={26} stroke={2.6} /></span>
          <h2>Your wallet is live</h2>
          <p className="muted">Your keys, your control. Recovery is set to 2 of 3 guardians with a security delay.</p>
          {tx && <a className="btn secondary" href={txUrl(tx)} target="_blank" rel="noreferrer"><Icon name="external" size={16} /> View on BaseScan</a>}
          <button className="btn" onClick={() => nav('/')}>Open my wallet</button>
        </div>
      )}

      {err && <div className="banner bad" role="alert"><Icon name="alert" /><span>{err}</span></div>}
    </div>
  )
}

export function deviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'This device'
}
