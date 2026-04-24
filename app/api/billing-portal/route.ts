import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'
import { getAuthenticatedDashboardProfileForRoute } from '@/src/lib/dashboardAuth'
import { stripe } from '@/src/lib/stripeClient'
import { findStripeCustomerIdForProfile } from '@/src/lib/subscriptions'

export async function GET(request: NextRequest) {
  const profile = await getAuthenticatedDashboardProfileForRoute()

  if (!profile) {
    return Response.redirect(`${appUrl()}/login`, 303)
  }

  let customerId = await findStripeCustomerIdForProfile(profile.id)

  if (!customerId) {
    const customers = await stripe.customers.list({
      email: profile.email,
      limit: 1,
    })

    const customer = customers.data.find((entry) => !entry.deleted)
    customerId = customer?.id || null
  }

  if (!customerId) {
    return Response.redirect(`${appUrl()}/dashboard?billing=missing`, 303)
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/dashboard?billing=returned`,
  })

  return Response.redirect(session.url, 303)
}
