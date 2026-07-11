export const onboardingExampleTexts = [
  "What's on my calendar tomorrow?",
  'Schedule lunch Tuesday at noon.',
  'Move dentist to Friday at 3pm.',
]

function numberedExamples() {
  return onboardingExampleTexts.map((example, index) => `${index + 1}. ${example}`).join('\n')
}

export function welcomeTextForLogin(loginUrl: string) {
  return [
    `Welcome to Manoa. Open your dashboard here: ${loginUrl}`,
    'Connect a calendar, then try:',
    numberedExamples(),
    'Reply STOP to opt out or HELP for help.',
  ].join('\n')
}

export function readyToTextExamplesReply(loginUrl: string) {
  return [
    'Your calendar setup looks ready.',
    'Try one of these:',
    numberedExamples(),
    `Open ${loginUrl} if you want to review your settings.`,
  ].join('\n')
}

export function noBookingCalendarReply(openUrl: string) {
  return [
    'Almost ready. Manoa can see your calendars, but it still needs one calendar for new bookings.',
    `Open ${openUrl}, then in Calendar settings turn on "Books here" on the calendar you want Manoa to add new events to.`,
    'You only need one.',
    'After that, try: "Schedule lunch Tuesday at noon."',
  ].join('\n')
}
