import type { R2Bucket } from '@cloudflare/workers-types'

export interface Env {
  THESIS_BUCKET: R2Bucket
  AUTH_SECRET: string
  CORS_ORIGINS?: string
}

type JsonRecord = Record<string, unknown>

type UserData = {
  username: string
  createdAt: string
  comments: CommentEntry[]
}

type CommentEntry = {
  id: string
  threadId: string
  text: string
  createdAt: string
}

const USERNAME_RE = /^[a-z0-9][a-z0-9_-]{2,31}$/
const MAX_TEXT_LEN = 4000
const MAX_COMMENTS_PER_USER = 2000
const MAX_USERS_SCAN = 500

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return withCors(new Response(null, { status: 204 }), request, env)
    }

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return withCors(json({ ok: true, ts: new Date().toISOString() }), request, env)
      }

      // Users
      if (url.pathname === '/users' && request.method === 'POST') {
        const body = await readJson(request)
        const username = normalizeUsername(String(body.username ?? ''))
        assertUsername(username)

        const key = userKey(username)
        const existing = await env.THESIS_BUCKET.head(key)
        if (!existing) {
          const data: UserData = { username, createdAt: new Date().toISOString(), comments: [] }
          await env.THESIS_BUCKET.put(key, JSON.stringify(data), {
            httpMetadata: { contentType: 'application/json; charset=utf-8' },
          })
        }

        const token = await signToken({ u: username, iat: Date.now() }, env.AUTH_SECRET)
        return withCors(json({ username, token }), request, env)
      }

      const userMatch = url.pathname.match(/^\/users\/([^/]+)$/)
      if (userMatch && request.method === 'GET') {
        const username = normalizeUsername(decodeURIComponent(userMatch[1]))
        assertUsername(username)
        const exists = !!(await env.THESIS_BUCKET.head(userKey(username)))
        return withCors(json({ username, exists }), request, env)
      }

      if (url.pathname === '/me' && request.method === 'GET') {
        const auth = await requireAuth(request, env)
        return withCors(json({ username: auth.username }), request, env)
      }

      // Threads
      const threadCommentsGet = url.pathname.match(/^\/threads\/([^/]+)\/comments$/)
      if (threadCommentsGet && request.method === 'GET') {
        const threadId = decodeURIComponent(threadCommentsGet[1])
        assertThreadId(threadId)

        const comments = await listCommentsForThread(env, threadId)
        return withCors(json({ threadId, comments }), request, env)
      }

      const threadCommentsPost = url.pathname.match(/^\/threads\/([^/]+)\/comments$/)
      if (threadCommentsPost && request.method === 'POST') {
        const auth = await requireAuth(request, env)
        const threadId = decodeURIComponent(threadCommentsPost[1])
        assertThreadId(threadId)

        const body = await readJson(request)
        const text = String(body.text ?? '').trim()
        if (!text) return withCors(jsonError('text_required', 400), request, env)
        if (text.length > MAX_TEXT_LEN) return withCors(jsonError('text_too_long', 400), request, env)

        const comment: CommentEntry = {
          id: crypto.randomUUID(),
          threadId,
          text,
          createdAt: new Date().toISOString(),
        }

        await appendUserComment(env, auth.username, comment)
        return withCors(json({ ok: true, comment }), request, env)
      }

      const deleteMatch = url.pathname.match(/^\/threads\/([^/]+)\/comments\/([^/]+)$/)
      if (deleteMatch && request.method === 'DELETE') {
        const auth = await requireAuth(request, env)
        const threadId = decodeURIComponent(deleteMatch[1])
        const commentId = decodeURIComponent(deleteMatch[2])
        assertThreadId(threadId)
        if (!commentId) return withCors(jsonError('comment_id_required', 400), request, env)

        const deleted = await deleteUserComment(env, auth.username, threadId, commentId)
        return withCors(json({ ok: true, deleted }), request, env)
      }

      return withCors(jsonError('not_found', 404), request, env)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error'
      const status = err instanceof HttpError ? err.status : 500
      return withCors(json({ ok: false, error: message }), request, env, status)
    }
  },
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function json(body: JsonRecord | unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function jsonError(code: string, status: number): Response {
  return json({ ok: false, error: code }, status)
}

async function readJson(request: Request): Promise<JsonRecord> {
  const text = await request.text()
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as JsonRecord
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
}

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

function assertUsername(username: string) {
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(400, 'invalid_username')
  }
}

function assertThreadId(threadId: string) {
  // Keep it simple: URL-safe-ish plus slashes/dots for section ids.
  if (!threadId || threadId.length > 120) throw new HttpError(400, 'invalid_thread')
  if (!/^[a-zA-Z0-9._\-\/]+$/.test(threadId)) throw new HttpError(400, 'invalid_thread')
}

