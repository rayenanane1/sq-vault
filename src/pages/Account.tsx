import { useState } from 'react'
import { getClient, ownershipMessage, updateClient } from '../lib/bank'
import { accountFor, humanError, publicClient, getBalances } from '../lib/wallet'
import { Busy, CopyButton, fmtUsd, Icon, short, usePoll, useStorageTick, useWallet } from '../ui'

/** Mock of the client's Swissquote account, with the real wallet ownership proof. */
export function Account() {
  useStorageTick()
  const w = useWallet()!
  const c = getClient()
  const bal = usePoll(() => getBalances(w.address), 15000, [w.address])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function prove() {
    setBusy(true); setErr(null)
    try {
      const account = await accountFor(w)
      const message = ownershipMessage(c, w.address)
      const signature = await account.signMessage({ message })
      // ERC-1271 (deployed) or ERC-6492 (not yet deployed) check, done the way Swissquote's backend would
      const ok = await publicClient.verifyMessage({ address: w.address, message, signature })
      if (!ok) throw new Error('The signature did not verify on chain.')
      updateClient({ ownershipProof: { message, signature, verifiedAt: Date.now() }, linkedWallet: w.address })
    } catch (e) { setErr(humanError(e)) } finally { setBusy(false) }
  }

  return (
    <div className="screen">
      <div className="row-between">
        <h2>Swissquote account</h2>
        <span className="chip warn">Mock</span>
      </div>
      <div className="list">
        <div><Icon name="bank" /><div className="grow"><h3>{c.name}</h3><p className="small muted">Client {c.clientNumber}</p></div></div>
        <div><div className="grow">Cash account</div><strong>CHF {fmtUsd(c.chf)}</strong></div>
        <div><div className="grow">Bitcoin held by Swissquote</div><strong>{c.custodialBtc} BTC</strong></div>
        <div><div className="grow">Self custody wallet <span className="mono muted">{short(w.address)}</span></div><strong>{bal.data ? `${fmtUsd(bal.data.usdcFmt)} USDC` : '…'}</strong></div>
      </div>

      <section className="stack">
        <h3>Wallet ownership</h3>
        <p className="small muted">
          Before Swissquote sends crypto to an external wallet, Swiss rules require proof that the wallet belongs to you.
          You sign a short declaration with your passkey and Swissquote checks it against the wallet contract on chain.
        </p>
        {c.ownershipProof ? (
          <div className="banner ok">
            <Icon name="check" />
            <div className="stack-sm grow">
              <strong>Ownership verified</strong>
              <span className="small">Checked on chain {new Date(c.ownershipProof.verifiedAt).toLocaleString('de-CH')}. Withdrawals to this wallet are unlocked.</span>
              <CopyButton text={c.ownershipProof.signature} label="Copy signature" />
            </div>
          </div>
        ) : (
          <button className="btn" onClick={prove} disabled={busy}><Busy on={busy}>Prove I own this wallet</Busy></button>
        )}
        {err && <div className="banner bad" role="alert"><Icon name="alert" /><span>{err}</span></div>}
      </section>

      <section className="stack">
        <h3>Move funds</h3>
        <div className="list">
          <div><Icon name="receive" /><div className="grow"><h3>Withdraw to my wallet</h3><p className="small muted">{c.ownershipProof ? 'Allowed. In production, Swissquote sends from its omnibus wallet.' : 'Locked until ownership is verified.'}</p></div></div>
          <div><Icon name="send" /><div className="grow"><h3>Deposit back to Swissquote</h3><p className="small muted">Send USDC to your Swissquote deposit address from the Send screen.</p></div></div>
        </div>
      </section>
    </div>
  )
}
