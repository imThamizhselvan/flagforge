import type { FastifyInstance } from 'fastify'
import { prisma } from '@flagforge/db'
import { evaluate, EvaluationContextSchema } from '@flagforge/shared'
import { z } from 'zod'
import { sdkAuthMiddleware } from '../middleware/sdk-auth.js'
import { buildSdkConfig } from '../lib/config.js'

// Active SSE connections per environment
const sseClients = new Map<string, Set<{ reply: any; send: (data: string) => void }>>()

export async function sdkRoutes(app: FastifyInstance) {
  app.addHook('preHandler', sdkAuthMiddleware)

  // Full flag config — SDK fetches on init and re-fetches on poll/reconnect
  app.get('/config', async (request, reply) => {
    const key = request.sdkKey!
    const environmentId = key.environmentId

    const config = await buildSdkConfig(environmentId)

    const clientEtag = request.headers['if-none-match']
    if (clientEtag === config.etag) {
      return reply.status(304).send()
    }

    return reply
      .header('ETag', config.etag)
      .header('Cache-Control', 'no-store')
      .send(config)
  })

  // Server-side evaluation — single flag, single user
  app.post('/evaluate', async (request, reply) => {
    const key = request.sdkKey!
    const body = z.object({
      flagKey: z.string(),
      user: EvaluationContextSchema,
    }).safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    const config = await buildSdkConfig(key.environmentId)
    const flag = config.flags.find((f) => f.key === body.data.flagKey)

    if (!flag) {
      return reply.status(404).send({ error: `Flag '${body.data.flagKey}' not found` })
    }

    const result = evaluate(flag, body.data.user)
    return reply.send(result)
  })

  // Batched evaluation events from SDK
  app.post('/events', async (request, reply) => {
    const key = request.sdkKey!
    const body = z.object({
      events: z.array(z.object({
        flagKey: z.string(),
        variantKey: z.string(),
        userKey: z.string(),
        attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
        ts: z.number(),
      })).max(500),
    }).safeParse(request.body)

    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() })
    }

    const environmentId = key.environmentId

    // Resolve flagKey -> flagId map for this environment
    const flagKeys = [...new Set(body.data.events.map((e) => e.flagKey))]
    const flags = await prisma.flag.findMany({
      where: { projectId: key.environment.projectId, key: { in: flagKeys } },
      select: { id: true, key: true },
    })
    const flagMap = new Map(flags.map((f) => [f.key, f.id]))

    const records = body.data.events.flatMap((e) => {
      const flagId = flagMap.get(e.flagKey)
      if (!flagId) return []
      return [{
        environmentId,
        flagId,
        flagKey: e.flagKey,
        variantKey: e.variantKey,
        userKeyHash: e.userKey,
        attributes: e.attributes ?? null,
        createdAt: new Date(e.ts),
      }]
    })

    if (records.length > 0) {
      await prisma.evaluationEvent.createMany({ data: records })
    }

    return reply.status(202).send({ accepted: records.length })
  })

  // SSE stream — push config updates to SDK in real-time
  app.get('/stream', async (request, reply) => {
    const key = request.sdkKey!
    const environmentId = key.environmentId

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const client = {
      reply,
      send: (data: string) => reply.raw.write(`data: ${data}\n\n`),
    }

    if (!sseClients.has(environmentId)) {
      sseClients.set(environmentId, new Set())
    }
    sseClients.get(environmentId)!.add(client)

    // Send initial config
    const config = await buildSdkConfig(environmentId)
    client.send(JSON.stringify({ type: 'config', payload: config }))

    // Keepalive every 30s
    const keepalive = setInterval(() => {
      reply.raw.write(': keepalive\n\n')
    }, 30_000)

    request.raw.on('close', () => {
      clearInterval(keepalive)
      sseClients.get(environmentId)?.delete(client)
    })

    await new Promise(() => {}) // keep handler alive
  })
}

// Called by flag mutation routes to push updates to connected SDKs
export function broadcastConfigUpdate(environmentId: string, config: object) {
  const clients = sseClients.get(environmentId)
  if (!clients?.size) return

  const data = JSON.stringify({ type: 'config', payload: config })
  for (const client of clients) {
    client.send(data)
  }
}
