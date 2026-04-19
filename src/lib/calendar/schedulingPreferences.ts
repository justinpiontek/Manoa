export type CandidateTime = {
  hour: number
  minute: number
}

const defaultCandidateTimes: CandidateTime[] = [
  { hour: 9, minute: 0 },
  { hour: 10, minute: 0 },
  { hour: 11, minute: 0 },
  { hour: 13, minute: 0 },
  { hour: 14, minute: 30 },
  { hour: 16, minute: 0 },
]

const lunchCandidateTimes: CandidateTime[] = [
  { hour: 11, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 13, minute: 0 },
  { hour: 11, minute: 30 },
  { hour: 12, minute: 30 },
]

const dinnerCandidateTimes: CandidateTime[] = [
  { hour: 17, minute: 30 },
  { hour: 18, minute: 0 },
  { hour: 18, minute: 30 },
  { hour: 19, minute: 0 },
]

const breakfastCandidateTimes: CandidateTime[] = [
  { hour: 8, minute: 0 },
  { hour: 8, minute: 30 },
  { hour: 9, minute: 0 },
]

export function scheduleCandidateTimesForTitle(title: string): CandidateTime[] {
  const lower = title.toLowerCase()

  if (/\b(lunch|lunchtime)\b/.test(lower)) return lunchCandidateTimes
  if (/\b(dinner|supper)\b/.test(lower)) return dinnerCandidateTimes
  if (/\b(breakfast|brunch)\b/.test(lower)) return breakfastCandidateTimes

  return defaultCandidateTimes
}

export function hasSpecificScheduleTimePreference(title: string) {
  return !Object.is(scheduleCandidateTimesForTitle(title), defaultCandidateTimes)
}
