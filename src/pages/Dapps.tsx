import { useState } from 'react'
import { encodeFunctionData, erc20Abi, maxUint256, parseUnits, type Address } from 'viem'
import { DAPPS, SANCTIONED } from '../lib/compliance'
import { PERMIT2, USDC, USDC_DECIMALS } from '../lib/config'
import { transferUsdcCall, type Call } from '../lib/wallet'
import { Icon } from '../ui'
import { ReviewAndSign } from './Send'

type Scenario = { id: string; title: string; subtitle: string; text: string; calls: Call[]; label: string }

const sanctioned = Object.keys(SANCTIONED)[0] as Address
const drainer = DAPPS.find((d) => d.status === 'blocked')!.address

const SCENARIOS: Scenario[] = [
  {
    id: 'uni',
    title: 'Approve 1 USDC for Uniswap',
    subtitle: `Spender ${PERMIT2}`,
    text: 'An approved dApp asks for a limited approval. Passes all checks and executes on chain.',
    calls: [{ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PERMIT2, parseUnits('1', USDC_DECIMALS)] }) }],
    label: 'Approved 1 USDC for Uniswap Permit2',
  },
  {
    id: 'drain',
    title: 'FreeMint airdrop claim',
    subtitle: `Spender ${drainer}`,
    text: 'An unknown site asks for an unlimited approval. Typical wallet drainer.',
    calls: [{ to: USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [drainer, maxUint256] }) }],
    label: 'FreeMint approval',
  },
  {
    id: 'sanction',
    title: 'Send 2 USDC to a flagged address',
    subtitle: `To ${sanctioned}`,
    text: 'The recipient is on the sanctions screening list.',
    calls: [transferUsdcCall(sanctioned, parseUnits('2', USDC_DECIMALS))],
    label: 'Transfer to flagged address',
  },
]

export function Dapps() {
  const [active, setActive] = useState<Scenario | null>(null)
  if (active) {
    return (
      <div className="screen">
        <ReviewAndSign calls={active.calls} title={active.title} subtitle={active.subtitle} activityLabel={active.label} onBack={() => setActive(null)} onDone={() => setActive(null)} />
      </div>
    )
  }
  return (
    <div className="screen">
      <h2>dApps</h2>
      <p className="muted">Swissquote reviews dApps before you connect. Every request is decoded, screened and simulated before you sign.</p>
      <div className="list">
        {DAPPS.map((d) => (
          <div key={d.address}>
            <Icon name="grid" />
            <div className="grow"><h3>{d.name}</h3><p className="small muted">{d.note}</p></div>
            <span className={`chip ${d.status === 'approved' ? 'ok' : d.status === 'blocked' ? 'bad' : 'neutral'}`}>{d.status === 'approved' ? 'Approved' : d.status === 'blocked' ? 'Blocked' : 'Unreviewed'}</span>
          </div>
        ))}
      </div>
      <h3>Try a request</h3>
      <div className="list">
        {SCENARIOS.map((s) => (
          <button key={s.id} onClick={() => setActive(s)} style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }}>
            <div className="grow"><h3>{s.title}</h3><p className="small muted">{s.text}</p></div>
            <Icon name="send" size={16} />
          </button>
        ))}
      </div>
    </div>
  )
}
