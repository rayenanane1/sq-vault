import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isAddress, parseEther, parseUnits, type Address, type Hex } from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { reviewCalls, type Review } from '../lib/compliance'
import { hasPaymaster, txUrl, USDC_DECIMALS } from '../lib/config'
import { accountFor, humanError, logActivity, sendCalls, simulateCalls, transferUsdcCall, type Call } from '../lib/wallet'
import { Busy, CheckDot, Icon, useWallet } from '../ui'

export function Send() {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [asset, setAsset] = useState<'USDC' | 'ETH'>('USDC')
  const [calls, setCalls] = useState<Call[] | null>(null)
  const nav = useNavigate()

  const valid = isAddress(to) && Number(amount) > 0
  function review() {
    const call = asset === 'USDC'
      ? transferUsdcCall(to as Address, parseUnits(amount, USDC_DECIMALS))
      : { to: to as Address, value: parseEther(amount) }
    setCalls([call])
  }

  if (calls) {
    return (
      <div className="screen">
        <ReviewAndSign
          calls={calls}
          title={`Send ${amount} ${asset}`}
          subtitle={`To ${to}`}
          activityLabel={`Sent ${amount} ${asset}`}
          amountLabel={`−${amount} ${asset}`}
          onBack={() => setCalls(null)}
          onDone={() => nav('/')}
        />
      </div>
    )
  }

  return (
    <div className="screen">
      <h2>Send</h2>
      <div className="field">
        <label htmlFor="to">Recipient address</label>
        <input id="to" className="input mono" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value.trim())} autoComplete="off" />
        {to && !isAddress(to) && <span className="hint" style={{ color: 'var(--red)' }}>This is not a valid address.</span>}
      </div>
      <div className="field">
        <label htmlFor="amount">Amount</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="amount" className="input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(',', '.'))} />
          <select className="input" style={{ width: 110 }} value={asset} onChange={(e) => setAsset(e.target.value as 'USDC' | 'ETH')} aria-label="Asset">
            <option>USDC</option>
            <option>ETH</option>
          </select>
        </div>
        <span className="hint">{hasPaymaster() ? 'No ETH needed. Swissquote pays the network fee.' : 'Network fee paid in ETH from this wallet.'}</span>
      </div>
      <button className="btn" disabled={!valid} onClick={review}>Review transfer</button>
    </div>
  )
}

type Stage = 'checking' | 'ready' | 'blocked' | 'declare' | 'sending' | 'sent' | 'error'

