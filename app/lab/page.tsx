import type { Metadata } from 'next'
import ManoaLabPage from '@/src/components/ManoaLabPage'

export const metadata: Metadata = {
  title: 'Manoa Internal Preview',
  description: 'Internal preview for Manoa backend behavior.',
}

export default function Page() {
  return <ManoaLabPage />
}