function userKey(username: string): string {
  return `thesis/${username}/data.json`
}

function parseCorsOrigins(env: Env): string[] {
  const raw = env.CORS_ORIGINS ?? ''
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function withCors(resp: Response, req: Request, env: Env, overrideStatus?: number): Response {
  const origin = req.headers.get('origin')
  const allowed = parseCorsOrigins(env)
  const headers = new Headers(resp.headers)

  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    headers.set('access-control-allow-origin', origin)
    headers.set('vary', 'Origin')
  }
  headers.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
  headers.set('access-control-allow-headers', 'content-type,authorization')
  headers.set('access-control-max-age', '86400')

  return new Response(resp.body, {
    status: overrideStatus ?? resp.status,
    headers,
  })
}

async function requireAuth(request: Request, env: Env): Promise<{ username: string }> {
  const hdr = request.headers.get('authorization') ?? ''
  const token = hdr.startsWith('Bearer ') ? hdr.slice('Bearer '.length).trim() : ''
  if (!token) throw new HttpError(401, 'missing_token')

  const payload = await verifyToken(token, env.AUTH_SECRET)
  const username = normalizeUsername(String(payload.u ?? ''))
  assertUsername(username)
  return { username }
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes))
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlDecodeToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

async function signToken(payload: JsonRecord, secret: string): Promise<string> {
  if (!secret) throw new Error('AUTH_SECRET_not_set')
  const enc = new TextEncoder()
  const payloadBytes = enc.encode(JSON.stringify(payload))
  const key = await importHmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, payloadBytes)
  return `${base64UrlEncode(payloadBytes)}.${base64UrlEncode(sig)}`
}

async function verifyToken(token: string, secret: string): Promise<JsonRecord> {
  if (!secret) throw new Error('AUTH_SECRET_not_set')
  const parts = token.split('.')
  if (parts.length !== 2) throw new HttpError(401, 'invalid_token')

  const payloadBytes = base64UrlDecodeToBytes(parts[0])
  const sigBytes = base64UrlDecodeToBytes(parts[1])

  const key = await importHmacKey(secret)
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes)
  if (!ok) throw new HttpError(401, 'invalid_token')

  try {
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes))
    if (!payload || typeof payload !== 'object') throw new Error('bad')
    return payload as JsonRecord
  } catch {
    throw new HttpError(401, 'invalid_token')
  }
}

async function readUserData(env: Env, username: string): Promise<UserData> {
  const obj = await env.THESIS_BUCKET.get(userKey(username))
  if (!obj) throw new HttpError(404, 'user_not_found')
  const text = await obj.text()
  const parsed = JSON.parse(text) as Partial<UserData>

  return {
    username,
    createdAt: String(parsed.createdAt ?? new Date().toISOString()),
    comments: Array.isArray(parsed.comments) ? (parsed.comments as CommentEntry[]) : [],
  }
}

async function writeUserData(env: Env, username: string, data: UserData): Promise<void> {
  await env.THESIS_BUCKET.put(userKey(username), JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
}

async function appendUserComment(env: Env, username: string, comment: CommentEntry): Promise<void> {
  const data = await readUserData(env, username)
  if (data.comments.length >= MAX_COMMENTS_PER_USER) throw new HttpError(400, 'too_many_comments')
  data.comments.push(comment)
  await writeUserData(env, username, data)
}

async function deleteUserComment(
  env: Env,
  username: string,
  threadId: string,
  commentId: string,
): Promise<boolean> {
  const data = await readUserData(env, username)
  const before = data.comments.length
  data.comments = data.comments.filter(c => !(c.threadId === threadId && c.id === commentId))
  const after = data.comments.length
  if (after === before) return false
  await writeUserData(env, username, data)
  return true
}

async function listCommentsForThread(env: Env, threadId: string): Promise<Array<CommentEntry & { username: string }>> {
  const out: Array<CommentEntry & { username: string }> = []

  let cursor: string | undefined = undefined
  let scanned = 0

  while (true) {
    const page = await env.THESIS_BUCKET.list({ prefix: 'thesis/', cursor, limit: 100 })
    cursor = page.truncated ? page.cursor : undefined

    for (const obj of page.objects) {
      if (!obj.key.endsWith('/data.json')) continue
      const parts = obj.key.split('/')
      if (parts.length !== 3) continue
      const username = parts[1]
      if (!USERNAME_RE.test(username)) continue

      scanned++
      if (scanned > MAX_USERS_SCAN) break

      const data = await readUserData(env, username)
      for (const c of data.comments) {
        if (c && c.threadId === threadId) {
          out.push({ ...c, username })
        }
      }
    }

    if (!cursor || scanned > MAX_USERS_SCAN) break
  }

  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return out
}
