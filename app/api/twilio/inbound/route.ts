import { NextRequest } from 'next/server'
import { normalizePhone } from '@/src/lib/phone'
import { handleIncomingSms } from '@/src/lib/sms/agent'
import { messageXml, twilioXmlResponse, validateTwilioWebhook } from '@/src/lib/twilioMessaging'

export const runtime = 'nodejs'

function publicRequestUrl(request: NextRequest) {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  return host ? `${proto}://${host}${url.pathname}${url.search}` : request.url
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const params = Object.fromEntries(new URLSearchParams(rawBody).entries())
  const signature = request.headers.get('x-twilio-signature')

  const isValid = validateTwilioWebhook({
    signature,
    url: publicRequestUrl(request),
    params,
  })

  if (!isValid) {
    return twilioXmlResponse(messageXml('Invalid Twilio signature.'), { status: 403 })
  }

  const from = normalizePhone(params.From || '')
  const body = params.Body || ''
  const twilioMessageSid = params.MessageSid

  if (!from || !body) {
    return twilioXmlResponse(messageXml('Missing SMS sender or body.'), { status: 400 })
  }

  const reply = await handleIncomingSms({ from, body, twilioMessageSid })
  return twilioXmlResponse(messageXml(reply))
}
