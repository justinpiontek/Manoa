import { NextRequest } from 'next/server'
import { normalizePhone } from '@/src/lib/phone'
import { findProfileByPhone } from '@/src/lib/profiles'
import { handleIncomingSms } from '@/src/lib/sms/agent'
import { calendarImageToSmsText, type CalendarImageResult } from '@/src/lib/sms/calendarImage'
import {
  calendarHintFromImageCaption,
  createCalendarImageBatch,
} from '@/src/lib/sms/calendarImageBatch'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'
import { messageXml, twilioXmlResponse, validateTwilioWebhook } from '@/src/lib/twilioMessaging'

export const runtime = 'nodejs'

const maxImageBytes = 8 * 1024 * 1024
const supportedMediaTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const heicMediaTypes = new Set(['image/heic', 'image/heif'])

function publicRequestUrl(request: NextRequest) {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')
  return host ? `${proto}://${host}${url.pathname}${url.search}` : request.url
}

function normalizeMediaType(contentType: string | null | undefined) {
  return (contentType || '').split(';')[0].trim().toLowerCase()
}

function twilioBasicAuthHeader(accountSidOverride?: string | null) {
  const accountSid = accountSidOverride || process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) return null

  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
}

async function twilioMediaToDataUrl(mediaUrl: string, contentType: string, accountSid?: string | null) {
  const auth = twilioBasicAuthHeader(accountSid)
  const response = await fetch(mediaUrl, {
    headers: auth ? { Authorization: auth } : undefined,
  })

  if (!response.ok) {
    throw new Error(`Twilio media fetch returned ${response.status}.`)
  }

  const contentLength = Number(response.headers.get('content-length') || '0')
  if (contentLength > maxImageBytes) {
    throw new Error('That photo is too large. Try a smaller or cropped image.')
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > maxImageBytes) {
    throw new Error('That photo is too large. Try a smaller or cropped image.')
  }

  return `data:${contentType};base64,${buffer.toString('base64')}`
}

async function mediaCalendarResult(params: Record<string, string>, timeZone?: string): Promise<CalendarImageResult | null> {
  const mediaCount = Number(params.NumMedia || '0')
  if (!Number.isFinite(mediaCount) || mediaCount < 1) return null
  let sawUnsupportedType: string | null = null
  const accountSid = params.AccountSid || null

  for (let index = 0; index < mediaCount; index += 1) {
    const mediaUrl = params[`MediaUrl${index}`]
    const contentType = normalizeMediaType(params[`MediaContentType${index}`])
    if (!mediaUrl || !contentType) continue
    if (!supportedMediaTypes.has(contentType)) {
      sawUnsupportedType ||= contentType
      continue
    }

    const dataUrl = await twilioMediaToDataUrl(mediaUrl, contentType, accountSid)
    return calendarImageToSmsText({
      dataUrl,
      timeZone,
    })
  }

  if (sawUnsupportedType) {
    if (heicMediaTypes.has(sawUnsupportedType)) {
      throw new Error('Unsupported photo type: HEIC')
    }
    throw new Error(`Unsupported photo type: ${sawUnsupportedType}`)
  }

  return null
}

async function logDirectTwilioReply({
  profileId,
  from,
  inboundBody,
  outboundBody,
  twilioMessageSid,
}: {
  profileId: string
  from: string
  inboundBody: string
  outboundBody: string
  twilioMessageSid?: string
}) {
  await supabaseAdmin.from('sms_messages').insert([
    {
      profile_id: profileId,
      from_e164: from,
      body: inboundBody,
      direction: 'inbound',
      twilio_message_sid: twilioMessageSid || null,
    },
    {
      profile_id: profileId,
      from_e164: from,
      body: outboundBody,
      direction: 'outbound',
    },
  ])
}

