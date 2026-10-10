import { HashRouter, Link, NavLink, Route, Routes, useLocation, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { hasPaymaster } from './lib/config'
import { KEYS, save, remove } from './lib/storage'
import type { WalletRecord } from './lib/wallet'
import { Icon, SwissCross, useStored, useWallet } from './ui'
import { Welcome, Create } from './pages/Onboarding'
import { Home } from './pages/Home'
import { Send } from './pages/Send'
import { Receive } from './pages/Receive'
import { Security } from './pages/Security'
import { Recover } from './pages/Recover'
import { GuardianPortal, BankBackOffice } from './pages/Guardians'
import { Account } from './pages/Account'
import { Dapps } from './pages/Dapps'
import { Settings } from './pages/Settings'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/bank" element={<BankBackOffice />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </HashRouter>
  )
}

function Shell() {
  const w = useWallet()
  const loc = useLocation()
  const showTabs = !!w && !['/guardian', '/recover', '/create'].includes(loc.pathname)
  return (
    <div className="shell">
      <main className="phone">
        <header className="topbar">
          <Link to="/" className="brand"><span className="brand-mark"><SwissCross /></span> SQ Vault</Link>
          <Link to="/settings" className="icon-btn" aria-label="Settings"><Icon name="settings" size={18} /></Link>
        </header>
        <Routes>
          <Route path="/guardian" element={<GuardianPortal />} />
          <Route path="/recover" element={<Recover />} />
          <Route path="/settings" element={<Settings />} />
          {w ? (
            <>
              <Route path="/" element={<Home />} />
              <Route path="/send" element={<Send />} />
              <Route path="/receive" element={<Receive />} />
              <Route path="/security" element={<Security />} />
              <Route path="/account" element={<Account />} />
              <Route path="/dapps" element={<Dapps />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          ) : (
            <>
              <Route path="/" element={<Welcome />} />
              <Route path="/create" element={<Create />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
        {showTabs && (
          <nav className="tabbar" aria-label="Main">
            <Tab to="/" icon="home" end>Wallet</Tab>
            <Tab to="/send" icon="send">Send</Tab>
            <Tab to="/security" icon="shield">Security</Tab>
            <Tab to="/account" icon="bank">Swissquote</Tab>
          </nav>
        )}
      </main>
      <DemoPanel />
    </div>
  )
}

function Tab({ to, icon, children, end }: { to: string; icon: 'home' | 'send' | 'shield' | 'bank'; children: ReactNode; end?: boolean }) {
  return <NavLink to={to} end={end}><Icon name={icon} />{children}</NavLink>
}

function DemoPanel() {
  const w = useWallet()
  const lost = useStored<WalletRecord | null>(KEYS.lostWallet, null)
  return (
    <aside className="demo" aria-label="Demo guide">
      <div className="card">
        <h2>Demo script</h2>
        <ol>
          <li>Create a wallet with Face ID or Touch ID, pick guardians, save the recovery kit, activate.</li>
          <li>Add test USDC from Circle's faucet, then send some. No ETH needed.</li>
          <li>Open dApps. Try the drainer and the flagged address. Both are stopped before signing.</li>
          <li>Swissquote tab. Prove wallet ownership, verified on chain.</li>
          <li>Security tab. Simulate a lost phone, then recover with the back office and the trusted contact.</li>
          <li>Optional. Bring the old phone back during the delay and cancel the attack.</li>
        </ol>
      </div>
      <div className="card">
        <h3>Other actors</h3>
        <div className="links">
          <a className="btn secondary inline" href="#/bank" target="_blank" rel="noreferrer"><Icon name="bank" size={16} /> Swissquote back office</a>
          <a className="btn secondary inline" href="#/guardian" target="_blank" rel="noreferrer"><Icon name="user" size={16} /> Trusted contact app</a>
        </div>
        {lost && !w && (
          <button className="btn secondary" onClick={() => { save(KEYS.wallet, lost); remove(KEYS.lostWallet) }}>
            <Icon name="phone" size={16} /> Bring the old phone back
          </button>
        )}
        <p className="small muted">
          {hasPaymaster() ? 'Fees sponsored through Pimlico.' : 'No fee sponsor set. Add a Pimlico key in Settings for gasless transfers.'}
        </p>
      </div>
      <p className="footer-note">Hackathon prototype on Base Sepolia testnet. Not a Swissquote product. Bank, KYC and screening services are simulated.</p>
    </aside>
  )
}
