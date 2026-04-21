import { z } from 'zod'

export const OperatorSchema = z.enum([
  'equals',
  'not_equals',
  'in',
  'not_in',
  'contains',
  'not_contains',
  'matches_regex',
  'gt',
  'lt',
  'gte',
  'lte',
  'percentage_bucket',
])

export type Operator = z.infer<typeof OperatorSchema>

export const ConditionSchema = z.object({
  attribute: z.string().min(1),
  operator: OperatorSchema,
  values: z.array(z.union([z.string(), z.number()])),
})

export type Condition = z.infer<typeof ConditionSchema>

export const RuleSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  conditions: z.array(ConditionSchema),
  variantKey: z.string(),
})

export type Rule = z.infer<typeof RuleSchema>

export const VariantSchema = z.object({
  key: z.string(),
  value: z.unknown(),
})

export type Variant = z.infer<typeof VariantSchema>

export const RolloutSchema = z.record(z.string(), z.number())

export type Rollout = z.infer<typeof RolloutSchema>

export const FlagTypeSchema = z.enum(['boolean', 'multivariate'])

export const FlagConfigSchema = z.object({
  key: z.string(),
  type: FlagTypeSchema,
  enabled: z.boolean(),
  variants: z.array(VariantSchema),
  defaultVariantKey: z.string(),
  rules: z.array(RuleSchema),
  rollout: RolloutSchema,
  version: z.number().int(),
})

export type FlagConfig = z.infer<typeof FlagConfigSchema>

export const EvaluationContextSchema = z.object({
  key: z.string(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
})

export type EvaluationContext = z.infer<typeof EvaluationContextSchema>

export const EvaluationReasonSchema = z.enum([
  'disabled',
  'rule_match',
  'rollout',
  'default',
  'error',
])

export type EvaluationReason = z.infer<typeof EvaluationReasonSchema>

export const EvaluationResultSchema = z.object({
  flagKey: z.string(),
  variantKey: z.string(),
  value: z.unknown(),
  reason: EvaluationReasonSchema,
  ruleId: z.string().optional(),
})

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>

export const SdkConfigSchema = z.object({
  flags: z.array(FlagConfigSchema),
  version: z.number().int(),
  etag: z.string(),
})

export type SdkConfig = z.infer<typeof SdkConfigSchema>

export const EvaluationEventSchema = z.object({
  flagKey: z.string(),
  variantKey: z.string(),
  userKey: z.string(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  ts: z.number(),
})

export type EvaluationEvent = z.infer<typeof EvaluationEventSchema>
