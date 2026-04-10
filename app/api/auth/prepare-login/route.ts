import { NextRequest, NextResponse } from 'next/server'
import { getDashboardProfileByEmail } from '@/src/lib/profiles'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const email = String(body?.email || '')
      .trim()
      .toLowerCase()

    if (!email.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    }

    const profile = await getDashboardProfileByEmail(email)
    if (!profile) {
      return NextResponse.json(
        {
          error:
            "I couldn't find a Manoa account for that email yet. Use the email you signed up with.",
        },
        { status: 404 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'We could not get your Manoa login ready yet. Try again in a minute.'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
