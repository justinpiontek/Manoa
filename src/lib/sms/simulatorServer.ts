import { parseSmsIntentWithAIResult } from './aiIntent'
import { parseSmsIntent } from './parser'
import { runSimulatorTurn, type SimulatorState } from './simulator'

export async function runSimulatorTurnServer(state: SimulatorState, body: string) {
  const aiResult = await parseSmsIntentWithAIResult(body)
  const result = runSimulatorTurn(state, body, {
    intent: aiResult.intent || parseSmsIntent(body),
    understoodBy: aiResult.understoodBy,
  })

  if (aiResult.reason && result.state.lastDebug) {
    const extraNote =
      aiResult.understoodBy === 'AI'
        ? `AI note: ${aiResult.reason}`
        : `AI fallback reason: ${aiResult.reason}`

    result.state = {
      ...result.state,
      lastDebug: {
        ...result.state.lastDebug,
        notes: [...result.state.lastDebug.notes, extraNote],
      },
    }
    result.debug = result.state.lastDebug || result.debug
  }

  return result
}
