import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getClientId, saveClientId,
  getDriveFolder, saveDriveFolder,
  getToken, requestToken, clearToken,
  getCachedKey, setCachedKey, clearCachedKey,
  getStoredSalt, storeSalt,
  deriveKey, encryptPayload, decryptPayload,
  driveDownload, driveUpload,
  LS_CONNECTED, LS_USER_EMAIL, LS_LAST_SYNCED,
} from '../../lib/googleDriveSync'
import { serializeStore, applyToStore } from '../../lib/storeSerializer'
import { Button } from './Button'

// ── Types ─────────────────────────────────────────────────────────────────────

type Phase =
  | 'unconfigured'     // no client ID configured
  | 'disconnected'     // client ID set, not authorized
  | 'authorizing'      // OAuth popup open
  | 'checking'         // token received, checking Drive + key cache
  | 'needs-passphrase' // authorized, key missing/expired — need passphrase
  | 'ready'            // connected + key cached, auto-save active
  | 'syncing'          // upload/download in progress
  | 'error'            // last operation failed

function fmtRelative(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DriveSync() {
  const [clientIdInput, setClientIdInput] = useState(getClientId)
  const [folderInput, setFolderInput] = useState(getDriveFolder)
  const [phase, setPhase] = useState<Phase>(() =>
    getClientId() ? (localStorage.getItem(LS_CONNECTED) ? 'checking' : 'disconnected') : 'unconfigured',
  )
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem(LS_USER_EMAIL) ?? '')
  const [errorMsg, setErrorMsg] = useState('')
  const [passInput, setPassInput] = useState('')
  const [passConfirm, setPassConfirm] = useState('')
  const [passError, setPassError] = useState('')
  const [isNewBackup, setIsNewBackup] = useState(false)
  const [lastSynced, setLastSynced] = useState(() => localStorage.getItem(LS_LAST_SYNCED))
  const [_tick, setTick] = useState(0)
  const pendingBlobRef = useRef<ArrayBuffer | null>(null)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (phase !== 'checking') return
    silentConnect()
  }, []) // eslint-disable-line

  const recordSync = useCallback(() => {
    const now = new Date().toISOString()
    localStorage.setItem(LS_LAST_SYNCED, now)
    setLastSynced(now)
  }, [])

  // ── Core operations ──────────────────────────────────────────────────────────

  async function acquireToken(prompt: 'select_account' | '' = ''): Promise<string> {
    const existing = getToken()
    if (existing) return existing
    return requestToken(prompt)
  }

  async function silentConnect(): Promise<void> {
    try {
      const key = await getCachedKey()
      if (key) {
        setUserEmail(localStorage.getItem(LS_USER_EMAIL) ?? '')
        setPhase('ready')
        return
      }
      // No cached key — must fetch the encrypted blob from Drive, which needs a token
      const token = await acquireToken('')
      setUserEmail(localStorage.getItem(LS_USER_EMAIL) ?? '')
      pendingBlobRef.current = await driveDownload(token)
      setIsNewBackup(pendingBlobRef.current === null)
      setPhase('needs-passphrase')
    } catch {
      setPhase('disconnected')
    }
  }

  async function connect(): Promise<void> {
    setPhase('authorizing')
    setErrorMsg('')
    try {
      const token = await requestToken('select_account')
      const info = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${token}`)
      const json = await info.json() as { email?: string }
      const email = json.email ?? ''
      setUserEmail(email)
      localStorage.setItem(LS_CONNECTED, 'true')
      localStorage.setItem(LS_USER_EMAIL, email)
      setPhase('checking')
      const key = await getCachedKey()
      if (key) {
        setPhase('ready')
      } else {
        pendingBlobRef.current = await driveDownload(token)
        setIsNewBackup(pendingBlobRef.current === null)
        setPhase('needs-passphrase')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'access_denied' || msg === 'popup_closed_by_user') {
        setPhase('disconnected')
      } else {
        setErrorMsg(msg)
        setPhase('error')
      }
    }
  }

  async function submitPassphrase(): Promise<void> {
    if (!passInput.trim()) return
    if (isNewBackup && passInput !== passConfirm) {
      setPassError('Passphrases do not match.')
      return
    }
    setPassError('')
    setPhase('syncing')
    try {
      const token = await acquireToken('')
      let key: CryptoKey
      let salt: Uint8Array
      const blob = pendingBlobRef.current
      if (blob !== null) {
        // Existing backup — derive key from salt embedded in blob, then decrypt
        const { text, salt: blobSalt } = await decryptPayload(
          await deriveKey(passInput, new Uint8Array(blob, 0, 16)),
          blob,
        )
        salt = blobSalt
        key = await deriveKey(passInput, salt)
        storeSalt(salt)
        await setCachedKey(key)
        applyToStore(text)
      } else {
        // New backup — generate salt, derive key, upload
        salt = crypto.getRandomValues(new Uint8Array(16))
        key = await deriveKey(passInput, salt)
        storeSalt(salt)
        await setCachedKey(key)
        await driveUpload(token, await encryptPayload(key, serializeStore(), salt))
        recordSync()
      }
      setPassInput('')
      setPassConfirm('')
      pendingBlobRef.current = null
      setPhase('ready')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPassError(msg.includes('Wrong passphrase') ? 'Wrong passphrase — try again.' : msg)
      setPhase('needs-passphrase')
    }
  }

  async function save(): Promise<void> {
    setPhase('syncing')
    setErrorMsg('')
    try {
      let token = getToken()
      if (!token) token = await requestToken('')
      const key = await getCachedKey()
      if (!key) {
        pendingBlobRef.current = await driveDownload(token)
        setIsNewBackup(pendingBlobRef.current === null)
        setPhase('needs-passphrase')
        return
      }
      const salt = getStoredSalt()
      if (!salt) { setPhase('needs-passphrase'); return }
      await driveUpload(token, await encryptPayload(key, serializeStore(), salt))
      recordSync()
      setPhase('ready')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  async function loadFromDrive(): Promise<void> {
    setPhase('syncing')
    setErrorMsg('')
    try {
      let token = getToken()
      if (!token) token = await requestToken('')
      const blob = await driveDownload(token)
      if (!blob) { setErrorMsg('No backup found on Drive.'); setPhase('error'); return }
      const key = await getCachedKey()
      if (!key) {
        pendingBlobRef.current = blob
        setIsNewBackup(false)
        setPhase('needs-passphrase')
        return
      }
      const { text } = await decryptPayload(key, blob)
      applyToStore(text)
      recordSync()
      setPhase('ready')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  function disconnect(): void {
    clearToken()
    clearCachedKey()
    localStorage.removeItem(LS_CONNECTED)
    localStorage.removeItem(LS_USER_EMAIL)
    localStorage.removeItem(LS_LAST_SYNCED)
    pendingBlobRef.current = null
    setUserEmail('')
    setLastSynced(null)
    setPassInput('')
    setPassConfirm('')
    setPassError('')
    setPhase('disconnected')
  }

  function exportJson(): void {
    const blob = new Blob([serializeStore()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dinner-money-backup.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function importJson(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        applyToStore(ev.target?.result as string)
      } catch {
        alert('Failed to import — invalid JSON')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const isBusy = phase === 'syncing'

  return (
    <div className="space-y-4">

      {/* Config: Client ID + folder */}
      <div className="space-y-2">
        <div>
          <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
            Google OAuth Client ID
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800 font-mono"
              placeholder="123456789-abc….apps.googleusercontent.com"
              value={clientIdInput}
              onChange={e => setClientIdInput(e.target.value)}
            />
            <Button onClick={() => {
              saveClientId(clientIdInput.trim())
              if (clientIdInput.trim() && phase === 'unconfigured') setPhase('disconnected')
              if (!clientIdInput.trim()) setPhase('unconfigured')
            }}>Save</Button>
          </div>
        </div>
        <div>
          <label className="block text-[11px] text-gray-500 dark:text-gray-400 mb-1">
            Drive folder
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              className="w-48 h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
              placeholder="DinnerMoney"
              value={folderInput}
              onChange={e => setFolderInput(e.target.value)}
            />
            <Button onClick={() => saveDriveFolder(folderInput)}>Save</Button>
          </div>
          <p className="text-[10.5px] text-gray-400 mt-1">
            File will be at{' '}
            <a href="https://drive.google.com" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
              My Drive / {folderInput || 'DinnerMoney'} / dinner-money-backup.enc
            </a>
          </p>
        </div>
        <details>
          <summary className="text-[11px] text-blue-600 dark:text-blue-400 cursor-pointer select-none">
            How to get a Client ID
          </summary>
          <ol className="mt-2 ml-4 space-y-1 list-decimal text-[11px] text-gray-500 dark:text-gray-400">
            <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Google Cloud Console</a> and create a project</li>
            <li>Go to <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">APIs & Services → Library → Google Drive API</a> and click <strong>Enable</strong></li>
            <li>Go to <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">OAuth consent screen</a>: choose External, fill in app name, add your email as a test user</li>
            <li>Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Credentials</a> → Create credentials → OAuth 2.0 Client ID → Web application</li>
            <li>Under <em>Authorized JavaScript origins</em> add your app URL (e.g. <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">http://localhost:5173</code>)</li>
            <li>Copy the Client ID and paste it above</li>
          </ol>
        </details>
      </div>

      {/* Drive sync status */}
      {phase === 'unconfigured' && (
        <p className="text-[11.5px] text-gray-400">Configure a Client ID above to enable Drive sync.</p>
      )}
      {phase === 'disconnected' && (
        <Button onClick={connect}>Connect Google Drive</Button>
      )}
      {(phase === 'authorizing' || phase === 'checking') && (
        <p className="text-[11.5px] text-gray-400">{phase === 'authorizing' ? 'Waiting for Google sign-in…' : 'Checking Drive…'}</p>
      )}
      {phase === 'needs-passphrase' && (
        <div className="rounded-[7px] border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 px-4 py-3 space-y-2">
          <p className="text-[12px] font-medium text-blue-800 dark:text-blue-200">
            {isNewBackup ? 'Set an encryption passphrase' : 'Enter your passphrase to unlock'}
          </p>
          <p className="text-[11px] text-blue-700 dark:text-blue-300">
            {isNewBackup
              ? 'Your backup will be encrypted with AES-256 before it reaches Google. You need this passphrase on any new browser.'
              : 'A backup exists on Drive. Enter the passphrase you set when you first connected.'}
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="password"
                autoFocus
                className="flex-1 h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                placeholder="Passphrase"
                value={passInput}
                onChange={e => { setPassInput(e.target.value); setPassError('') }}
                onKeyDown={e => { if (e.key === 'Enter' && !isNewBackup) submitPassphrase() }}
              />
              {!isNewBackup && (
                <Button onClick={submitPassphrase} disabled={!passInput.trim()}>Unlock & load</Button>
              )}
            </div>
            {isNewBackup && (
              <div className="flex gap-2">
                <input
                  type="password"
                  className="flex-1 h-[32px] border border-gray-300 dark:border-gray-600 rounded-[5px] px-3 text-[12px] bg-white dark:bg-gray-800"
                  placeholder="Confirm passphrase"
                  value={passConfirm}
                  onChange={e => { setPassConfirm(e.target.value); setPassError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') submitPassphrase() }}
                />
                <Button onClick={submitPassphrase} disabled={!passInput.trim() || !passConfirm.trim()}>Set & backup</Button>
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={disconnect}>Cancel</Button>
            </div>
          </div>
          {passError && <p className="text-[11px] text-red-500">{passError}</p>}
          {isNewBackup && (
            <p className="text-[10.5px] text-orange-600 dark:text-orange-400">
              ⚠ There is no recovery path if you forget this passphrase.
            </p>
          )}
        </div>
      )}
      {(phase === 'ready' || isBusy) && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[11.5px] text-green-600 dark:text-green-400 font-medium">✓ {userEmail}</span>
          <span className="text-[11px] text-gray-400">
            {isBusy ? 'Syncing…' : `Last saved ${fmtRelative(lastSynced)}`}
          </span>
          <Button onClick={save} disabled={isBusy}>Save now</Button>
          <Button onClick={loadFromDrive} disabled={isBusy}>Load from Drive</Button>
          <Button onClick={disconnect}>Disconnect</Button>
        </div>
      )}
      {phase === 'error' && (
        <div className="space-y-2">
          <p className="text-[11.5px] text-red-500">✗ {errorMsg}</p>
          <div className="flex gap-2">
            <Button onClick={save}>Retry</Button>
            <Button onClick={disconnect}>Disconnect</Button>
          </div>
        </div>
      )}

      {/* Local export / import / reset — always visible */}
      <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
        <p className="text-[11px] text-gray-400 mb-2">Local backup — unencrypted JSON, same data as the Drive backup</p>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={exportJson}>Export JSON</Button>
          <label className="cursor-pointer">
            <span className="inline-flex items-center rounded-[5px] border border-gray-300 dark:border-gray-600 px-[10px] py-[4px] text-[11.5px] text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800">
              Import JSON
            </span>
            <input type="file" accept=".json" className="hidden" onChange={importJson} />
          </label>
          <Button
            variant="danger"
            onClick={() => { if (confirm('Reset all data? This cannot be undone.')) localStorage.clear() }}
          >
            Reset all data
          </Button>
        </div>
      </div>

    </div>
  )
}
