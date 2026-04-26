import type Stripe from 'stripe'
import { NextRequest } from 'next/server'
import { requiredEnv } from '@/src/lib/env'
import { findProfileIdForSubscription, upsertStripeSubscription } from '@/src/lib/subscriptions'
import { stripe } from '@/src/lib/stripeClient'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'
import { sendSms } from '@/src/lib/twilioClient'

export const runtime = 'nodejs'

const activeWelcomeStatuses = new Set<Stripe.Subscription.Status>(['active', 'trialing'])
const welcomeText =
  'Welcome to Manoa. Your account is set up. Connect Google, Outlook, or Apple in your dashboard to get started. Reply STOP to opt out or HELP for help.'

async function handleSubscription(subscription: Stripe.Subscription) {
  const profileId =
    subscription.metadata.profile_id ||
    (await findProfileIdForSubscription(subscription.id))

  if (!profileId) {
    return
  }

  await upsertStripeSubscription({ profileId, subscription })
}

async function welcomeTextAlreadySent(profileId: string) {
  const { data, error } = await supabaseAdmin
    .from('sms_messages')
    .select('id')
    .eq('profile_id', profileId)
    .eq('direction', 'outbound')
    .eq('body', welcomeText)
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (error) throw error
  return Boolean(data?.id)
}

async function sendWelcomeTextIfEligible({
  profileId,
  session,
  subscription,
}: {
  profileId: string
  session: Stripe.Checkout.Session
  subscription: Stripe.Subscription
}) {
  if (session.metadata?.sms_consent !== 'yes') return
  if (!activeWelcomeStatuses.has(subscription.status)) return

  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('phone_e164,sms_opted_out_at')
    .eq('id', profileId)
    .maybeSingle<{ phone_e164: string | null; sms_opted_out_at: string | null }>()

  if (error) throw error
  if (!profile?.phone_e164 || profile.sms_opted_out_at) return
  if (await welcomeTextAlreadySent(profileId)) return

  try {
    const result = await sendSms({ to: profile.phone_e164, body: welcomeText })
    await supabaseAdmin.from('sms_messages').insert({
      profile_id: profileId,
      from_e164: profile.phone_e164,
      body: welcomeText,
      direction: 'outbound',
      twilio_message_sid: result.sid,
    })
  } catch (error) {
    console.error('Could not send Manoa welcome text', error)
  }
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
      await sendWelcomeTextIfEligible({ profileId, session, subscription })
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
