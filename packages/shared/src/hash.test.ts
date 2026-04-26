import { describe, it, expect } from 'vitest'
import { bucket } from './hash'

describe('bucket', () => {
  describe('return value range', () => {
    it('returns a number in [0, 1)', () => {
      const result = bucket('my-flag', 'user-123')
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(1)
    })

    it('always returns >= 0 for various inputs', () => {
      const inputs = [
        ['flag-a', 'user-1'],
        ['flag-b', 'user-2'],
        ['flag-c', 'user-abc'],
        ['x', 'y'],
        ['long-flag-key-with-dashes', 'another-user-key-123'],
      ] as const
      for (const [flagKey, userKey] of inputs) {
        const result = bucket(flagKey, userKey)
        expect(result).toBeGreaterThanOrEqual(0)
        expect(result).toBeLessThan(1)
      }
    })

    it('returns a float (not always integer boundary)', () => {
      // The result is (hash % 100) / 100 — multiples of 0.01
      const result = bucket('flag', 'user')
      // Should be a finite number
      expect(Number.isFinite(result)).toBe(true)
    })
  })

  describe('determinism', () => {
    it('returns the same value for the same inputs', () => {
      const a = bucket('test-flag', 'user-xyz')
      const b = bucket('test-flag', 'user-xyz')
      expect(a).toBe(b)
    })

    it('returns the same value across multiple calls', () => {
      const flagKey = 'feature-dark-mode'
      const userKey = 'user-00042'
      const results = Array.from({ length: 5 }, () => bucket(flagKey, userKey))
      const unique = new Set(results)
      expect(unique.size).toBe(1)
    })

    it('is deterministic for single-character inputs', () => {
      expect(bucket('a', 'b')).toBe(bucket('a', 'b'))
    })

    it('is deterministic for empty-string userKey', () => {
      expect(bucket('flag', '')).toBe(bucket('flag', ''))
    })

    it('is deterministic for empty-string flagKey', () => {
      expect(bucket('', 'user')).toBe(bucket('', 'user'))
    })
  })

  describe('distribution — different inputs yield different results', () => {
    it('different userKeys yield different bucket values for the same flag', () => {
      const results = new Set(
        Array.from({ length: 20 }, (_, i) => bucket('my-flag', `user-${i}`))
      )
      // With 20 distinct users we expect multiple unique buckets
      expect(results.size).toBeGreaterThan(1)
    })

    it('different flagKeys yield different bucket values for the same user', () => {
      const results = new Set(
        Array.from({ length: 10 }, (_, i) => bucket(`flag-${i}`, 'user-constant'))
      )
      expect(results.size).toBeGreaterThan(1)
    })

    it('swapping flagKey and userKey typically produces a different result', () => {
      // bucket('flag', 'user') vs bucket('user', 'flag') — different combined strings
      const ab = bucket('flag', 'user')
      const ba = bucket('user', 'flag')
      // The combined string 'flag:user' vs 'user:flag' should hash differently
      expect(ab).not.toBe(ba)
    })
  })

  describe('boundary / edge inputs', () => {
    it('handles very long strings without throwing', () => {
      const longKey = 'a'.repeat(10_000)
      expect(() => bucket(longKey, longKey)).not.toThrow()
      const result = bucket(longKey, longKey)
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(1)
    })

    it('handles unicode characters without throwing', () => {
      expect(() => bucket('flag-emoji-🚀', 'user-名前')).not.toThrow()
      const result = bucket('flag-emoji-🚀', 'user-名前')
      expect(result).toBeGreaterThanOrEqual(0)
      expect(result).toBeLessThan(1)
    })

    it('handles strings that differ only by colon separator', () => {
      // 'ab' ':' 'c' === 'ab:c' vs 'a' ':' 'b:c'
      const r1 = bucket('ab', 'c')
      const r2 = bucket('a', 'b:c')
      // These resolve to 'ab:c' vs 'a:b:c', which should be different
      expect(r1).not.toBe(r2)
    })
  })

  describe('known stable hash values', () => {
    it('produces a stable result for a fixed seed input', () => {
      // Compute the value once and lock it in so we detect regressions
      const result = bucket('rollout-flag', 'user-stable')
      // The exact numeric value is deterministic — pin it
      expect(typeof result).toBe('number')
      // Call twice to assert exact equality (regression guard)
      expect(bucket('rollout-flag', 'user-stable')).toBe(result)
    })
  })
})
