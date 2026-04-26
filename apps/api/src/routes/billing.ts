import type { FastifyInstance } from 'fastify'
import { getAuth } from '@clerk/fastify'
import Stripe from 'stripe'
import { prisma } from '@flagforge/db'

const stripe = new Stripe(process.env['STRIPE_SECRET_KEY']!)

const PRO_PRICE_ID = process.env['STRIPE_PRO_PRICE_ID']!
const DASHBOARD_URL = process.env['DASHBOARD_URL'] ?? 'http://localhost:5173'

export async function billingRoutes(app: FastifyInstance) {
  // Create Stripe checkout session for Pro upgrade
  app.post('/v1/billing/checkout', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (!org) return reply.status(404).send({ error: 'Organization not found' })

    if (org.plan === 'PRO') {
      return reply.status(400).send({ error: 'Already on Pro plan' })
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRO_PRICE_ID, quantity: 1 }],
      success_url: `${DASHBOARD_URL}/billing?success=true`,
      cancel_url: `${DASHBOARD_URL}/billing?canceled=true`,
      customer: org.stripeCustomerId ?? undefined,
      customer_email: org.stripeCustomerId ? undefined : undefined,
      metadata: { clerkOrgId: orgId },
      subscription_data: { metadata: { clerkOrgId: orgId } },
    })

    return reply.send({ url: session.url })
  })

  // Create Stripe billing portal session for managing subscription
  app.post('/v1/billing/portal', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
    if (!org?.stripeCustomerId) {
      return reply.status(400).send({ error: 'No billing account found' })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${DASHBOARD_URL}/billing`,
    })

    return reply.send({ url: session.url })
  })

  // Get current plan + usage
  app.get('/v1/billing', async (request, reply) => {
    const { orgId, userId } = getAuth(request)
    if (!orgId || !userId) return reply.status(401).send({ error: 'Unauthorized' })

    const org = await prisma.organization.findUnique({
      where: { clerkOrgId: orgId },
      include: { projects: { include: { _count: { select: { flags: true } } } } },
    })
    if (!org) return reply.status(404).send({ error: 'Organization not found' })

    const projectCount = org.projects.length
    const flagCount = org.projects.reduce((sum, p) => sum + p._count.flags, 0)

    return reply.send({
      plan: org.plan,
      stripeCustomerId: org.stripeCustomerId,
      usage: { projects: projectCount, flags: flagCount },
      limits: {
        FREE: { projects: 2, flags: 10 },
        PRO: { projects: -1, flags: -1 },
      },
    })
  })
}
