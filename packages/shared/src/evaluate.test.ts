import { describe, it, expect } from 'vitest'
import { evaluate } from './evaluate'
import { bucket } from './hash'
import type { FlagConfig, EvaluationContext } from './schemas'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function booleanFlag(overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    key: 'test-flag',
    type: 'boolean',
    enabled: true,
    variants: [
      { key: 'off', value: false },
      { key: 'on', value: true },
    ],
    defaultVariantKey: 'off',
    rules: [],
    rollout: {},
    version: 1,
    ...overrides,
  }
}

function multivariateFlag(overrides: Partial<FlagConfig> = {}): FlagConfig {
  return {
    key: 'mv-flag',
    type: 'multivariate',
    enabled: true,
    variants: [
      { key: 'control', value: null },
      { key: 'treatment-a', value: 'A' },
      { key: 'treatment-b', value: 'B' },
    ],
    defaultVariantKey: 'control',
    rules: [],
    rollout: {},
    version: 1,
    ...overrides,
  }
}

function ctx(key: string, attributes: Record<string, string | number | boolean> = {}): EvaluationContext {
  return { key, attributes }
}

// ---------------------------------------------------------------------------
// 1. Disabled flag
// ---------------------------------------------------------------------------

describe('disabled flag', () => {
  it('returns defaultVariantKey with reason disabled when flag is disabled', () => {
    const flag = booleanFlag({ enabled: false })
    const result = evaluate(flag, ctx('user-1'))
    expect(result.reason).toBe('disabled')
    expect(result.variantKey).toBe('off')
    expect(result.flagKey).toBe('test-flag')
  })

  it('returns the default variant value when disabled', () => {
    const flag = booleanFlag({ enabled: false })
    const result = evaluate(flag, ctx('user-1'))
    expect(result.value).toBe(false)
  })

  it('skips all rules when disabled', () => {
    const flag = booleanFlag({
      enabled: false,
      rules: [
        {
          id: 'rule-1',
          conditions: [{ attribute: 'country', operator: 'equals', values: ['US'] }],
          variantKey: 'on',
        },
      ],
    })
    const result = evaluate(flag, ctx('user-1', { country: 'US' }))
    expect(result.reason).toBe('disabled')
    expect(result.variantKey).toBe('off')
  })

  it('returns null value when default variant key does not exist in variants', () => {
    const flag: FlagConfig = {
      ...booleanFlag({ enabled: false }),
      defaultVariantKey: 'nonexistent',
    }
    const result = evaluate(flag, ctx('user-1'))
    expect(result.value).toBeNull()
    expect(result.variantKey).toBe('nonexistent')
  })
})

// ---------------------------------------------------------------------------
// 2. Rule matching
// ---------------------------------------------------------------------------

