import { QRCodeSVG } from 'qrcode.react'
import { addrUrl } from '../lib/config'
import { CopyButton, Icon, useWallet } from '../ui'

export function Receive() {
  const w = useWallet()!
  return (
    <div className="screen">
      <h2>Receive</h2>
      <p className="muted">Send only Base Sepolia assets to this address. USDC and ETH appear here within seconds.</p>
      <div style={{ display: 'grid', placeItems: 'center', padding: 20, background: '#fff', borderRadius: 16, border: '1px solid var(--line)' }}>
        <QRCodeSVG value={w.address} size={200} fgColor="#13213a" />
      </div>
      <p className="mono" style={{ textAlign: 'center' }}>{w.address}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <CopyButton text={w.address} label="Copy address" />
        <a className="btn secondary inline" href={addrUrl(w.address)} target="_blank" rel="noreferrer"><Icon name="external" size={16} /> BaseScan</a>
      </div>
      <div className="banner info">
        <Icon name="plus" />
        <div className="stack-sm">
          <span>Need test funds? Circle gives free test USDC on Base Sepolia.</span>
          <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">faucet.circle.com</a>
        </div>
      </div>
    </div>
  )
}
