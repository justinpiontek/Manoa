import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runSimulatorTurnServer } from '@/src/lib/sms/simulatorServer'
import type { SimulatorState } from '@/src/lib/sms/simulator'

export const runtime = 'nodejs'

const simulatorMessageSchema = z.object({
  role: z.enum(['user', 'manoa']),
  text: z.string(),
})

const simulatorEventSchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string(),
  calendarId: z.string(),
  calendarName: z.string(),
  timeLabel: z.string(),
  location: z.string(),
  description: z.string(),
  organizerEmail: z.string(),
  attendeeCount: z.number(),
})

const simulatorPendingSchema: z.ZodTypeAny = z
  .object({
    kind: z.string(),
    payload: z.record(z.string(), z.unknown()),
  })
  .nullable()

const simulatorStateSchema = z.object({
  recognized: z.boolean(),
  subscriptionActive: z.boolean(),
  calendarConnected: z.boolean(),
  smsEnabled: z.boolean(),
  profile: z.object({
    email: z.string(),
    phoneE164: z.string(),
  }),
  messages: z.array(simulatorMessageSchema),
  todayEvents: z.array(simulatorEventSchema),
  tomorrowEvents: z.array(simulatorEventSchema),
  businessContacts: z.array(
    z.object({
      label: z.string(),
      phoneE164: z.string(),
      aliases: z.array(z.string()),
    }),
  ),
  peopleContacts: z.array(
    z.object({
      label: z.string(),
      email: z.string(),
      aliases: z.array(z.string()),
    }),
  ),
  pending: simulatorPendingSchema,
  backgroundPending: simulatorPendingSchema,
  lastDebug: z
    .object({
      intent: z.string(),
      branch: z.string(),
      matchedEvent: z.string().optional(),
      authority: z.string().optional(),
      understoodBy: z.enum(['AI', 'Fallback parser']).optional(),
      notes: z.array(z.string()),
    })
    .nullable(),
  nextId: z.number(),
})

const requestSchema = z.object({
  state: simulatorStateSchema,
  body: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const json = await request.json()
  const parsed = requestSchema.safeParse(json)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid simulator payload.' }, { status: 400 })
  }

  const result = await runSimulatorTurnServer(parsed.data.state as SimulatorState, parsed.data.body)
  return NextResponse.json(result)
}
