import type Stripe from 'stripe'
import { supabaseAdmin } from './supabaseAdmin'
import { stripe } from './stripeClient'

function unixToIso(value?: number | null) {
  return value ? new Date(value * 1000).toISOString() : null
}

export async function upsertStripeSubscription({
  profileId,
  subscription,
}: {
  profileId: string
  subscription: Stripe.Subscription
}) {
  const currentPeriodEnd =
    'current_period_end' in subscription
      ? (subscription.current_period_end as number | undefined)
      : undefined

  const { error } = await supabaseAdmin.from('subscriptions').upsert(
    {
      profile_id: profileId,
      stripe_customer_id:
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      current_period_end: unixToIso(currentPeriodEnd),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' },
  )

  if (error) throw error
}

export async function findProfileIdForSubscription(subscriptionId: string) {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('profile_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle<{ profile_id: string }>()

  if (error) throw error
  return data?.profile_id || null
}

export async function findStripeCustomerIdForProfile(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('profile_id', profileId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ stripe_customer_id: string }>()

  if (error) throw error
  return data?.stripe_customer_id || null
}

function subscriptionPriority(status: Stripe.Subscription.Status) {
  switch (status) {
    case 'active':
      return 7
    case 'trialing':
      return 6
    case 'past_due':
      return 5
    case 'unpaid':
      return 4
    case 'incomplete':
      return 3
    case 'paused':
      return 2
    case 'incomplete_expired':
      return 1
    case 'canceled':
    default:
      return 0
  }
}

function compareSubscriptions(a: Stripe.Subscription, b: Stripe.Subscription) {
  const priorityDiff = subscriptionPriority(b.status) - subscriptionPriority(a.status)
  if (priorityDiff !== 0) return priorityDiff

  const periodEndA =
    'current_period_end' in a ? Number(a.current_period_end || 0) : 0
  const periodEndB =
    'current_period_end' in b ? Number(b.current_period_end || 0) : 0
  if (periodEndB !== periodEndA) return periodEndB - periodEndA

  return Number(b.created || 0) - Number(a.created || 0)
}

export async function syncStripeSubscriptionForProfile({
  profileId,
  email,
}: {
  profileId: string
  email: string
}) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return null
  }

  const customers = await stripe.customers.list({
    email: email.trim().toLowerCase(),
    limit: 10,
  })

  let bestSubscription: Stripe.Subscription | null = null

  for (const customer of customers.data) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 20,
    })

    for (const subscription of subscriptions.data) {
      if (!bestSubscription || compareSubscriptions(subscription, bestSubscription) < 0) {
        bestSubscription = subscription
      }
    }
  }

  if (!bestSubscription) {
    return null
  }

  await upsertStripeSubscription({
    profileId,
    subscription: bestSubscription,
  })

  return bestSubscription.status
}
