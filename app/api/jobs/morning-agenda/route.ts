import { NextRequest } from 'next/server'
import { sendMorningAgendas } from '@/src/lib/jobs'

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV === 'development'
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return new Response('Unauthorized.', { status: 401 })
  }

  const sent = await sendMorningAgendas()
  return Response.json({ sent })
}

export async function GET(request: NextRequest) {
  return POST(request)
}