export function ReviewAndSign(props: {
  calls: Call[]
  title: string
  subtitle: string
  activityLabel: string
  amountLabel?: string
  onBack: () => void
  onDone: () => void
}) {
  const w = useWallet()!
  const [stage, setStage] = useState<Stage>('checking')
  const [review, setReview] = useState<Review | null>(null)
  const [sim, setSim] = useState<{ ok: boolean; detail: string } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tx, setTx] = useState<Hex | null>(null)
  const [beneficiary, setBeneficiary] = useState('')
  const [relation, setRelation] = useState<'own' | 'third'>('third')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const r = reviewCalls(props.calls)
      if (!alive) return
      setReview(r)
      if (r.blocked) {
        setStage('blocked')
        logActivity({ kind: 'blocked', label: `Blocked before signing: ${props.title}`, at: Date.now() })
        return
      }
      try {
        const account = await accountFor(w)
        await simulateCalls(account, props.calls)
        if (alive) setSim({ ok: true, detail: 'Dry run on Base Sepolia succeeded. Nothing unexpected happens to your other assets.' })
        if (alive) setStage(r.stepUp ? 'declare' : 'ready')
      } catch (e) {
        if (alive) { setSim({ ok: false, detail: humanError(e) }); setStage('error') }
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function sign() {
    setErr(null)
    try {
      if (review?.stepUp) {
        // Step up: an extra biometric confirmation bound to this exact transfer
        const owner = toWebAuthnAccount({ credential: w.credential })
        await owner.signMessage({ message: `Confirm high value transfer: ${props.title}. Beneficiary: ${beneficiary} (${relation === 'own' ? 'own wallet' : 'third party'})` })
      }
      setStage('sending')
      const account = await accountFor(w)
      const { txHash } = await sendCalls(account, props.calls)
      setTx(txHash)
      logActivity({ kind: 'send', label: props.activityLabel, txHash, at: Date.now(), amount: props.amountLabel })
      setStage('sent')
    } catch (e) {
      setErr(humanError(e))
      setStage(review?.stepUp ? 'declare' : 'ready')
    }
  }

  if (stage === 'sent' && tx) {
    return (
      <div className="stack" style={{ gap: 18, marginTop: 24 }}>
        <span className="dot pass" style={{ width: 48, height: 48 }}><Icon name="check" size={26} stroke={2.6} /></span>
        <h2>Sent</h2>
        <p className="muted">{props.title}. The transaction is final on Base Sepolia.</p>
        <a className="btn secondary" href={txUrl(tx)} target="_blank" rel="noreferrer"><Icon name="external" size={16} /> View on BaseScan</a>
        <button className="btn" onClick={props.onDone}>Done</button>
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="stack-sm">
        <h2>{props.title}</h2>
        <p className="mono muted">{props.subtitle}</p>
      </div>

      <section className="stack" aria-label="Safety checks">
        <div className="row-between">
          <h3>Swissquote safety checks</h3>
          {review && <span className={`chip ${review.blocked ? 'bad' : review.stepUp ? 'warn' : 'ok'}`}>{review.summary}</span>}
        </div>
        <div className="list">
          {review?.checks.map((c, i) => (
            <div key={i} style={{ alignItems: 'flex-start' }}>
              <CheckDot status={c.status} />
              <div className="grow"><h3>{c.label}</h3><p className="small muted">{c.detail}</p></div>
            </div>
          ))}
          {!review?.blocked && (
            <div style={{ alignItems: 'flex-start' }}>
              <CheckDot status={sim ? (sim.ok ? 'pass' : 'block') : 'idle'} />
              <div className="grow"><h3>Transaction simulation</h3><p className="small muted">{sim ? sim.detail : 'Running a dry run…'}</p></div>
            </div>
          )}
          {!review?.blocked && (
            <div style={{ alignItems: 'flex-start' }}>
              <CheckDot status={hasPaymaster() ? 'pass' : 'warn'} />
              <div className="grow"><h3>Network fee</h3><p className="small muted">{hasPaymaster() ? 'Paid by Swissquote. You need no ETH.' : 'Paid in ETH by this wallet.'}</p></div>
            </div>
          )}
        </div>
      </section>

      {stage === 'blocked' && (
        <div className="banner bad" role="alert"><Icon name="alert" /><span>Swissquote stopped this transaction before you signed it. Nothing left your wallet.</span></div>
      )}

      {stage === 'declare' && (
        <section className="stack" aria-label="Recipient declaration">
          <h3>Who receives this transfer?</h3>
          <p className="small muted">Swiss rules ask us to record the beneficiary of larger transfers. You will confirm twice with Face ID.</p>
          <div className="field">
            <label htmlFor="ben">Beneficiary name</label>
            <input id="ben" className="input" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder="Full name or company" />
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <label className="check-row"><input type="radio" checked={relation === 'own'} onChange={() => setRelation('own')} /> My own wallet</label>
            <label className="check-row"><input type="radio" checked={relation === 'third'} onChange={() => setRelation('third')} /> Someone else</label>
          </div>
        </section>
      )}

      {err && <div className="banner bad" role="alert"><Icon name="alert" /><span>{err}</span></div>}

      <div className="stack">
        {(stage === 'ready' || stage === 'declare' || stage === 'sending') && (
          <button className="btn" onClick={sign} disabled={stage === 'sending' || (stage === 'declare' && beneficiary.trim().length < 2)}>
            <Busy on={stage === 'sending'}>{review?.stepUp ? 'Confirm twice and send' : 'Sign with Face ID and send'}</Busy>
          </button>
        )}
        {stage === 'checking' && <button className="btn" disabled><Busy on>Checking</Busy></button>}
        <button className="btn secondary" onClick={props.onBack} disabled={stage === 'sending'}>Back</button>
      </div>
    </div>
  )
}