describe('rule matching', () => {
  describe('basic rule match', () => {
    it('returns rule variantKey with reason rule_match when rule matches', () => {
      const flag = booleanFlag({
        rules: [
          {
            id: 'r1',
            conditions: [{ attribute: 'role', operator: 'equals', values: ['admin'] }],
            variantKey: 'on',
          },
        ],
      })
      const result = evaluate(flag, ctx('user-1', { role: 'admin' }))
      expect(result.reason).toBe('rule_match')
      expect(result.variantKey).toBe('on')
      expect(result.ruleId).toBe('r1')
    })

    it('includes ruleId in result', () => {
      const flag = booleanFlag({
        rules: [
          {
            id: 'my-rule-id',
            conditions: [{ attribute: 'plan', operator: 'equals', values: ['pro'] }],
            variantKey: 'on',
          },
        ],
      })
      const result = evaluate(flag, ctx('u', { plan: 'pro' }))
      expect(result.ruleId).toBe('my-rule-id')
    })

    it('does not match a rule when condition does not match', () => {
      const flag = booleanFlag({
        rules: [
          {
            id: 'r1',
            conditions: [{ attribute: 'role', operator: 'equals', values: ['admin'] }],
            variantKey: 'on',
          },
        ],
      })
      const result = evaluate(flag, ctx('user-1', { role: 'viewer' }))
      expect(result.reason).not.toBe('rule_match')
    })
  })

  describe('first-match wins', () => {
    it('returns the first matching rule and ignores subsequent rules', () => {
      const flag = booleanFlag({
        rules: [
          {
            id: 'r1',
            conditions: [{ attribute: 'country', operator: 'equals', values: ['US'] }],
            variantKey: 'on',
          },
          {
            id: 'r2',
            conditions: [{ attribute: 'country', operator: 'equals', values: ['US'] }],
            variantKey: 'off',
          },
        ],
      })
      const result = evaluate(flag, ctx('u', { country: 'US' }))
      expect(result.ruleId).toBe('r1')
      expect(result.variantKey).toBe('on')
    })

    it('skips non-matching rules and picks the first match', () => {
      const flag = booleanFlag({
        rules: [
          {
            id: 'r1',
            conditions: [{ attribute: 'role', operator: 'equals', values: ['admin'] }],
            variantKey: 'on',
          },
          {
            id: 'r2',
            conditions: [{ attribute: 'country', operator: 'equals', values: ['US'] }],
            variantKey: 'on',
          },
        ],
      })
      const result = evaluate(flag, ctx('u', { role: 'viewer', country: 'US' }))
      expect(result.ruleId).toBe('r2')
    })
  })

  describe('multiple conditions in a rule (ALL must match)', () => {
    it('matches when all conditions are satisfied', () => {
      const flag = booleanFlag({
        rules: [
          {
            id: 'r1',
            conditions: [
              { attribute: 'role', operator: 'equals', values: ['admin'] },
              { attribute: 'country', operator: 'equals', values: ['US'] },
            ],
            variantKey: 'on',
          },
        ],
      })
      const result = evaluate(flag, ctx('u', { role: 'admin', country: 'US' }))
      expect(result.reason).toBe('rule_match')
    })

    it('does not match when only some conditions are satisfied', () => {
      const flag = booleanFlag({
        rules: [
          {
            id: 'r1',
            conditions: [
              { attribute: 'role', operator: 'equals', values: ['admin'] },
              { attribute: 'country', operator: 'equals', values: ['US'] },
            ],
            variantKey: 'on',
          },
        ],
      })
      const result = evaluate(flag, ctx('u', { role: 'admin', country: 'CA' }))
      expect(result.reason).not.toBe('rule_match')
    })
  })

  describe('empty rules array', () => {
    it('goes straight to rollout when rules array is empty', () => {
      const flag = booleanFlag({
        rules: [],
        rollout: { on: 100 },
      })
      const result = evaluate(flag, ctx('user-1'))
      expect(result.reason).toBe('rollout')
    })

    it('returns default when rules array is empty and no rollout', () => {
      const flag = booleanFlag({ rules: [], rollout: {} })
      const result = evaluate(flag, ctx('user-1'))
      expect(result.reason).toBe('default')
    })
  })
})

// ---------------------------------------------------------------------------
// 3. Operator tests
// ---------------------------------------------------------------------------

