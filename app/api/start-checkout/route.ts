import { NextRequest } from 'next/server'
import { appUrl, missingEnv, requiredEnv } from '@/src/lib/env'
import { findOrCreateProfile } from '@/src/lib/profiles'
import { normalizePhone } from '@/src/lib/phone'
import { stripe } from '@/src/lib/stripeClient'

export async function POST(request: NextRequest) {
  const missing = missingEnv([
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_MONTHLY_PRICE_ID',
  ])

  if (missing.length) {
    return new Response(
      `Checkout is not configured yet. Add these to .env.local: ${missing.join(', ')}`,
      { status: 503 },
    )
  }

  const formData = await request.formData()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const phone = String(formData.get('phone') || '').trim()
  const plan = String(formData.get('plan') || '')

  if (!email.includes('@')) {
    return new Response('A valid email is required.', { status: 400 })
  }

  const phoneE164 = normalizePhone(phone)
  if (phoneE164.length < 8) {
    return new Response('A valid phone number is required.', { status: 400 })
  }

  if (plan !== 'personal_monthly_1999') {
    return new Response('Unknown plan.', { status: 400 })
  }

  const profile = await findOrCreateProfile({ email, phoneE164 })
  const baseUrl = appUrl()

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    client_reference_id: profile.id,
    line_items: [
      {
        price: requiredEnv('STRIPE_MONTHLY_PRICE_ID'),
        quantity: 1,
      },
    ],
    metadata: {
      profile_id: profile.id,
      phone_e164: phoneE164,
      plan,
    },
    subscription_data: {
      metadata: {
        profile_id: profile.id,
        plan,
      },
    },
    success_url: `${baseUrl}/setup?profile_id=${profile.id}`,
    cancel_url: `${baseUrl}/?checkout=cancelled`,
  })

  if (!checkoutSession.url) {
    return new Response('Stripe did not return a checkout URL.', { status: 500 })
  }

  return Response.redirect(checkoutSession.url, 303)
}
