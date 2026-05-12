// Google Drive sync — AES-256-GCM encrypted backup
//
// Blob layout on Drive: [salt:16B][iv:12B][AES-GCM ciphertext]
// Salt is embedded so any browser can re-derive the key from passphrase alone.
// The key itself is cached in IndexedDB (non-extractable) with a 7-day TTL.

// ── GIS type declarations ─────────────────────────────────────────────────────

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: GisTokenClientConfig): GisTokenClient
        }
      }
    }
  }
}

interface GisTokenClientConfig {
  client_id: string
  scope: string
  callback: (r: GisTokenResponse) => void
  error_callback?: (e: { type: string }) => void
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void
}
interface GisTokenResponse {
  access_token?: string
  error?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IDB_DB      = 'dinner-money-crypto'
const IDB_STORE   = 'keys'
const IDB_KEY     = 'main'
const KEY_TTL_MS  = 7 * 24 * 60 * 60 * 1000   // 7 days
const PBKDF2_ITER = 600_000

const DRIVE_SCOPE            = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_FILE             = 'dinner-money-backup.enc'
const DRIVE_FOLDER_DEFAULT   = 'DinnerMoney'
export const LS_FOLDER       = 'dinner-money:drive-folder'

export function getDriveFolder(): string {
  return localStorage.getItem(LS_FOLDER) || DRIVE_FOLDER_DEFAULT
}
export function saveDriveFolder(name: string): void {
  const trimmed = name.trim()
  if (trimmed && trimmed !== DRIVE_FOLDER_DEFAULT) localStorage.setItem(LS_FOLDER, trimmed)
  else localStorage.removeItem(LS_FOLDER)
}
const DRIVE_FILES  = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'

export const LS_CLIENT_ID    = 'dinner-money:google-client-id'
export const LS_CONNECTED    = 'dinner-money:drive-connected'  // 'true' | absent
export const LS_USER_EMAIL   = 'dinner-money:drive-user'
export const LS_SALT         = 'dinner-money:drive-salt'       // base64 Uint8Array(16)
export const LS_LAST_SYNCED  = 'dinner-money:drive-last-synced'

// ── Module-level OAuth state (reset on page reload) ───────────────────────────

let _token: string | null = null
let _client: GisTokenClient | null = null
const _resolvers: Array<(t: string) => void> = []
const _rejectors: Array<(e: string) => void> = []

export function getToken(): string | null { return _token }
export function clearToken(): void { _token = null }

export function getClientId(): string {
  return localStorage.getItem(LS_CLIENT_ID) ?? ''
}
export function saveClientId(id: string): void {
  if (id) localStorage.setItem(LS_CLIENT_ID, id)
  else localStorage.removeItem(LS_CLIENT_ID)
  _client = null  // force re-init on next request
}

function buildGisClient(clientId: string): GisTokenClient {
  if (!window.google?.accounts?.oauth2)
    throw new Error('Google Identity Services script not loaded')
  return window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: DRIVE_SCOPE,
    callback: (r) => {
      const resolvers = _resolvers.splice(0)
      const rejectors = _rejectors.splice(0)
      if (r.access_token) {
        _token = r.access_token
        resolvers.forEach(fn => fn(r.access_token!))
      } else {
        rejectors.forEach(fn => fn(r.error ?? 'oauth_error'))
      }
    },
    error_callback: (e) => {
      const rejectors = _rejectors.splice(0)
      _resolvers.splice(0)
      rejectors.forEach(fn => fn(e.type))
    },
  })
}

export function requestToken(prompt: 'select_account' | '' = ''): Promise<string> {
  return new Promise((resolve, reject) => {
    const clientId = getClientId()
    if (!clientId) { reject(new Error('No Google Client ID configured')); return }
    if (!_client) _client = buildGisClient(clientId)
    _resolvers.push(resolve)
    _rejectors.push(reject)
    _client.requestAccessToken({ prompt })
  })
}

// ── Salt helpers ──────────────────────────────────────────────────────────────

export function getStoredSalt(): Uint8Array | null {
  const s = localStorage.getItem(LS_SALT)
  if (!s) return null
  try { return Uint8Array.from(atob(s), c => c.charCodeAt(0)) } catch { return null }
}

export function storeSalt(salt: Uint8Array): void {
  localStorage.setItem(LS_SALT, btoa(String.fromCharCode(...Array.from(salt))))
}

