/**
 * Login attempt throttle — in-memory, per client IP.
 *
 * Complements the reverse proxy's request-rate limit with *semantic*
 * feedback: the proxy can only drop excess requests, while this layer
 * knows the difference between a failed and a successful login, counts
 * failures inside a rolling window, and can tell the UI how many
 * attempts remain before a lockout.
 *
 * Deliberately in-memory: a restart clears all counters, which is an
 * acceptable trade for a single-operator deployment (an attacker who can
 * restart the process already owns the box). Nothing here is persisted,
 * so nothing can leak via backups.
 */

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60_000 // failures older than this are forgotten
const LOCKOUT_MS = 15 * 60_000 // lockout duration once MAX_ATTEMPTS is hit

interface Entry {
  /** Timestamps (ms) of failures inside the current window. */
  failures: number[]
  /** When set, all attempts are rejected until this time (ms). */
  lockedUntil?: number
}

const entries = new Map<string, Entry>()

export interface AttemptGate {
  allowed: boolean
  /** Present when `allowed` is false. */
  retryAfterSeconds?: number
}

/** Call BEFORE verifying credentials. Rejects while locked out. */
export function checkAttempt(ip: string, now = Date.now()): AttemptGate {
  prune(now)
  const entry = entries.get(ip)
  if (entry?.lockedUntil && entry.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.lockedUntil - now) / 1000) }
  }
  return { allowed: true }
}

export interface FailureRecord {
  /** Attempts left before lockout. 0 means this failure triggered it. */
  remaining: number
  /** Present when this failure triggered the lockout. */
  retryAfterSeconds?: number
}

/** Call after a WRONG credential. Returns how many attempts remain. */
export function recordFailure(ip: string, now = Date.now()): FailureRecord {
  const entry = entries.get(ip) ?? { failures: [] }
  entry.failures = entry.failures.filter((t) => now - t < WINDOW_MS)
  entry.failures.push(now)
  const remaining = Math.max(0, MAX_ATTEMPTS - entry.failures.length)
  if (remaining === 0) {
    entry.lockedUntil = now + LOCKOUT_MS
    entry.failures = []
  }
  entries.set(ip, entry)
  return remaining === 0
    ? { remaining, retryAfterSeconds: Math.ceil(LOCKOUT_MS / 1000) }
    : { remaining }
}

/** Call after a CORRECT credential — clears the counter for this IP. */
export function recordSuccess(ip: string): void {
  entries.delete(ip)
}

/** Drop stale entries so the map can't grow unboundedly. */
function prune(now: number): void {
  for (const [ip, entry] of entries) {
    const lockExpired = !entry.lockedUntil || entry.lockedUntil <= now
    const failuresStale = entry.failures.every((t) => now - t >= WINDOW_MS)
    if (lockExpired && failuresStale) entries.delete(ip)
  }
}

/** Test hook — resets all state. */
export function resetLoginThrottle(): void {
  entries.clear()
}
