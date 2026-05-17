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
  const redirectUrl = new URL(appUrl())
  redirectUrl.searchParams.set('checkout_error', message)
  return Response.redirect(redirectUrl, 303)
}

function checkoutRedirectPage(url: string) {
  const escapedUrl = JSON.stringify(url)
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0;url=${url.replace(/"/g, '&quot;')}" />
    <title>Opening Stripe Checkout…</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f6f8fc;
        color: #14213d;
      }
      main {
        max-width: 32rem;
        padding: 24px;
        border: 1px solid #d9e1f0;
        border-radius: 12px;
        background: white;
        text-align: center;
        box-shadow: 0 16px 40px rgba(20, 33, 61, 0.08);
      }
      a {
        color: #3158d4;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Opening Stripe checkout…</h1>
      <p>If nothing happens, <a href="${url}">tap here to continue to Stripe</a>.</p>
    </main>
    <script>
      window.location.replace(${escapedUrl});
    </script>
  </body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: NextRequest) {
  const wantsJson = Boolean(request.headers.get('accept')?.includes('application/json'))
  try {
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
        ensureAuthUser: false,
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
      return checkoutRedirectPage(url)
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

    return checkoutRedirectPage(checkoutSession.url)
  } catch (error) {
    console.error('Start checkout failed.', error)
    return checkoutError('Checkout could not start right now.', 500, wantsJson)
  }
}
