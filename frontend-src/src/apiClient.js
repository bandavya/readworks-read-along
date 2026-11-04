// The AWS lab API.
// One build-time setting, VITE_API_BASE (for example https://api.example.test). When it is
// not set, `apiBase` is null and every caller keeps today's behavior: assignments go to the local Express server,
// feedback stays on the device, review choices stay in the browser. Nothing here is ever called without a base.
import { PUBLIC_SAMPLE } from './mode.js'

// Pure and exported so a harness can check it without Vite: trims, drops trailing slashes, refuses anything that is
// not an http(s) URL (a typo must not silently send data somewhere else).
export function normalizeApiBase(raw) {
  const value = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!value) return null
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:' ? value : null
  } catch { return null }
}

// The public sample build never talks to a server.
export const apiBase = PUBLIC_SAMPLE ? null : normalizeApiBase(import.meta.env && import.meta.env.VITE_API_BASE)

export async function apiRequest(path, { method = 'GET', body, timeoutMs = 5000 } = {}) {
  if (!apiBase) throw new Error('No API configured')
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`API ${path}: ${response.status}`)
  return response.json()
}

// Send review choices in chunks the API accepts (100 per request). Resolves to { stored, skippedOlder }.
export async function sendReviews(exported, chunk = 100, request = apiRequest) {
  const total = { stored: 0, skippedOlder: 0 }
  for (let i = 0; i < exported.decisions.length; i += chunk) {
    const part = { schema: exported.schema, reviewer: exported.reviewer, decisions: exported.decisions.slice(i, i + chunk) }
    const r = await request('/api/reviews', { method: 'POST', body: part, timeoutMs: 15000 })
    total.stored += r.stored
    total.skippedOlder += r.skippedOlder
  }
  return total
}
