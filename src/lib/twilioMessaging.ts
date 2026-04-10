import { twiml, validateRequest } from 'twilio'
import { requiredEnv } from './env'

export function messageXml(body: string) {
  const response = new twiml.MessagingResponse()
  response.message(body)
  return response.toString()
}

export function emptyXml() {
  return new twiml.MessagingResponse().toString()
}

export function validateTwilioWebhook({
  signature,
  url,
  params,
}: {
  signature: string | null
  url: string
  params: Record<string, string>
}) {
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_TWILIO_VALIDATION === 'true') {
    return true
  }

  if (!signature) return false
  return validateRequest(requiredEnv('TWILIO_AUTH_TOKEN'), signature, url, params)
}

export function twilioXmlResponse(body: string, init?: ResponseInit) {
  return new Response(body, {
    ...init,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      ...(init?.headers || {}),
    },
  })
}
