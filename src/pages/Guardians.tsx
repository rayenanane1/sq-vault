import { useState } from 'react'
import { approveRequest, bankGuardian, contactGuardian, listRequests, type RecoveryRequest } from '../lib/recovery'
import { getClient } from '../lib/bank'
import { humanError } from '../lib/wallet'
import { Busy, CheckDot, Icon, short, useStorageTick } from '../ui'

/** The trusted contact's own app (mock: runs in this browser). */
export function GuardianPortal() {
  useStorageTick()
  const me = contactGuardian()
  const open = listRequests().filter((r) => r.status === 'collecting')
  return (
    <div className="screen">
      <div className="row-between">
        <h2>Guardian app</h2>
        <span className="chip neutral"><Icon name="user" size={14} /> Trusted contact</span>
      </div>
      <p className="muted small">You are a guardian for {getClient().name}. Your key: <span className="mono">{short(me.address, 10)}</span></p>
      {open.length === 0 && <div className="banner info"><Icon name="clock" /><span>No recovery request right now. Keep this app open, requests appear here.</span></div>}
      {open.map((r) => <ContactRequest key={r.id} r={r} />)}
      <p className="small muted">Demo note. In production this runs on the contact's own phone and they get a push notification.</p>
    </div>
  )
}

function ContactRequest({ r }: { r: RecoveryRequest }) {
  const me = contactGuardian()
  const done = r.approvals.some((a) => a.guardian === me.address)
  const [called, setCalled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="stack" style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 16 }}>
      <h3>{r.clientName} asks to recover their wallet</h3>
      <p className="small muted">New device: {r.newDeviceLabel}. Requested {new Date(r.createdAt).toLocaleTimeString('de-CH')}.</p>
      <div className="banner warn small"><Icon name="alert" /><span>Scammers impersonate friends. Call {r.clientName} on a number you already know before you approve.</span></div>
      <label className="check-row"><input type="checkbox" checked={called} onChange={(e) => setCalled(e.target.checked)} disabled={done} /> I called {r.clientName} and they confirmed this request</label>
      {done ? (
        <span className="chip ok" style={{ alignSelf: 'flex-start' }}><Icon name="check" size={14} /> You approved</span>
      ) : (
        <button className="btn" disabled={!called || busy} onClick={async () => {
          setBusy(true); setErr(null)
          try { await approveRequest(r, me, 'Trusted contact', ['Phone call confirmed by contact']) } catch (e) { setErr(humanError(e)) } finally { setBusy(false) }
        }}><Busy on={busy}>Approve recovery</Busy></button>
      )}
      {err && <div className="banner bad"><span>{err}</span></div>}
    </div>
  )
}

const KYC_CHECKS = [
  'Video identification passed. Face matches ID on file.',
  'Liveness check passed.',
  'Callback to the phone number registered before the request.',
  'No recent change of email, phone or address on the account.',
  'Device and network risk score is low.',
]

/** Swissquote operations console (mock). */
export function BankBackOffice() {
  useStorageTick()
  const g = bankGuardian()
  const client = getClient()
  const reqs = listRequests()
  return (
    <div className="bo">
      <header className="bo-head">
        <div className="brand"><span className="brand-mark"><svg width="14" height="14" viewBox="0 0 32 32"><path fill="#fff" d="M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7z" /></svg></span> Wallet recovery desk</div>
        <span className="chip warn">Mock back office</span>
      </header>
      <div className="banner info">
        <Icon name="shield" />
        <span>Swissquote is one guardian of three. Approving only starts a security delay that the client can cancel from any device holding a key. Swissquote can never sign payments or recover alone.</span>
      </div>
      <div className="bo-grid">
        <section className="panel">
          <h3>Client record</h3>
          <dl className="kv">
            <dt>Client</dt><dd>{client.name}</dd>
            <dt>Number</dt><dd>{client.clientNumber}</dd>
            <dt>Linked wallet</dt><dd className="mono">{client.linkedWallet ?? 'None'}</dd>
            <dt>Ownership proof</dt><dd>{client.ownershipProof ? `Verified ${new Date(client.ownershipProof.verifiedAt).toLocaleString('de-CH')}` : 'Not yet'}</dd>
          </dl>
        </section>
        <section className="panel">
          <h3>Guardian key</h3>
          <p className="small muted">Held in an HSM in production. Demo key in this browser.</p>
          <p className="mono">{g.address}</p>
        </section>
      </div>
      <h2>Recovery requests</h2>
      {reqs.length === 0 && <p className="muted">No requests.</p>}
      {reqs.map((r) => <BankRequest key={r.id} r={r} />)}
    </div>
  )
}

function BankRequest({ r }: { r: RecoveryRequest }) {
  const g = bankGuardian()
  const done = r.approvals.some((a) => a.guardian === g.address)
  const [checks, setChecks] = useState<boolean[]>(KYC_CHECKS.map(() => false))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const all = checks.every(Boolean)
  return (
    <section className="panel">
      <div className="row-between">
        <h3>{r.clientName}, new {r.newDeviceLabel}</h3>
        <span className={`chip ${r.status === 'collecting' ? 'warn' : r.status === 'cancelled' ? 'bad' : 'ok'}`}>{r.status === 'collecting' ? 'Needs review' : r.status === 'timelock' ? 'Delay running' : r.status}</span>
      </div>
      <p className="mono muted">Wallet {r.wallet}</p>
      <div className="stack-sm">
        {KYC_CHECKS.map((c, i) => (
          <label key={i} className="check-row">
            {done ? <CheckDot status="pass" /> : <input type="checkbox" checked={checks[i]} onChange={(e) => setChecks(checks.map((v, j) => (j === i ? e.target.checked : v)))} />}
            {c}
          </label>
        ))}
      </div>
      {r.status === 'collecting' && !done && (
        <button className="btn inline" style={{ alignSelf: 'flex-start' }} disabled={!all || busy} onClick={async () => {
          setBusy(true); setErr(null)
          try { await approveRequest(r, g, 'Swissquote', KYC_CHECKS) } catch (e) { setErr(humanError(e)) } finally { setBusy(false) }
        }}><Busy on={busy}>Approve as Swissquote guardian</Busy></button>
      )}
      {done && <span className="chip ok" style={{ alignSelf: 'flex-start' }}>Approved by Swissquote</span>}
      {err && <div className="banner bad"><span>{err}</span></div>}
    </section>
  )
}
