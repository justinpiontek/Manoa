import type { Metadata } from 'next'
import AuthCallbackClient from '@/src/components/AuthCallbackClient'

export const metadata: Metadata = {
  title: 'Signing You In to Manoa',
  description: 'Finishing your secure Manoa login.',
}

type AuthCallbackPageProps = {
  searchParams: Promise<{
    next?: string
  }>
}

export default async function AuthCallbackPage({ searchParams }: AuthCallbackPageProps) {
  const params = await searchParams
  const nextPath = params.next || '/dashboard'

  return <AuthCallbackClient nextPath={nextPath} />
}
