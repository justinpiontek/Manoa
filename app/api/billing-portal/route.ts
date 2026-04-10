import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { getDashboardProfile } from '@/src/lib/profiles'
import { stripe } from '@/src/lib/stripeClient'
import { findStripeCustomerIdForProfile } from '@/src/lib/subscriptions'

export async function GET(request: NextRequest) {
  const profileId = request.nextUrl.searchParams.get('profile_id') || ''

  if (!profileId) {
    return Response.redirect(`${appUrl()}/#access`, 303)
  }

  const profile = await getDashboardProfile(profileId)

  if (!profile) {
    return Response.redirect(`${appUrl()}/#access`, 303)
  }

  let customerId = await findStripeCustomerIdForProfile(profileId)

  if (!customerId) {
    const customers = await stripe.customers.list({
      email: profile.email,
      limit: 1,
    })

    const customer = customers.data.find((entry) => !entry.deleted)
    customerId = customer?.id || null
  }

  if (!customerId) {
    return Response.redirect(`${appUrl()}/dashboard?profile_id=${profileId}&billing=missing`, 303)
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/dashboard?profile_id=${profileId}&billing=returned`,
  })

  return Response.redirect(session.url, 303)
}
