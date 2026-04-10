import twilio from 'twilio'
import type { Twilio } from 'twilio'
import { requiredEnv } from './env'

let client: Twilio | null = null

function twilioClient() {
  client ??= twilio(requiredEnv('TWILIO_ACCOUNT_SID'), requiredEnv('TWILIO_AUTH_TOKEN'))
  return client
}

export async function sendSms({ to, body }: { to: string; body: string }) {
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID
  const from = process.env.TWILIO_FROM_NUMBER

  if (!messagingServiceSid && !from) {
    throw new Error('Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER.')
  }

  return twilioClient().messages.create({
    to,
    body,
    ...(messagingServiceSid ? { messagingServiceSid } : { from }),
  })
}
