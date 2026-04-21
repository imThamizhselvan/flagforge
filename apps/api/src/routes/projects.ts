import type { FastifyInstance } from 'fastify'
import { getAuth } from '@clerk/fastify'
import { prisma } from '@flagforge/db'
import { z } from 'zod'
import { generateApiKey } from '../lib/api-key.js'
import { createHash } from 'crypto'

async function requireOrgAccess(orgId: string, clerkUserId: string) {
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) throw new Error('Organization not found')
  return org
}

export async function projectRoutes(app: FastifyInstance) {
  app.get('/projects', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const org = await prisma.organization.findUnique({
      where: { clerkOrgId: orgId },
      include: { projects: { include: { environments: true } } },
    })

    if (!org) return reply.status(404).send({ error: 'Organization not found' })
    return reply.send(org.projects)
  })

  app.post('/projects', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const body = z.object({ name: z.string().min(1).max(100) }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const org = await requireOrgAccess(orgId, userId)
    const slug = body.data.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

    const project = await prisma.project.create({
      data: {
        orgId: org.id,
        name: body.data.name,
        slug,
        environments: {
          create: [
            { key: 'development', name: 'Development' },
            { key: 'staging', name: 'Staging' },
            { key: 'production', name: 'Production' },
          ],
        },
      },
      include: { environments: true },
    })

    return reply.status(201).send(project)
  })

  app.get('/projects/:projectId/api-keys', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { projectId } = request.params as { projectId: string }
    const org = await requireOrgAccess(orgId, userId)

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId: org.id },
    })
    if (!project) return reply.status(404).send({ error: 'Project not found' })

    const keys = await prisma.apiKey.findMany({
      where: { projectId, revokedAt: null },
      include: { environment: true },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send(keys.map((k) => ({ ...k, keyHash: undefined })))
  })

  app.post('/projects/:projectId/api-keys', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { projectId } = request.params as { projectId: string }
    const body = z.object({
      environmentId: z.string(),
      type: z.enum(['SERVER', 'CLIENT']),
    }).safeParse(request.body)
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() })

    const org = await requireOrgAccess(orgId, userId)
    const project = await prisma.project.findFirst({ where: { id: projectId, orgId: org.id } })
    if (!project) return reply.status(404).send({ error: 'Project not found' })

    const { raw, hash, prefix } = generateApiKey(body.data.type === 'SERVER' ? 'server' : 'client')

    const key = await prisma.apiKey.create({
      data: {
        projectId,
        environmentId: body.data.environmentId,
        keyHash: hash,
        keyPrefix: prefix,
        type: body.data.type,
        createdBy: userId,
      },
    })

    // Return raw key only once
    return reply.status(201).send({ ...key, keyHash: undefined, rawKey: raw })
  })

  app.delete('/api-keys/:keyId', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const { keyId } = request.params as { keyId: string }
    const org = await requireOrgAccess(orgId, userId)

    const key = await prisma.apiKey.findFirst({
      where: { id: keyId, project: { orgId: org.id } },
    })
    if (!key) return reply.status(404).send({ error: 'Key not found' })

    await prisma.apiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    })

    return reply.status(204).send()
  })
}
