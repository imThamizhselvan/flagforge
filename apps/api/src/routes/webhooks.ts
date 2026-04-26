import type { FastifyInstance } from 'fastify'
import Stripe from 'stripe'
import { prisma } from '@flagforge/db'

function getStripe() {
  return new Stripe(process.env['STRIPE_SECRET_KEY']!)
}

export async function webhookRoutes(app: FastifyInstance) {
  // Clerk org webhook — sync org creation to DB
  app.post('/clerk', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const event = request.body as { type: string; data: Record<string, unknown> }

    if (event.type === 'organization.created') {
      const { id, name, slug } = event.data as { id: string; name: string; slug: string }
      await prisma.organization.upsert({
        where: { clerkOrgId: id },
        create: { clerkOrgId: id, name, slug: slug ?? id },
        update: { name },
      })
    }

    if (event.type === 'organization.deleted') {
      const { id } = event.data as { id: string }
      await prisma.organization.deleteMany({ where: { clerkOrgId: id } })
    }

    return reply.status(200).send({ received: true })
  })

  // Stripe webhook — sync subscription changes
  app.post('/stripe', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const sig = request.headers['stripe-signature'] as string
    let event: Stripe.Event

    const stripe = getStripe()
    try {
      event = stripe.webhooks.constructEvent(
        request.rawBody as string,
        sig,
        process.env['STRIPE_WEBHOOK_SECRET']!,
      )
    } catch {
      return reply.status(400).send({ error: 'Invalid signature' })
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const clerkOrgId = session.metadata?.['clerkOrgId']
      if (clerkOrgId) {
        await prisma.organization.update({
          where: { clerkOrgId },
          data: {
            stripeCustomerId: session.customer as string,
            plan: 'PRO',
          },
        })
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription
      await prisma.organization.updateMany({
        where: { stripeCustomerId: sub.customer as string },
        data: { plan: 'FREE' },
      })
    }

    return reply.status(200).send({ received: true })
  })
}
