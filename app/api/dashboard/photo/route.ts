import { NextRequest, NextResponse } from 'next/server'
import { calendarImageToSmsText } from '@/src/lib/sms/calendarImage'
import {
  calendarHintFromImageCaption,
  createCalendarImageBatch,
} from '@/src/lib/sms/calendarImageBatch'
import { getDashboardProfileByEmail } from '@/src/lib/profiles'
import { handleIncomingSms } from '@/src/lib/sms/agent'
import { dashboardSender } from '@/src/lib/sms/sender'
import { listSmsThreadEntries, toSmsThreadMessages } from '@/src/lib/sms/thread'
import { createSupabaseRouteHandlerClient } from '@/src/lib/supabase/server'
import { supabaseAdmin } from '@/src/lib/supabaseAdmin'

export const runtime = 'nodejs'

const maxImageBytes = 8 * 1024 * 1024
const allowedImageTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

function calendarPhotoError(error: unknown) {
  const message = error instanceof Error ? error.message : 'I could not read that photo yet.'
  if (/openai|api key|image reading/i.test(message)) {
    return message
  }

  return 'I could not read one clear calendar event from that photo. Try a brighter, closer image or crop to the event details.'
}

async function logDashboardPhotoReply({
  profileId,
  from,
  caption,
  reply,
}: {
  profileId: string
  from: string
  caption?: string | null
  reply: string
}) {
  await supabaseAdmin.from('sms_messages').insert([
    {
      profile_id: profileId,
      from_e164: from,
      body: caption?.trim() ? `Photo upload: ${caption.trim()}` : 'Photo upload with calendar details',
      direction: 'inbound',
    },
    {
      profile_id: profileId,
      from_e164: from,
      body: reply,
      direction: 'outbound',
    },
  ])
}

export async function POST(request: NextRequest) {
  const cookiesToSet: Array<{
    name: string
    value: string
    options?: Parameters<NextResponse['cookies']['set']>[2]
  }> = []

  const supabase = await createSupabaseRouteHandlerClient((nextCookies) => {
    cookiesToSet.push(...nextCookies)
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email) {
    return NextResponse.json({ error: 'Sign in again and try once more.' }, { status: 401 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('image')
  const caption = String(formData?.get('caption') || '').trim()

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose a photo or screenshot first.' }, { status: 400 })
  }

  if (!allowedImageTypes.has(file.type)) {
    return NextResponse.json(
      { error: 'Use a JPEG, PNG, or WebP photo for now.' },
      { status: 400 },
    )
  }

  if (file.size > maxImageBytes) {
    return NextResponse.json(
      { error: 'That photo is too large. Try a smaller or cropped image.' },
      { status: 400 },
    )
  }

  const profile = await getDashboardProfileByEmail(user.email)
  if (!profile) {
    return NextResponse.json(
      { error: 'We could not find your Manoa account right now.' },
      { status: 404 },
    )
  }

  try {
    const from = profile.phone_e164 || dashboardSender(profile.id)
    const buffer = Buffer.from(await file.arrayBuffer())
    const dataUrl = `data:${file.type};base64,${buffer.toString('base64')}`
    const result = await calendarImageToSmsText({
      dataUrl,
      timeZone: profile.timezone,
    })

    if (result.events.length > 1) {
      const batch = await createCalendarImageBatch({
        profile,
        result,
        calendarHint: calendarHintFromImageCaption(caption),
      })

      await logDashboardPhotoReply({
        profileId: profile.id,
        from,
        caption,
        reply: batch.reply,
      })

      const thread = toSmsThreadMessages(await listSmsThreadEntries(profile.id))
      const response = NextResponse.json({
        messages: thread,
        extractedText: result.smsTexts.join('\n'),
        confidence: result.confidence,
        batch,
      })

      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options)
      })

      return response
    }

    if (!result.smsText) {
      return NextResponse.json(
        { error: 'I could not read one clear calendar event from that photo. Try a brighter, closer image or crop to the event details.' },
        { status: 422 },
      )
    }

    await handleIncomingSms({
      from,
      body: result.smsText,
    })

    const thread = toSmsThreadMessages(await listSmsThreadEntries(profile.id))
    const response = NextResponse.json({
      messages: thread,
      extractedText: result.smsText,
      confidence: result.confidence,
    })

    cookiesToSet.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options)
    })

    return response
  } catch (error) {
    return NextResponse.json({ error: calendarPhotoError(error) }, { status: 500 })
  }
}
