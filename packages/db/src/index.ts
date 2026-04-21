import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env['NODE_ENV'] === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma

export { Prisma } from '@prisma/client'
export type {
  Organization,
  Project,
  Environment,
  ApiKey,
  Flag,
  FlagEnvironmentConfig,
  AuditLog,
  EvaluationEvent,
  EvaluationRollup,
} from '@prisma/client'
export { Plan, FlagType, ApiKeyType } from '@prisma/client'
