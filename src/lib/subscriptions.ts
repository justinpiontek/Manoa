import type Stripe from 'stripe'
import { supabaseAdmin } from './supabaseAdmin'

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
