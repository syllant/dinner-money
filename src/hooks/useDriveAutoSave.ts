import { useEffect } from 'react'
import { useAppStore } from '../store/useAppStore'
import {
  getToken, requestToken,
  getCachedKey, getStoredSalt,
  encryptPayload, driveUpload,
  LS_CONNECTED, LS_LAST_SYNCED,
} from '../lib/googleDriveSync'
import { serializeStore } from '../lib/storeSerializer'

async function trySave(): Promise<void> {
  if (!localStorage.getItem(LS_CONNECTED)) return
  const key  = await getCachedKey()
  const salt = getStoredSalt()
  if (!key || !salt) return

  let token = getToken()
  if (!token) {
    try { token = await requestToken('') } catch { return }
  }

  const blob = await encryptPayload(key, serializeStore(), salt)
  await driveUpload(token, blob)
  localStorage.setItem(LS_LAST_SYNCED, new Date().toISOString())
}

export function useDriveAutoSave(): void {
  useEffect(() => {
    if (!localStorage.getItem(LS_CONNECTED)) return

    let timer = 0 as unknown as ReturnType<typeof setTimeout>
    const unsub = useAppStore.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        trySave().catch(err => console.warn('[Drive] Auto-save failed:', err))
      }, 3_000)
    })
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [])
}
