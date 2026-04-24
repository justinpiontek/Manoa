import type { Metadata } from 'next'
import LoginPageClient from '@/src/components/LoginPageClient'

export const metadata: Metadata = {
  title: 'Log In to Manoa',
  description: 'Email yourself a secure Manoa login link.',
}

type LoginPageProps = {
  searchParams: Promise<{
    email?: string
    login?: string
  }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const isSupabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )

  return (
    <LoginPageClient
      initialEmail={params.email || ''}
      loginStatus={params.login}
      isSupabaseConfigured={isSupabaseConfigured}
      appUrl={process.env.NEXT_PUBLIC_APP_URL || null}
    />
  )
}
