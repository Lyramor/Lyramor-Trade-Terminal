/**
 * Full-screen login gate — shown when `/api/auth/status` reports
 * `authed:false` and `tokenConfigured:true`.
 *
 * Presented as a plain username + password form (no mention of the
 * admin-token mechanics — an ordinary-looking login draws less
 * attention on a public URL). The backend verifies the pair against
 * the scrypt record in auth.json.
 *
 * Failed attempts surface the backend throttle state: remaining tries
 * before the per-IP lockout, and a live countdown while locked out.
 */

import { useState, useRef, useEffect, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useAuth } from './AuthContext'
import { login } from './api'
import { useTranslation } from 'react-i18next'

export function LoginPage() {
  const { t } = useTranslation()
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [lockSeconds, setLockSeconds] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Lockout countdown — ticks once per second while locked.
  useEffect(() => {
    if (lockSeconds <= 0) return
    const id = setInterval(() => setLockSeconds((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [lockSeconds > 0])

  const locked = lockSeconds > 0

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password || locked) return
    setBusy(true); setError(null)
    const result = await login(username.trim(), password)
    if (!result.ok) {
      if (result.retryAfterSeconds != null) {
        setLockSeconds(result.retryAfterSeconds)
        setRemaining(null)
        setError(null)
      } else {
        setError(t('auth.loginFailed'))
        setRemaining(result.remaining ?? null)
      }
      setBusy(false)
      return
    }
    await refresh()
    // AuthContext flips to 'authed'; this component unmounts.
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[400px] rounded-lg border border-border bg-surface px-6 py-7 shadow-sm">
        <h1 className="text-[18px] font-semibold text-text mb-1">{t('auth.heading')}</h1>
        <p className="text-[12px] text-text-muted leading-relaxed mb-5">
          {t('auth.instruction')}
        </p>

        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] uppercase tracking-wide text-text-muted mb-1">
              {t('auth.usernameLabel')}
            </label>
            <input
              ref={inputRef}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy || locked}
              className="w-full rounded border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text focus:outline-none focus:border-accent disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-[11px] uppercase tracking-wide text-text-muted mb-1">
              {t('auth.passwordLabel')}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy || locked}
                className="w-full rounded border border-border bg-bg pl-2.5 pr-9 py-1.5 text-[13px] text-text focus:outline-none focus:border-accent disabled:opacity-60"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                className="absolute inset-y-0 right-0 flex items-center px-2.5 text-text-muted hover:text-text"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">
              {error}
              {remaining != null && (
                <div className="mt-0.5 text-[11px] opacity-80">
                  {t('auth.attemptsRemaining', { n: remaining })}
                </div>
              )}
            </div>
          )}

          {locked && (
            <div className="rounded border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">
              {t('auth.lockedOut', { seconds: lockSeconds })}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || locked || !username.trim() || !password}
            className="btn-primary w-full justify-center"
          >
            {busy ? t('auth.signingIn') : t('auth.signIn')}
          </button>
        </form>
      </div>
    </div>
  )
}

export function NoTokenPage() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[460px] rounded-lg border border-border bg-surface px-6 py-7">
        <h1 className="text-[18px] font-semibold text-text mb-2">{t('auth.noTokenHeading')}</h1>
        <p className="text-[13px] text-text leading-relaxed mb-3">
          The backend did not generate <code className="font-mono">data/config/auth.json</code>.
          This usually means bootstrap was skipped via <code className="font-mono">OPENALICE_DISABLE_AUTH=1</code>,
          or the file was created empty.
        </p>
        <p className="text-[12px] text-text-muted leading-relaxed">
          Stop the backend, delete <code className="font-mono">data/config/auth.json</code> if it exists,
          unset <code className="font-mono">OPENALICE_DISABLE_AUTH</code>, and restart. The first-run
          token will be printed to stdout.
        </p>
      </div>
    </div>
  )
}
