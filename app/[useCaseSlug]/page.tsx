import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import UseCasePage from '@/src/components/UseCasePage'
import { appUrl } from '@/src/lib/env'
import { getRelatedLinks, getUseCaseBySlug, useCases } from '@/src/lib/useCases'

type UseCaseRoutePageProps = {
  params: Promise<{
    useCaseSlug: string
  }>
}

export const dynamicParams = false

export function generateStaticParams() {
  return useCases.map((useCase) => ({
    useCaseSlug: useCase.slug,
  }))
}

export async function generateMetadata({
  params,
}: UseCaseRoutePageProps): Promise<Metadata> {
  const { useCaseSlug } = await params
  const useCase = getUseCaseBySlug(useCaseSlug)
  if (!useCase) return {}

  const canonicalUrl = `${appUrl()}${useCase.href}`

  return {
    title: `${useCase.cardTitle} | Manoa`,
    description: useCase.cardDescription,
    alternates: {
      canonical: useCase.href,
    },
    openGraph: {
      title: `${useCase.cardTitle} | Manoa`,
      description: useCase.cardDescription,
      url: canonicalUrl,
      siteName: 'Manoa',
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${useCase.cardTitle} | Manoa`,
      description: useCase.cardDescription,
    },
  }
}

export default async function UseCaseRoutePage({ params }: UseCaseRoutePageProps) {
  const { useCaseSlug } = await params
  const useCase = getUseCaseBySlug(useCaseSlug)

  if (!useCase) {
    notFound()
  }

  return (
    <UseCasePage
      href={useCase.href}
      eyebrow={useCase.eyebrow}
      title={useCase.title}
      description={useCase.description}
      intro={useCase.intro}
      exampleUser={useCase.exampleUser}
      exampleManoa={useCase.exampleManoa}
      benefits={useCase.benefits}
      idealFor={useCase.idealFor}
      steps={useCase.steps}
      faqs={useCase.faqs}
      relatedLinks={getRelatedLinks(useCase.slug)}
    />
  )
}
