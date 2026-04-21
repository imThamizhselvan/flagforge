import { createHash } from 'crypto'
import { prisma } from '@flagforge/db'
import type { FlagConfig, SdkConfig } from '@flagforge/shared'
import { RuleSchema, VariantSchema } from '@flagforge/shared'

export async function buildSdkConfig(environmentId: string): Promise<SdkConfig> {
  const configs = await prisma.flagEnvironmentConfig.findMany({
    where: { environmentId },
    include: { flag: true },
  })

  const flags: FlagConfig[] = configs
    .filter((c) => !c.flag.archivedAt)
    .map((c) => ({
      key: c.flag.key,
      type: c.flag.type === 'BOOLEAN' ? 'boolean' : 'multivariate',
      enabled: c.enabled,
      variants: VariantSchema.array().parse(c.flag.variants),
      defaultVariantKey: c.defaultVariantKey,
      rules: RuleSchema.array().parse(c.rules),
      rollout: (c.rollout as Record<string, number>) ?? {},
      version: c.version,
    }))

  const payload = JSON.stringify(flags)
  const etag = createHash('md5').update(payload).digest('hex')

  return { flags, version: Date.now(), etag }
}

export async function buildEtagForEnvironment(environmentId: string): Promise<string> {
  const config = await buildSdkConfig(environmentId)
  return config.etag
}
