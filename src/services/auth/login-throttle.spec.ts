import { describe, it, expect, beforeEach } from 'vitest'
import {
  checkAttempt,
  recordFailure,
  recordSuccess,
  resetLoginThrottle,
} from './login-throttle.js'

const T0 = 1_000_000_000_000
const MIN = 60_000

describe('login-throttle', () => {
  beforeEach(() => resetLoginThrottle())

  it('allows a fresh IP', () => {
    expect(checkAttempt('1.2.3.4', T0)).toEqual({ allowed: true })
  })

  it('counts down remaining across failures', () => {
    expect(recordFailure('1.2.3.4', T0).remaining).toBe(4)
    expect(recordFailure('1.2.3.4', T0 + 1).remaining).toBe(3)
    expect(recordFailure('1.2.3.4', T0 + 2).remaining).toBe(2)
  })

  it('locks out after the 5th failure and reports retryAfterSeconds', () => {
    for (let i = 0; i < 4; i++) recordFailure('1.2.3.4', T0 + i)
    const fifth = recordFailure('1.2.3.4', T0 + 4)
    expect(fifth.remaining).toBe(0)
    expect(fifth.retryAfterSeconds).toBeGreaterThan(0)

    const gate = checkAttempt('1.2.3.4', T0 + 5)
    expect(gate.allowed).toBe(false)
    expect(gate.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('lockout expires after the lockout window', () => {
    for (let i = 0; i < 5; i++) recordFailure('1.2.3.4', T0 + i)
    expect(checkAttempt('1.2.3.4', T0 + 16 * MIN).allowed).toBe(true)
  })

  it('failures outside the rolling window are forgotten', () => {
    for (let i = 0; i < 4; i++) recordFailure('1.2.3.4', T0 + i)
    // 16 minutes later the old failures no longer count
    expect(recordFailure('1.2.3.4', T0 + 16 * MIN).remaining).toBe(4)
  })

  it('success clears the counter', () => {
    recordFailure('1.2.3.4', T0)
    recordFailure('1.2.3.4', T0 + 1)
    recordSuccess('1.2.3.4')
    expect(recordFailure('1.2.3.4', T0 + 2).remaining).toBe(4)
  })

  it('IPs are tracked independently', () => {
    for (let i = 0; i < 5; i++) recordFailure('1.2.3.4', T0 + i)
    expect(checkAttempt('1.2.3.4', T0 + 10).allowed).toBe(false)
    expect(checkAttempt('5.6.7.8', T0 + 10).allowed).toBe(true)
  })
})
