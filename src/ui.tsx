import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { KEYS, load } from './lib/storage'
import { getWallet, type WalletRecord } from './lib/wallet'

// ---------- Icons (inline, stroke based) ----------
type IconName =
  | 'home' | 'send' | 'shield' | 'bank' | 'receive' | 'plus' | 'check' | 'x' | 'alert' | 'key'
  | 'user' | 'phone' | 'grid' | 'settings' | 'copy' | 'external' | 'clock' | 'lock'
const paths: Record<IconName, string> = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  send: 'M5 12h14M13 6l6 6-6 6',
  receive: 'M12 5v14M6 13l6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  bank: 'M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  key: 'M14 10a4 4 0 1 1-1.2-2.8L21 7v3h-2v2h-2v2h-3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1-4 4-6 8-6s7 2 8 6',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
}
export function Icon({ name, size = 20, stroke = 1.8 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  )
}

export function SwissCross({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path fill="#fff" d="M13 6h6v7h7v6h-7v7h-6v-7H6v-6h7z" />
    </svg>
  )
}

/** Banknote style guilloche background for the vault plate. */
export function Guilloche() {
  const lines = []
  for (let i = 0; i < 22; i++) {
    const r = 40 + i * 9
    lines.push(
      <ellipse key={i} cx={360} cy={-20} rx={r * 1.6} ry={r} fill="none" stroke="#6f86b8" strokeWidth={0.6} strokeOpacity={0.5 - i * 0.015} transform={`rotate(${-18 + i * 1.2} 360 -20)`} />,
    )
  }
  return (
    <svg className="guilloche" viewBox="0 0 400 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {lines}
    </svg>
  )
}

// ---------- Hooks ----------

/** Re-renders when our storage changes in this tab or another tab (guardian portal, back office). */
export function useStorageTick() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('sq-storage', bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener('sq-storage', bump)
      window.removeEventListener('storage', bump)
    }
  }, [])
  return tick
}

export function useWallet(): WalletRecord | null {
  const tick = useStorageTick()
  const [w, setW] = useState(getWallet)
  useEffect(() => setW(getWallet()), [tick])
  return w
}

export function useStored<T>(key: string, fallback: T): T {
  const tick = useStorageTick()
  const [v, setV] = useState(() => load(key, fallback))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setV(load(key, fallback)), [tick, key])
  return v
}

/** Polls an async loader. Returns data, error and a manual refresh. */
export function usePoll<T>(fn: (() => Promise<T>) | null, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  const refresh = useCallback(() => setN((x) => x + 1), [])
  useEffect(() => {
    if (!fn) return
    let alive = true
    const run = () =>
      fn()
        .then((d) => { if (alive) { setData(d); setError(null) } })
        .catch((e) => { if (alive) setError(String(e?.shortMessage ?? e?.message ?? e)) })
    run()
    const t = setInterval(run, ms)
    return () => { alive = false; clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n, ms])
  return { data, error, refresh }
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

// ---------- Small components ----------

export function short(a?: string, n = 6) {
  if (!a) return ''
  return `${a.slice(0, n)}…${a.slice(-4)}`
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn secondary inline"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ }
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={16} /> {done ? 'Copied' : label}
    </button>
  )
}

export function Busy({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? <><span className="spinner" /> Working</> : <>{children}</>
}

export function CheckDot({ status }: { status: 'pass' | 'warn' | 'block' | 'idle' }) {
  return (
    <span className={`dot ${status}`}>
      {status === 'pass' && <Icon name="check" size={12} stroke={3} />}
      {status === 'block' && <Icon name="x" size={12} stroke={3} />}
      {status === 'warn' && <span style={{ fontWeight: 800, fontSize: 12 }}>!</span>}
    </span>
  )
}

export function fmtUsd(n: number) {
  return n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtDuration(sec: number) {
  if (sec <= 0) return '0:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s).padStart(2, '0')}`
}

export { KEYS }
