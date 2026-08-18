/**
 * Auth API client — talks to /api/auth/{login, logout, status}.
 *
 * Uses raw fetch (not `fetchJson`) because we need to inspect status codes
 * ourselves; 401 from the auth endpoints is meaningful, not an error to
 * funnel through the global unauthorized handler.
 */

export interface AuthStatus {
  authed: boolean
  tokenConfigured: boolean
  session?: { createdAt: string; lastSeenAt: string }
}

export async function getStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth/status', { credentials: 'same-origin' })
  if (!res.ok) {
    // If the backend can't even serve /status, treat as "auth required"
    // pessimistically — better than locking the user out of the login page.
    return { authed: false, tokenConfigured: true }
  }
  return res.json()
}

export interface LoginResult {
  ok: boolean
  error?: string
  /** Failed attempts left before a temporary lockout (present on 401). */
  remaining?: number
  /** Seconds until login reopens (present on 429 lockout). */
  retryAfterSeconds?: number
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ username, password }),
  })
  if (res.ok) return { ok: true }
  // 429 can also come from the reverse proxy's rate limit, whose body is
  // HTML — the .catch keeps that path on the generic-error message.
  const body = await res.json().catch(() => ({}))
  return {
    ok: false,
    error: body.error ?? `HTTP ${res.status}`,
    remaining: typeof body.remaining === 'number' ? body.remaining : undefined,
    retryAfterSeconds:
      res.status === 429
        ? typeof body.retryAfterSeconds === 'number'
          ? body.retryAfterSeconds
          : 60
        : undefined,
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  })
}
