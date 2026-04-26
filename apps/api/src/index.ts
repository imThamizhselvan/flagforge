import { config } from 'dotenv'
config()

import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { clerkPlugin } from '@clerk/fastify'

import { sdkRoutes } from './routes/sdk.js'
import { flagRoutes } from './routes/flags.js'
import { projectRoutes } from './routes/projects.js'
import { webhookRoutes } from './routes/webhooks.js'
import { billingRoutes } from './routes/billing.js'

const app = Fastify({ logger: true })

await app.register(helmet)
await app.register(cors, {
  origin: (origin, cb) => {
    const allowed = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'
    const isDev = process.env['NODE_ENV'] !== 'production'
    if (!origin || (isDev && origin.startsWith('http://localhost')) || origin === allowed) {
      cb(null, true)
    } else {
      cb(new Error('Not allowed by CORS'), false)
    }
  },
  credentials: true,
})
await app.register(rateLimit, { max: 200, timeWindow: '1 minute' })
await app.register(clerkPlugin, {
  publishableKey: process.env['CLERK_PUBLISHABLE_KEY'],
  secretKey: process.env['CLERK_SECRET_KEY'],
})

// SDK hot path — high rate limit handled separately
await app.register(sdkRoutes, { prefix: '/sdk/v1' })

// Dashboard API — Clerk session auth
await app.register(projectRoutes, { prefix: '/v1' })
await app.register(flagRoutes, { prefix: '/v1' })

// Billing routes
await app.register(billingRoutes)

// Stripe webhooks — raw body required
await app.register(webhookRoutes, { prefix: '/webhooks' })

app.get('/health', async () => ({ status: 'ok' }))

try {
  await app.listen({ port: Number(process.env['PORT'] ?? 3001), host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
