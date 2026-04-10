import type Stripe from 'stripe'
import { NextRequest } from 'next/server'
import { requiredEnv } from '@/src/lib/env'
import { findProfileIdForSubscription, upsertStripeSubscription } from '@/src/lib/subscriptions'
import { stripe } from '@/src/lib/stripeClient'

export const runtime = 'nodejs'

async function handleSubscription(subscription: Stripe.Subscription) {
  const profileId =
    subscription.metadata.profile_id ||
    (await findProfileIdForSubscription(subscription.id))

  if (!profileId) {
    return
  }

  await upsertStripeSubscription({ profileId, subscription })
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return new Response('Missing Stripe signature.', { status: 400 })
  }

  const rawBody = await request.text()
  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      requiredEnv('STRIPE_WEBHOOK_SECRET'),
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown webhook error'
    return new Response(`Invalid Stripe webhook: ${message}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const profileId = session.metadata?.profile_id || session.client_reference_id

    if (profileId && typeof session.subscription === 'string') {
      const subscription = await stripe.subscriptions.retrieve(session.subscription)
      await upsertStripeSubscription({ profileId, subscription })
    }
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await handleSubscription(event.data.object as Stripe.Subscription)
  }

  return Response.json({ received: true })
}
