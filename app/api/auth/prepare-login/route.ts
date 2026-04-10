import { NextRequest, NextResponse } from 'next/server'
import { ensureAuthUserForEmail, getDashboardProfileByEmail } from '@/src/lib/profiles'

export async function POST(request: NextRequest) {
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
        error: "I couldn't find a Manoa account for that email yet. Use the email you signed up with.",
      },
      { status: 404 },
    )
  }

  await ensureAuthUserForEmail(email)
  return NextResponse.json({ ok: true })
}
