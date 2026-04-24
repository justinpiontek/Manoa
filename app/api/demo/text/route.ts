import { NextRequest, NextResponse } from 'next/server'
import { applyDemoTextForIntent, createDemoState, type DemoState } from '@/src/lib/demoSms'
import { parseSmsIntentWithAIResult, type AiConversationTurn } from '@/src/lib/sms/aiIntent'
import { parseSmsIntent } from '@/src/lib/sms/parser'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as {
    body?: unknown
    state?: DemoState
  } | null

  const body = typeof payload?.body === 'string' ? payload.body.trim() : ''
  if (!body) {
    return NextResponse.json({ error: 'Missing demo text.' }, { status: 400 })
  }

  const currentState =
    payload?.state && typeof payload.state === 'object' ? payload.state : createDemoState()

  const aiConversation: AiConversationTurn[] = currentState.messages.slice(-4).map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.lines.join('\n'),
  }))

  const aiResult = await parseSmsIntentWithAIResult(body, undefined, aiConversation)
  const intent = aiResult.intent || parseSmsIntent(body)
  const state = applyDemoTextForIntent(currentState, body, intent)

  return NextResponse.json({
    state,
    understoodBy: aiResult.intent ? aiResult.understoodBy : 'Fallback parser',
  })
}
