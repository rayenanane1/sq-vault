// Small safe wrappers around localStorage. Every read and write is guarded,
// because storage can be blocked (private mode, strict settings).

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable, keep running in memory */
  }
  window.dispatchEvent(new CustomEvent('sq-storage', { detail: key }))
}

export function remove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('sq-storage', { detail: key }))
}

export const KEYS = {
  wallet: 'sqv.wallet', // this device's wallet record
  lostWallet: 'sqv.demo.lostWallet', // demo only: the "lost phone" so it can be found again
  activity: 'sqv.activity',
  settings: 'sqv.settings',
  bankDb: 'sqv.mock.bankDb', // mock Swissquote core banking record
  bankGuardianKey: 'sqv.mock.bankGuardianKey', // mock Swissquote HSM key
  contactGuardianKey: 'sqv.mock.contactGuardianKey', // mock trusted contact device key
  recoveryRequests: 'sqv.mock.recoveryRequests', // mock recovery coordination server
  pendingNewOwner: 'sqv.recovery.newOwner', // new device passkey while recovery is in progress
} as const
