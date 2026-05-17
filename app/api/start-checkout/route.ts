import { NextRequest } from 'next/server'
import { appUrl, missingEnv, requiredEnv } from '@/src/lib/env'
import { findOrCreateProfile, isPhoneOwnershipConflictError } from '@/src/lib/profiles'
import { normalizePhone } from '@/src/lib/phone'
import { checkRateLimit, clientIp } from '@/src/lib/rateLimit'
import { stripe } from '@/src/lib/stripeClient'

function paymentLinkUrl(baseUrl: string, email: string) {
  const url = new URL(baseUrl)
  url.searchParams.set('prefilled_email', email)
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

function checkoutError(message: string, status: number, wantsJson: boolean) {
  if (wantsJson) {
    return Response.json({ error: message }, { status })
  }
  return new Response(message, { status })
}

export async function POST(request: NextRequest) {
  const wantsJson = Boolean(request.headers.get('accept')?.includes('application/json'))
  const paymentLink = process.env.STRIPE_PAYMENT_LINK_URL?.trim()
  const missing = missingEnv(
    paymentLink
      ? ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_PAYMENT_LINK_URL']
      : ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_MONTHLY_PRICE_ID'],
  )

  if (missing.length) {
    return checkoutError(
      `Checkout is not configured yet. Add these to .env.local: ${missing.join(', ')}`,
      503,
      wantsJson,
    )
  }

  const formData = await request.formData()
  const email = String(formData.get('email') || '').trim().toLowerCase()
  const phone = String(formData.get('phone') || '').trim()
  const plan = String(formData.get('plan') || '')
  const smsConsent = String(formData.get('sms_consent') || '').trim().toLowerCase()

  if (!email.includes('@')) {
    return checkoutError('A valid email is required.', 400, wantsJson)
  }

  const ipLimit = checkRateLimit({
    scope: 'start-checkout-ip',
    identity: clientIp(request),
    limit: 12,
    windowMs: 15 * 60_000,
  })
  if (!ipLimit.allowed) {
    return wantsJson
      ? Response.json(
          { error: 'Please wait a minute, then try again.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(ipLimit.retryAfterSeconds),
            },
          },
        )
      : new Response('Please wait a minute, then try again.', {
          status: 429,
          headers: {
            'Retry-After': String(ipLimit.retryAfterSeconds),
          },
        })
  }

  const emailLimit = checkRateLimit({
    scope: 'start-checkout-email',
    identity: email,
    limit: 8,
    windowMs: 15 * 60_000,
  })
  if (!emailLimit.allowed) {
    return wantsJson
      ? Response.json(
          { error: 'Please wait a minute, then try again.' },
          {
            status: 429,
            headers: {
              'Retry-After': String(emailLimit.retryAfterSeconds),
            },
          },
        )
      : new Response('Please wait a minute, then try again.', {
          status: 429,
          headers: {
            'Retry-After': String(emailLimit.retryAfterSeconds),
          },
        })
  }

  const phoneE164 = phone ? normalizePhone(phone) : ''
  if (phone && phoneE164.length < 8) {
    return checkoutError('If you add a phone number, it needs to be valid.', 400, wantsJson)
  }

  if (plan !== 'personal_monthly_1999') {
    return checkoutError('Unknown plan.', 400, wantsJson)
  }
  const smsConsentGranted = smsConsent === 'yes'
  if (smsConsentGranted && phoneE164.length < 8) {
    return checkoutError('Add a phone number to turn texting on.', 400, wantsJson)
  }

  let profile
  try {
    profile = await findOrCreateProfile({
      email,
      phoneE164: phoneE164 || null,
      smsConsentGranted,
    })
  } catch (error) {
    if (isPhoneOwnershipConflictError(error)) {
      return checkoutError(
        'That phone number is already connected to another Manoa account. Use the original email for that number, or leave the phone field blank and finish setup without texting.',
        409,
        wantsJson,
      )
    }

    if (isOptionalPhoneMigrationError(error)) {
      return checkoutError(
        'Signup can work without a phone, but the latest Supabase migration still needs to be run first.',
        503,
        wantsJson,
      )
    }

    throw error
  }
  const baseUrl = appUrl()

  if (paymentLink) {
    const url = paymentLinkUrl(paymentLink, email)
    if (wantsJson) {
      return Response.json({ url })
    }
    return Response.redirect(url, 303)
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
    success_url: `${baseUrl}/setup?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/?checkout=cancelled`,
  })

  if (!checkoutSession.url) {
    return checkoutError('Stripe did not return a checkout URL.', 500, wantsJson)
  }

  if (wantsJson) {
    return Response.json({ url: checkoutSession.url })
  }

  return Response.redirect(checkoutSession.url, 303)
}