describe('operators', () => {
  function flagWithCondition(
    attribute: string,
    operator: FlagConfig['rules'][0]['conditions'][0]['operator'],
    values: (string | number)[]
  ): FlagConfig {
    return booleanFlag({
      rules: [
        {
          id: 'op-rule',
          conditions: [{ attribute, operator, values }],
          variantKey: 'on',
        },
      ],
    })
  }

  describe('equals', () => {
    it('matches when attribute equals value', () => {
      const flag = flagWithCondition('plan', 'equals', ['pro'])
      expect(evaluate(flag, ctx('u', { plan: 'pro' })).reason).toBe('rule_match')
    })

    it('does not match when attribute differs', () => {
      const flag = flagWithCondition('plan', 'equals', ['pro'])
      expect(evaluate(flag, ctx('u', { plan: 'free' })).reason).not.toBe('rule_match')
    })

    it('coerces numbers to strings for comparison', () => {
      const flag = flagWithCondition('version', 'equals', [42])
      expect(evaluate(flag, ctx('u', { version: 42 })).reason).toBe('rule_match')
    })

    it('matches string "42" with number 42 via coercion', () => {
      const flag = flagWithCondition('version', 'equals', [42])
      expect(evaluate(flag, ctx('u', { version: '42' })).reason).toBe('rule_match')
    })
  })

  describe('not_equals', () => {
    it('matches when attribute does not equal value', () => {
      const flag = flagWithCondition('plan', 'not_equals', ['free'])
      expect(evaluate(flag, ctx('u', { plan: 'pro' })).reason).toBe('rule_match')
    })

    it('does not match when attribute equals value', () => {
      const flag = flagWithCondition('plan', 'not_equals', ['free'])
      expect(evaluate(flag, ctx('u', { plan: 'free' })).reason).not.toBe('rule_match')
    })
  })

  describe('in', () => {
    it('matches when attribute is in the list', () => {
      const flag = flagWithCondition('country', 'in', ['US', 'CA', 'GB'])
      expect(evaluate(flag, ctx('u', { country: 'CA' })).reason).toBe('rule_match')
    })

    it('does not match when attribute is not in the list', () => {
      const flag = flagWithCondition('country', 'in', ['US', 'CA', 'GB'])
      expect(evaluate(flag, ctx('u', { country: 'DE' })).reason).not.toBe('rule_match')
    })

    it('handles a single-element list', () => {
      const flag = flagWithCondition('role', 'in', ['admin'])
      expect(evaluate(flag, ctx('u', { role: 'admin' })).reason).toBe('rule_match')
    })
  })

  describe('not_in', () => {
    it('matches when attribute is NOT in the list', () => {
      const flag = flagWithCondition('country', 'not_in', ['US', 'CA'])
      expect(evaluate(flag, ctx('u', { country: 'DE' })).reason).toBe('rule_match')
    })

    it('does not match when attribute IS in the list', () => {
      const flag = flagWithCondition('country', 'not_in', ['US', 'CA'])
      expect(evaluate(flag, ctx('u', { country: 'US' })).reason).not.toBe('rule_match')
    })
  })

  describe('contains', () => {
    it('matches when attribute contains the substring', () => {
      const flag = flagWithCondition('email', 'contains', ['@acme.com'])
      expect(evaluate(flag, ctx('u', { email: 'alice@acme.com' })).reason).toBe('rule_match')
    })

    it('does not match when attribute does not contain substring', () => {
      const flag = flagWithCondition('email', 'contains', ['@acme.com'])
      expect(evaluate(flag, ctx('u', { email: 'bob@example.com' })).reason).not.toBe('rule_match')
    })

    it('matches when attribute IS the substring (exact)', () => {
      const flag = flagWithCondition('tag', 'contains', ['beta'])
      expect(evaluate(flag, ctx('u', { tag: 'beta' })).reason).toBe('rule_match')
    })
  })

  describe('not_contains', () => {
    it('matches when attribute does NOT contain substring', () => {
      const flag = flagWithCondition('email', 'not_contains', ['@acme.com'])
      expect(evaluate(flag, ctx('u', { email: 'bob@example.com' })).reason).toBe('rule_match')
    })

    it('does not match when attribute contains the substring', () => {
      const flag = flagWithCondition('email', 'not_contains', ['@acme.com'])
      expect(evaluate(flag, ctx('u', { email: 'alice@acme.com' })).reason).not.toBe('rule_match')
    })
  })

  describe('matches_regex', () => {
    it('matches when attribute matches regex', () => {
      const flag = flagWithCondition('email', 'matches_regex', ['^.+@acme\\.com$'])
      expect(evaluate(flag, ctx('u', { email: 'hello@acme.com' })).reason).toBe('rule_match')
    })

    it('does not match when attribute does not match regex', () => {
      const flag = flagWithCondition('email', 'matches_regex', ['^.+@acme\\.com$'])
      expect(evaluate(flag, ctx('u', { email: 'hello@other.com' })).reason).not.toBe('rule_match')
    })

    it('returns false (no match) for an invalid regex', () => {
      const flag = flagWithCondition('email', 'matches_regex', ['[invalid(regex'])
      expect(evaluate(flag, ctx('u', { email: 'anything' })).reason).not.toBe('rule_match')
    })

    it('matches numeric attributes via regex (coerced to string)', () => {
      const flag = flagWithCondition('version', 'matches_regex', ['^\\d+$'])
      expect(evaluate(flag, ctx('u', { version: 42 })).reason).toBe('rule_match')
    })
  })

  describe('gt', () => {
    it('matches when attribute > value', () => {
      const flag = flagWithCondition('age', 'gt', [18])
      expect(evaluate(flag, ctx('u', { age: 25 })).reason).toBe('rule_match')
    })

    it('does not match when attribute == value', () => {
      const flag = flagWithCondition('age', 'gt', [18])
      expect(evaluate(flag, ctx('u', { age: 18 })).reason).not.toBe('rule_match')
    })

    it('does not match when attribute < value', () => {
      const flag = flagWithCondition('age', 'gt', [18])
      expect(evaluate(flag, ctx('u', { age: 10 })).reason).not.toBe('rule_match')
    })
  })

  describe('lt', () => {
    it('matches when attribute < value', () => {
      const flag = flagWithCondition('score', 'lt', [50])
      expect(evaluate(flag, ctx('u', { score: 10 })).reason).toBe('rule_match')
    })

    it('does not match when attribute == value', () => {
      const flag = flagWithCondition('score', 'lt', [50])
      expect(evaluate(flag, ctx('u', { score: 50 })).reason).not.toBe('rule_match')
    })

    it('does not match when attribute > value', () => {
      const flag = flagWithCondition('score', 'lt', [50])
      expect(evaluate(flag, ctx('u', { score: 100 })).reason).not.toBe('rule_match')
    })
  })

  describe('gte', () => {
    it('matches when attribute >= value (greater)', () => {
      const flag = flagWithCondition('age', 'gte', [18])
      expect(evaluate(flag, ctx('u', { age: 25 })).reason).toBe('rule_match')
    })

    it('matches when attribute == value (equal)', () => {
      const flag = flagWithCondition('age', 'gte', [18])
      expect(evaluate(flag, ctx('u', { age: 18 })).reason).toBe('rule_match')
    })

    it('does not match when attribute < value', () => {
      const flag = flagWithCondition('age', 'gte', [18])
      expect(evaluate(flag, ctx('u', { age: 17 })).reason).not.toBe('rule_match')
    })
  })

  describe('lte', () => {
    it('matches when attribute <= value (less)', () => {
      const flag = flagWithCondition('score', 'lte', [100])
      expect(evaluate(flag, ctx('u', { score: 50 })).reason).toBe('rule_match')
    })

    it('matches when attribute == value (equal)', () => {
      const flag = flagWithCondition('score', 'lte', [100])
      expect(evaluate(flag, ctx('u', { score: 100 })).reason).toBe('rule_match')
    })

    it('does not match when attribute > value', () => {
      const flag = flagWithCondition('score', 'lte', [100])
      expect(evaluate(flag, ctx('u', { score: 200 })).reason).not.toBe('rule_match')
    })
  })

  describe('percentage_bucket', () => {
    it('matches users whose bucket is below the threshold', () => {
      // Find a user that falls below 50%
      const flagKey = 'pct-flag'
      let matchedUser: string | null = null
      for (let i = 0; i < 200; i++) {
        const userKey = `user-${i}`
        if (bucket(flagKey, userKey) * 100 < 50) {
          matchedUser = userKey
          break
        }
      }
      if (matchedUser === null) throw new Error('Could not find a user below 50% threshold')

      const flag = flagWithCondition(flagKey, 'percentage_bucket', [50])
      expect(evaluate(flag, ctx(matchedUser)).reason).toBe('rule_match')
    })

    it('does not match users whose bucket is at or above the threshold', () => {
      const flagKey = 'pct-flag-b'
      let nonMatchedUser: string | null = null
      for (let i = 0; i < 200; i++) {
        const userKey = `user-${i}`
        if (bucket(flagKey, userKey) * 100 >= 50) {
          nonMatchedUser = userKey
          break
        }
      }
      if (nonMatchedUser === null) throw new Error('Could not find a user at/above 50% threshold')

      const flag = flagWithCondition(flagKey, 'percentage_bucket', [50])
      expect(evaluate(flag, ctx(nonMatchedUser)).reason).not.toBe('rule_match')
    })

    it('matches all users at 100% threshold', () => {
      const flag = flagWithCondition('always-flag', 'percentage_bucket', [100])
      for (let i = 0; i < 20; i++) {
        const result = evaluate(flag, ctx(`user-${i}`))
        expect(result.reason).toBe('rule_match')
      }
    })

    it('matches no users at 0% threshold', () => {
      const flag = flagWithCondition('never-flag', 'percentage_bucket', [0])
      for (let i = 0; i < 20; i++) {
        const result = evaluate(flag, ctx(`user-${i}`))
        expect(result.reason).not.toBe('rule_match')
      }
    })

    it('returns false for NaN threshold', () => {
      const flag = flagWithCondition('pct-flag', 'percentage_bucket', ['not-a-number'])
      const result = evaluate(flag, ctx('user-1'))
      expect(result.reason).not.toBe('rule_match')
    })

    it('uses the userKey (ctx.key) not an attribute for bucketing', () => {
      // percentage_bucket ignores ctx.attributes and uses ctx.key
      const flag: FlagConfig = booleanFlag({
        key: 'pct-key-test',
        rules: [
          {
            id: 'r1',
            conditions: [{ attribute: 'pct-key-test', operator: 'percentage_bucket', values: [100] }],
            variantKey: 'on',
          },
        ],
      })
      // No attributes provided at all — should still evaluate percentage_bucket using ctx.key
      const result = evaluate(flag, { key: 'some-user' })
      expect(result.reason).toBe('rule_match')
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Missing attribute behaviour
// ---------------------------------------------------------------------------

describe('missing attribute', () => {
  it('does not match a rule when the attribute is missing from context', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'r1',
          conditions: [{ attribute: 'country', operator: 'equals', values: ['US'] }],
          variantKey: 'on',
        },
      ],
    })
    // No attributes at all
    const result = evaluate(flag, { key: 'user-1' })
    expect(result.reason).not.toBe('rule_match')
  })

  it('does not match when the specific attribute key is absent', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'r1',
          conditions: [{ attribute: 'role', operator: 'equals', values: ['admin'] }],
          variantKey: 'on',
        },
      ],
    })
    const result = evaluate(flag, ctx('user-1', { country: 'US' }))
    expect(result.reason).not.toBe('rule_match')
  })

  it('falls through to default when all conditions have missing attributes', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'r1',
          conditions: [{ attribute: 'missing-attr', operator: 'equals', values: ['x'] }],
          variantKey: 'on',
        },
      ],
      rollout: {},
    })
    const result = evaluate(flag, ctx('user-1'))
    expect(result.reason).toBe('default')
  })

  it('percentage_bucket does NOT require the attribute to be present in ctx.attributes', () => {
    const flag = booleanFlag({
      key: 'pct-missing-attr',
      rules: [
        {
          id: 'r1',
          conditions: [{ attribute: 'pct-missing-attr', operator: 'percentage_bucket', values: [100] }],
          variantKey: 'on',
        },
      ],
    })
    // No attributes passed — percentage_bucket uses ctx.key
    const result = evaluate(flag, { key: 'user-abc' })
    expect(result.reason).toBe('rule_match')
  })
})