export async function POST(request: NextRequest) {
  let rawBody = ''
  let params: Record<string, string> = {}

  try {
    rawBody = await request.text()
    params = Object.fromEntries(new URLSearchParams(rawBody).entries())
    const signature = request.headers.get('x-twilio-signature')
    const requestUrl = publicRequestUrl(request)

    const isValid = validateTwilioWebhook({
      signature,
      url: requestUrl,
      params,
    })

    if (!isValid) {
      console.error('Invalid Twilio signature on inbound SMS webhook.', {
        requestUrl,
        from: params.From || null,
        messageSid: params.MessageSid || null,
      })
      return twilioXmlResponse(messageXml('Invalid Twilio signature.'), { status: 403 })
    }

    const from = normalizePhone(params.From || '')
    const body = params.Body || ''
    const twilioMessageSid = params.MessageSid

    if (!from) {
      return twilioXmlResponse(messageXml('Missing SMS sender.'), { status: 400 })
    }

    let finalBody = body.trim()
    if (Number(params.NumMedia || '0') > 0) {
      const profile = await findProfileByPhone(from)
      if (!profile) {
        const reply = await handleIncomingSms({
          from,
          body: finalBody || 'photo with event details',
          twilioMessageSid,
        })
        return twilioXmlResponse(messageXml(reply))
      }

      try {
        const imageResult = await mediaCalendarResult(params, profile.timezone)
        if (!imageResult?.smsText) {
          return twilioXmlResponse(
            messageXml('I can read JPEG, PNG, or WebP images with one clear event. Try a closer crop or type the details.'),
            { status: 200 },
          )
        }

        if (imageResult.events.length > 1) {
          const batch = await createCalendarImageBatch({
            profile,
            result: imageResult,
            calendarHint: calendarHintFromImageCaption(finalBody),
          })
          await logDirectTwilioReply({
            profileId: profile.id,
            from,
            inboundBody: finalBody || 'Photo with calendar schedule',
            outboundBody: batch.reply,
            twilioMessageSid,
          })
          return twilioXmlResponse(messageXml(batch.reply), { status: 200 })
        }

        finalBody = finalBody ? `${finalBody}\n${imageResult.smsText}` : imageResult.smsText
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        console.error('Twilio MMS calendar image handling failed.', {
          error: message || error,
          from,
          accountSid: params.AccountSid || null,
          mediaCount: params.NumMedia || '0',
          mediaTypes: Array.from({ length: Number(params.NumMedia || '0') }, (_, index) =>
            normalizeMediaType(params[`MediaContentType${index}`] || null),
          ),
        })
        const reply =
          message === 'Unsupported photo type: HEIC'
            ? 'I cannot read HEIC photos yet. On iPhone, send it as Most Compatible or send a screenshot instead.'
            : /Unsupported photo type:/i.test(message)
              ? 'I can read JPEG, PNG, or WebP photos right now. Try a screenshot or a different image type.'
              : /Twilio media fetch returned (401|403)/i.test(message)
                ? 'I received the photo, but could not download it from Twilio yet. Try again in a minute.'
              : /openai|api key|image reading/i.test(message)
                ? message
                : 'I could not read one clear calendar event from that photo. Try a closer crop or type the details.'
        return twilioXmlResponse(messageXml(reply), { status: 200 })
      }
    }

    if (!finalBody) {
      return twilioXmlResponse(messageXml('Text me an event, agenda request, or photo with event details.'), { status: 400 })
    }

    const reply = await handleIncomingSms({ from, body: finalBody, twilioMessageSid })
    return twilioXmlResponse(messageXml(reply))
  } catch (error) {
    console.error('Twilio inbound route failed.', {
      error,
      requestUrl: publicRequestUrl(request),
      from: params.From || null,
      messageSid: params.MessageSid || null,
      bodyPreview: (params.Body || '').slice(0, 160),
    })
    return twilioXmlResponse(
      messageXml('Manoa hit a snag reading that text. Try again in a minute.'),
      { status: 200 },
    )
  }
}
