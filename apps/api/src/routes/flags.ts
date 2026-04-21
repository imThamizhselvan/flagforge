import type { FastifyInstance } from 'fastify'
import { getAuth } from '@clerk/fastify'
import { prisma } from '@flagforge/db'
import { z } from 'zod'
import { RuleSchema, VariantSchema } from '@flagforge/shared'
import { buildSdkConfig } from '../lib/config.js'
import { broadcastConfigUpdate } from './sdk.js'

async function requireProjectAccess(projectId: string, clerkOrgId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, org: { clerkOrgId } },
    include: { environments: true },
  })
  if (!project) throw new Error('Project not found')
  return project
}

async function writeAuditLog(orgId: string, userId: string, action: string, resourceType: string, resourceId: string, diff?: object) {
  await prisma.auditLog.create({
    data: { orgId, actorUserId: userId, action, resourceType, resourceId, diff: diff ?? null },
  })
}

export async function flagRoutes(app: FastifyInstance) {
  app.get('/projects/:projectId/flags', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { projectId } = request.params as { projectId: string }
    await requireProjectAccess(projectId, orgId)

    const flags = await prisma.flag.findMany({
      where: { projectId, archivedAt: null },
      include: { envConfigs: { include: { environment: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send(flags)
  })

  app.post('/projects/:projectId/flags', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { projectId } = request.params as { projectId: string }
    const body = z.object({
      key: z.string().min(1).regex(/^[a-z0-9-_]+$/, 'Lowercase letters, numbers, hyphens, underscores only'),
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      type: z.enum(['BOOLEAN', 'MULTIVARIATE']).default('BOOLEAN'),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const project = await requireProjectAccess(projectId, orgId)
    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (!org) return reply.status(404).send({ error: 'Org not found' })

    const defaultVariants = body.data.type === 'BOOLEAN'
      ? [{ key: 'off', value: false }, { key: 'on', value: true }]
      : [{ key: 'control', value: null }, { key: 'treatment', value: null }]

    const flag = await prisma.flag.create({
      data: {
        projectId,
        key: body.data.key,
        name: body.data.name,
        description: body.data.description,
        type: body.data.type,
        variants: defaultVariants,
        envConfigs: {
          create: project.environments.map((env) => ({
            environmentId: env.id,
            enabled: false,
            defaultVariantKey: defaultVariants[0]!.key,
            rules: [],
            rollout: {},
          })),
        },
      },
      include: { envConfigs: true },
    })

    await writeAuditLog(org.id, userId, 'flag.created', 'flag', flag.id)
    return reply.status(201).send(flag)
  })

  app.get('/flags/:flagId', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { flagId } = request.params as { flagId: string }
    const flag = await prisma.flag.findFirst({
      where: { id: flagId, project: { org: { clerkOrgId: orgId } } },
      include: { envConfigs: { include: { environment: true } } },
    })
    if (!flag) return reply.status(404).send({ error: 'Flag not found' })

    return reply.send(flag)
  })

  app.patch('/flags/:flagId', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { flagId } = request.params as { flagId: string }
    const body = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      archived: z.boolean().optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const existing = await prisma.flag.findFirst({
      where: { id: flagId, project: { org: { clerkOrgId: orgId } } },
    })
    if (!existing) return reply.status(404).send({ error: 'Flag not found' })

    const flag = await prisma.flag.update({
      where: { id: flagId },
      data: {
        ...(body.data.name && { name: body.data.name }),
        ...(body.data.description !== undefined && { description: body.data.description }),
        ...(body.data.archived !== undefined && { archivedAt: body.data.archived ? new Date() : null }),
      },
    })

    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (org) await writeAuditLog(org.id, userId, 'flag.updated', 'flag', flag.id, body.data)

    return reply.send(flag)
  })

  // Update per-environment config (rules, rollout, enabled state)
  app.put('/flags/:flagId/environments/:envId', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { flagId, envId } = request.params as { flagId: string; envId: string }
    const body = z.object({
      enabled: z.boolean().optional(),
      defaultVariantKey: z.string().optional(),
      rules: z.array(RuleSchema).optional(),
      rollout: z.record(z.string(), z.number().min(0).max(100)).optional(),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const existing = await prisma.flagEnvironmentConfig.findFirst({
      where: {
        flagId,
        environmentId: envId,
        flag: { project: { org: { clerkOrgId: orgId } } },
      },
    })
    if (!existing) return reply.status(404).send({ error: 'Config not found' })

    const config = await prisma.flagEnvironmentConfig.update({
      where: { flagId_environmentId: { flagId, environmentId: envId } },
      data: {
        ...(body.data.enabled !== undefined && { enabled: body.data.enabled }),
        ...(body.data.defaultVariantKey && { defaultVariantKey: body.data.defaultVariantKey }),
        ...(body.data.rules && { rules: body.data.rules }),
        ...(body.data.rollout && { rollout: body.data.rollout }),
        version: { increment: 1 },
      },
    })

    // Broadcast updated config to SSE clients
    const sdkConfig = await buildSdkConfig(envId)
    broadcastConfigUpdate(envId, sdkConfig)

    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (org) await writeAuditLog(org.id, userId, 'flag_config.updated', 'flag_environment_config', config.id, body.data)

    return reply.send(config)
  })

  app.get('/flags/:flagId/analytics', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { flagId } = request.params as { flagId: string }
    const query = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      environmentId: z.string().optional(),
    }).safeParse(request.query)
    if (!query.success) return reply.status(400).send({ error: query.error.flatten() })

    const flag = await prisma.flag.findFirst({
      where: { id: flagId, project: { org: { clerkOrgId: orgId } } },
    })
    if (!flag) return reply.status(404).send({ error: 'Flag not found' })

    const from = query.data.from ? new Date(query.data.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const to = query.data.to ? new Date(query.data.to) : new Date()

    const rollups = await prisma.evaluationRollup.findMany({
      where: {
        flagKey: flag.key,
        ...(query.data.environmentId && { environmentId: query.data.environmentId }),
        hour: { gte: from, lte: to },
      },
      orderBy: { hour: 'asc' },
    })

    return reply.send(rollups)
  })

  app.get('/projects/:projectId/audit', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (!org) return reply.status(404).send({ error: 'Org not found' })

    const logs = await prisma.auditLog.findMany({
      where: { orgId: org.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return reply.send(logs)
  })
}