// ---------------------------------------------------------------------------
// 5. Percentage rollout
// ---------------------------------------------------------------------------

describe('percentage rollout', () => {
  it('returns rollout reason when user falls inside rollout bucket', () => {
    // Give 100% rollout to 'on' so every user gets it
    const flag = booleanFlag({ rollout: { on: 100 } })
    const result = evaluate(flag, ctx('user-1'))
    expect(result.reason).toBe('rollout')
    expect(result.variantKey).toBe('on')
  })

  it('returns default when rollout is 0% for all variants', () => {
    const flag = booleanFlag({ rollout: { on: 0 } })
    // bucket is always >= 0; cumulative never exceeds 0 so no variant matched
    // Actually rollout: {on: 0} means cumulative = 0, bucket > 0 always, so falls to default
    const result = evaluate(flag, ctx('user-1'))
    // With 0% rollout weight the rollout variant is never resolved
    expect(result.reason).toBe('default')
  })

  it('returns default when rollout is empty', () => {
    const flag = booleanFlag({ rollout: {} })
    const result = evaluate(flag, ctx('user-1'))
    expect(result.reason).toBe('default')
  })

  it('splits users approximately correctly across variants at 50/50', () => {
    const flag: FlagConfig = {
      key: 'split-flag',
      type: 'boolean',
      enabled: true,
      variants: [
        { key: 'off', value: false },
        { key: 'on', value: true },
      ],
      defaultVariantKey: 'off',
      rules: [],
      rollout: { off: 50, on: 50 },
      version: 1,
    }
    const results = Array.from({ length: 200 }, (_, i) =>
      evaluate(flag, ctx(`user-${i}`))
    )
    const onCount = results.filter((r) => r.variantKey === 'on').length
    const offCount = results.filter((r) => r.variantKey === 'off').length
    // With 200 users at 50/50 we expect roughly half each
    expect(onCount + offCount).toBe(200)
    expect(onCount).toBeGreaterThan(50)
    expect(offCount).toBeGreaterThan(50)
  })

  it('rollout uses flag.key + ctx.key for bucket (not user attributes)', () => {
    const flag = booleanFlag({ rollout: { on: 100 } })
    const result = evaluate(flag, { key: 'user-no-attributes' })
    expect(result.reason).toBe('rollout')
  })
})

