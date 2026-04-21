import { bucket } from './hash'
import type {
  Condition,
  EvaluationContext,
  EvaluationResult,
  FlagConfig,
  Rule,
  Variant,
} from './schemas'

function matchesCondition(condition: Condition, ctx: EvaluationContext): boolean {
  const { attribute, operator, values } = condition
  const raw = ctx.attributes?.[attribute]

  if (operator === 'percentage_bucket') {
    const threshold = Number(values[0])
    if (isNaN(threshold)) return false
    return bucket(attribute, ctx.key) * 100 < threshold
  }

  if (raw === undefined) return false
  const attr = raw

  switch (operator) {
    case 'equals':
      return String(attr) === String(values[0])
    case 'not_equals':
      return String(attr) !== String(values[0])
    case 'in':
      return values.map(String).includes(String(attr))
    case 'not_in':
      return !values.map(String).includes(String(attr))
    case 'contains':
      return String(attr).includes(String(values[0]))
    case 'not_contains':
      return !String(attr).includes(String(values[0]))
    case 'matches_regex': {
      try {
        return new RegExp(String(values[0])).test(String(attr))
      } catch {
        return false
      }
    }
    case 'gt':
      return Number(attr) > Number(values[0])
    case 'lt':
      return Number(attr) < Number(values[0])
    case 'gte':
      return Number(attr) >= Number(values[0])
    case 'lte':
      return Number(attr) <= Number(values[0])
    default:
      return false
  }
}

function matchesRule(rule: Rule, ctx: EvaluationContext): boolean {
  return rule.conditions.every((c) => matchesCondition(c, ctx))
}

function resolveRolloutVariant(flag: FlagConfig, ctx: EvaluationContext): Variant | undefined {
  const b = bucket(flag.key, ctx.key)
  let cumulative = 0

  for (const [variantKey, weight] of Object.entries(flag.rollout)) {
    cumulative += weight / 100
    if (b < cumulative) {
      return flag.variants.find((v) => v.key === variantKey)
    }
  }

  return undefined
}

export function evaluate(flag: FlagConfig, ctx: EvaluationContext): EvaluationResult {
  const defaultVariant = flag.variants.find((v) => v.key === flag.defaultVariantKey)

  if (!flag.enabled) {
    return {
      flagKey: flag.key,
      variantKey: flag.defaultVariantKey,
      value: defaultVariant?.value ?? null,
      reason: 'disabled',
    }
  }

  for (const rule of flag.rules) {
    if (matchesRule(rule, ctx)) {
      const variant = flag.variants.find((v) => v.key === rule.variantKey)
      return {
        flagKey: flag.key,
        variantKey: rule.variantKey,
        value: variant?.value ?? null,
        reason: 'rule_match',
        ruleId: rule.id,
      }
    }
  }

  const rolloutVariant = resolveRolloutVariant(flag, ctx)
  if (rolloutVariant) {
    return {
      flagKey: flag.key,
      variantKey: rolloutVariant.key,
      value: rolloutVariant.value,
      reason: 'rollout',
    }
  }

  return {
    flagKey: flag.key,
    variantKey: flag.defaultVariantKey,
    value: defaultVariant?.value ?? null,
    reason: 'default',
  }
}
