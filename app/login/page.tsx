import type { Metadata } from 'next'
import LoginPageClient from '@/src/components/LoginPageClient'

export const metadata: Metadata = {
  title: 'Log In to Manoa',
  description: 'Email yourself a secure Manoa login link.',
}

type LoginPageProps = {
  searchParams: Promise<{
    login?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams

  return <LoginPageClient loginStatus={params.login} />
}