// ---------------------------------------------------------------------------
// 6. Default fallthrough
// ---------------------------------------------------------------------------

describe('default fallthrough', () => {
  it('returns defaultVariantKey with reason default when no rule matches and no rollout', () => {
    const flag = booleanFlag({ rules: [], rollout: {} })
    const result = evaluate(flag, ctx('user-1'))
    expect(result.reason).toBe('default')
    expect(result.variantKey).toBe('off')
    expect(result.value).toBe(false)
  })

  it('returns flagKey in all results', () => {
    const flag = booleanFlag({ key: 'my-special-flag' })
    const result = evaluate(flag, ctx('u'))
    expect(result.flagKey).toBe('my-special-flag')
  })

  it('ruleId is undefined for default reason', () => {
    const flag = booleanFlag()
    const result = evaluate(flag, ctx('u'))
    expect(result.ruleId).toBeUndefined()
  })

  it('ruleId is undefined for rollout reason', () => {
    const flag = booleanFlag({ rollout: { on: 100 } })
    const result = evaluate(flag, ctx('u'))
    expect(result.ruleId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// 7. Multivariate flag
// ---------------------------------------------------------------------------

describe('multivariate flag', () => {
  it('can match a specific variant via rule', () => {
    const flag = multivariateFlag({
      rules: [
        {
          id: 'mv-r1',
          conditions: [{ attribute: 'group', operator: 'equals', values: ['beta'] }],
          variantKey: 'treatment-a',
        },
      ],
    })
    const result = evaluate(flag, ctx('u', { group: 'beta' }))
    expect(result.reason).toBe('rule_match')
    expect(result.variantKey).toBe('treatment-a')
    expect(result.value).toBe('A')
  })

  it('falls back to default control variant when no rule matches', () => {
    const flag = multivariateFlag()
    const result = evaluate(flag, ctx('u', { group: 'none' }))
    expect(result.reason).toBe('default')
    expect(result.variantKey).toBe('control')
  })

  it('supports rollout across three variants', () => {
    const flag: FlagConfig = {
      key: 'mv-rollout',
      type: 'multivariate',
      enabled: true,
      variants: [
        { key: 'control', value: null },
        { key: 'treatment-a', value: 'A' },
        { key: 'treatment-b', value: 'B' },
      ],
      defaultVariantKey: 'control',
      rules: [],
      rollout: { control: 34, 'treatment-a': 33, 'treatment-b': 33 },
      version: 1,
    }
    const reasons = new Set(
      Array.from({ length: 100 }, (_, i) => evaluate(flag, ctx(`u-${i}`)).reason)
    )
    expect(reasons.has('rollout')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('handles a flag with no variants gracefully (value is null for default)', () => {
    const flag: FlagConfig = {
      key: 'no-variants',
      type: 'boolean',
      enabled: false,
      variants: [],
      defaultVariantKey: 'off',
      rules: [],
      rollout: {},
      version: 1,
    }
    const result = evaluate(flag, ctx('u'))
    expect(result.value).toBeNull()
  })

  it('variant value can be a complex object', () => {
    const flag: FlagConfig = {
      key: 'obj-flag',
      type: 'multivariate',
      enabled: true,
      variants: [
        { key: 'config-a', value: { theme: 'dark', size: 'lg' } },
      ],
      defaultVariantKey: 'config-a',
      rules: [],
      rollout: { 'config-a': 100 },
      version: 1,
    }
    const result = evaluate(flag, ctx('u'))
    expect(result.reason).toBe('rollout')
    expect(result.value).toEqual({ theme: 'dark', size: 'lg' })
  })

  it('handles boolean attribute values', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'bool-rule',
          conditions: [{ attribute: 'isPremium', operator: 'equals', values: ['true'] }],
          variantKey: 'on',
        },
      ],
    })
    // boolean true coerces to "true" in String(attr)
    const result = evaluate(flag, ctx('u', { isPremium: true }))
    expect(result.reason).toBe('rule_match')
  })

  it('handles numeric attribute that is zero', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'zero-rule',
          conditions: [{ attribute: 'score', operator: 'equals', values: [0] }],
          variantKey: 'on',
        },
      ],
    })
    const result = evaluate(flag, ctx('u', { score: 0 }))
    expect(result.reason).toBe('rule_match')
  })

  it('returns correct value for rule_match variant', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'r1',
          conditions: [{ attribute: 'role', operator: 'equals', values: ['admin'] }],
          variantKey: 'on',
        },
      ],
    })
    const result = evaluate(flag, ctx('u', { role: 'admin' }))
    expect(result.value).toBe(true)
  })

  it('returns null value when rule variantKey does not match any variant', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'r1',
          conditions: [{ attribute: 'role', operator: 'equals', values: ['admin'] }],
          variantKey: 'nonexistent-variant',
        },
      ],
    })
    const result = evaluate(flag, ctx('u', { role: 'admin' }))
    expect(result.reason).toBe('rule_match')
    expect(result.value).toBeNull()
  })

  it('lte matches negative numbers correctly', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'neg-rule',
          conditions: [{ attribute: 'temp', operator: 'lte', values: [-1] }],
          variantKey: 'on',
        },
      ],
    })
    expect(evaluate(flag, ctx('u', { temp: -10 })).reason).toBe('rule_match')
    expect(evaluate(flag, ctx('u', { temp: 0 })).reason).not.toBe('rule_match')
  })

  it('gt with floating-point values', () => {
    const flag = booleanFlag({
      rules: [
        {
          id: 'float-rule',
          conditions: [{ attribute: 'score', operator: 'gt', values: [9.5] }],
          variantKey: 'on',
        },
      ],
    })
    expect(evaluate(flag, ctx('u', { score: 9.6 })).reason).toBe('rule_match')
    expect(evaluate(flag, ctx('u', { score: 9.5 })).reason).not.toBe('rule_match')
  })
})
