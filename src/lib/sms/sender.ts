const dashboardSenderPrefix = 'dashboard:'

export function dashboardSender(profileId: string) {
  return `${dashboardSenderPrefix}${profileId}`
}

export function profileIdFromDashboardSender(sender: string) {
  if (!sender.startsWith(dashboardSenderPrefix)) return null

  const profileId = sender.slice(dashboardSenderPrefix.length).trim()
  return profileId || null
}
