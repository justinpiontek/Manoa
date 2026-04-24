import { NextRequest } from 'next/server'
import { appUrl, missingEnv, requiredEnv } from '@/src/lib/env'
import { findOrCreateProfile } from '@/src/lib/profiles'
import { normalizePhone } from '@/src/lib/phone'
import { stripe } from '@/src/lib/stripeClient'

function paymentLinkUrl(baseUrl: string, email: string, profileId: string) {
  const url = new URL(baseUrl)
  url.searchParams.set('prefilled_email', email)
  url.searchParams.set('client_reference_id', profileId)
  return url.toString()
}

function isOptionalPhoneMigrationError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : ''

  const lower = message.toLowerCase()
  return lower.includes('phone_e164') && (lower.includes('null value') || lower.includes('not-null'))
}

export async function POST(request: NextRequest) {
  const paymentLink = process.env.STRIPE_PAYMENT_LINK_URL?.trim()
  const missing = missingEnv(
    paymentLink
      ? ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_PAYMENT_LINK_URL']
      : ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_MONTHLY_PRICE_ID'],
  )

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
  const smsConsent = String(formData.get('sms_consent') || '').trim().toLowerCase()

  if (!email.includes('@')) {
    return new Response('A valid email is required.', { status: 400 })
  }

  const phoneE164 = phone ? normalizePhone(phone) : ''
  if (phone && phoneE164.length < 8) {
    return new Response('If you add a phone number, it needs to be valid.', { status: 400 })
  }

  if (plan !== 'personal_monthly_1999') {
    return new Response('Unknown plan.', { status: 400 })
  }
  const smsConsentGranted = smsConsent === 'yes'
  if (smsConsentGranted && phoneE164.length < 8) {
    return new Response('Add a phone number to turn texting on.', { status: 400 })
  }

  let profile
  try {
    profile = await findOrCreateProfile({
      email,
      phoneE164: phoneE164 || null,
      smsConsentGranted,
    })
  } catch (error) {
    if (isOptionalPhoneMigrationError(error)) {
      return new Response(
        'Signup can work without a phone, but the latest Supabase migration still needs to be run first.',
        { status: 503 },
      )
    }

    throw error
  }
  const baseUrl = appUrl()

  if (paymentLink) {
    return Response.redirect(paymentLinkUrl(paymentLink, email, profile.id), 303)
  }

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
      plan,
      sms_consent: smsConsentGranted ? 'yes' : 'no',
      ...(phoneE164 ? { phone_e164: phoneE164 } : {}),
      ...(smsConsentGranted
        ? {
            sms_consent_source: 'website_signup',
            sms_consent_at: new Date().toISOString(),
          }
        : {}),
    },
    subscription_data: {
      metadata: {
        profile_id: profile.id,
        plan,
        sms_consent: smsConsentGranted ? 'yes' : 'no',
        ...(smsConsentGranted
          ? {
              sms_consent_source: 'website_signup',
            }
          : {}),
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
