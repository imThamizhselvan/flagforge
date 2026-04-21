import { createHash, randomBytes } from 'crypto'
import { prisma } from '@flagforge/db'

export function generateApiKey(type: 'server' | 'client'): { raw: string; hash: string; prefix: string } {
  const prefix = type === 'server' ? 'ff_srv' : 'ff_cli'
  const secret = randomBytes(32).toString('hex')
  const raw = `${prefix}_${secret}`
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash, prefix: raw.slice(0, 12) }
}

export async function resolveApiKey(raw: string) {
  const hash = createHash('sha256').update(raw).digest('hex')
  const key = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    include: { environment: { include: { project: true } } },
  })

  if (!key || key.revokedAt) return null
  return key
}
