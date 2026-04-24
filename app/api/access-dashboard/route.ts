import { NextRequest } from 'next/server'
import { appUrl } from '@/src/lib/env'

export async function POST(request: NextRequest) {
  void request
  return Response.redirect(`${appUrl()}/login`, 303)
}