// ── IDB key cache ─────────────────────────────────────────────────────────────

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getCachedKey(): Promise<CryptoKey | null> {
  try {
    const db = await openIdb()
    return new Promise(resolve => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(IDB_KEY)
      req.onsuccess = () => {
        const e = req.result as { key: CryptoKey; expiresAt: number } | undefined
        resolve(e && Date.now() < e.expiresAt ? e.key : null)
      }
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

export async function setCachedKey(key: CryptoKey): Promise<void> {
  try {
    const db = await openIdb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put({ key, expiresAt: Date.now() + KEY_TTL_MS }, IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {}
}

export async function clearCachedKey(): Promise<void> {
  try {
    const db = await openIdb()
    await new Promise<void>(resolve => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).delete(IDB_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {}
}

// ── Crypto ────────────────────────────────────────────────────────────────────

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptPayload(
  key: CryptoKey, plaintext: string, salt: Uint8Array,
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext),
  )
  const out = new Uint8Array(28 + ct.byteLength)
  out.set(salt, 0); out.set(iv, 16); out.set(new Uint8Array(ct), 28)
  return out.buffer
}

export async function decryptPayload(
  key: CryptoKey, blob: ArrayBuffer,
): Promise<{ text: string; salt: Uint8Array }> {
  const b = new Uint8Array(blob)
  if (b.length < 29) throw new Error('Blob too short')
  const salt = b.slice(0, 16)
  const iv   = b.slice(16, 28)
  const ct   = b.slice(28)
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  } catch {
    throw new Error('Wrong passphrase or corrupted backup')
  }
  return { text: new TextDecoder().decode(plain), salt }
}

// ── Drive API ─────────────────────────────────────────────────────────────────

async function driveReq(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined ?? {}),
    },
  })
  if (!res.ok) {
    let detail = ''
    try { detail = ((await res.clone().json()) as any)?.error?.message ?? '' } catch {}
    throw new Error(`Drive API ${res.status}${detail ? ` — ${detail}` : ''}`)
  }
  return res
}

async function findOrCreateFolder(token: string): Promise<string> {
  const folderName = getDriveFolder()
  const q = encodeURIComponent(
    `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const list = await driveReq(`${DRIVE_FILES}?q=${q}&fields=files(id)`, token)
  const { files } = await list.json() as { files: Array<{ id: string }> }
  if (files[0]?.id) return files[0].id
  const created = await driveReq(DRIVE_FILES, token, {
    method: 'POST',
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }),
    headers: { 'Content-Type': 'application/json' },
  })
  return ((await created.json()) as { id: string }).id
}

async function findFileId(token: string, folderId: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${DRIVE_FILE}' and '${folderId}' in parents and trashed=false`)
  const res = await driveReq(`${DRIVE_FILES}?q=${q}&fields=files(id)`, token)
  const { files } = await res.json() as { files: Array<{ id: string }> }
  return files[0]?.id ?? null
}

export async function driveFileExists(token: string): Promise<boolean> {
  const folderId = await findOrCreateFolder(token)
  return (await findFileId(token, folderId)) !== null
}

export async function driveDownload(token: string): Promise<ArrayBuffer | null> {
  const folderId = await findOrCreateFolder(token)
  const id = await findFileId(token, folderId)
  if (!id) return null
  return (await driveReq(`${DRIVE_FILES}/${id}?alt=media`, token)).arrayBuffer()
}

export async function driveUpload(token: string, data: ArrayBuffer): Promise<void> {
  const folderId = await findOrCreateFolder(token)
  const id = await findFileId(token, folderId)
  if (id) {
    await driveReq(`${DRIVE_UPLOAD}/${id}?uploadType=media`, token, {
      method: 'PATCH', body: data,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    return
  }
  // Create new file in the DinnerMoney folder via multipart upload
  const enc  = new TextEncoder()
  const meta = JSON.stringify({ name: DRIVE_FILE, parents: [folderId] })
  const bnd  = 'dm_bnd_8f2k'
  const head = enc.encode(`--${bnd}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${bnd}\r\nContent-Type: application/octet-stream\r\n\r\n`)
  const tail = enc.encode(`\r\n--${bnd}--`)
  const body = new Uint8Array(head.length + data.byteLength + tail.length)
  body.set(head, 0)
  body.set(new Uint8Array(data), head.length)
  body.set(tail, head.length + data.byteLength)
  await driveReq(`${DRIVE_UPLOAD}?uploadType=multipart`, token, {
    method: 'POST', body: body.buffer,
    headers: { 'Content-Type': `multipart/related; boundary="${bnd}"` },
  })
}
