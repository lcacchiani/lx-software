export interface Highlight {
  title: string
  description: string
}

export interface SiteContent {
  mission: string
  highlights: Highlight[]
}

export const defaultSiteContent: SiteContent = {
  mission: 'LX Software crafts public websites that are clear, fast, and easy to evolve.',
  highlights: [
    {
      title: 'Strategy-led delivery',
      description: 'We keep messaging, design, and engineering aligned from day one.',
    },
    {
      title: 'Modern web foundations',
      description: 'Vite, React Router, and TanStack Query keep performance high.',
    },
    {
      title: 'Infrastructure-ready',
      description: 'We ship artifacts that deploy cleanly to S3 and CloudFront.',
    },
  ],
}

export async function fetchSiteContent(): Promise<SiteContent> {
  const response = await fetch('/content.json')
  if (!response.ok) {
    throw new Error(`Failed to fetch site content: ${response.status}`)
  }
  return response.json() as Promise<SiteContent>
}
