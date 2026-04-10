import Stripe from 'stripe'
import { requiredEnv } from './env'

let client: Stripe | null = null

export function getStripe() {
  client ??= new Stripe(requiredEnv('STRIPE_SECRET_KEY'))
  return client
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, property) {
    const value = Reflect.get(getStripe(), property)
    return typeof value === 'function' ? value.bind(getStripe()) : value
  },
})
