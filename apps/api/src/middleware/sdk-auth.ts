import type { FastifyRequest, FastifyReply } from 'fastify'
import { resolveApiKey } from '../lib/api-key.js'

declare module 'fastify' {
  interface FastifyRequest {
    sdkKey?: Awaited<ReturnType<typeof resolveApiKey>>
  }
}

export async function sdkAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing API key' })
  }

  const raw = auth.slice(7)
  const key = await resolveApiKey(raw)

  if (!key) {
    return reply.status(401).send({ error: 'Invalid or revoked API key' })
  }

  request.sdkKey = key
}
