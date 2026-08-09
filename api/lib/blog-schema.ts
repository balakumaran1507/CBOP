// Feature B14: auto-emit Article JSON-LD per published post. FAQPage schema
// was retired by Google in May 2026 (per docs/modules/SEO_Build_Plan.md's Phase 1
// research) - Article is the one worth generating for a blog post.

interface PostForSchema {
  title: string
  excerpt: string | null
  meta_description: string | null
  og_image_url: string | null
  canonical_url: string | null
  published_at: string | Date | null
  updated_at: string | Date | null
  author_name: string | null
}

export function generateArticleJsonLd(post: PostForSchema): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.meta_description || post.excerpt || undefined,
    image: post.og_image_url || undefined,
    datePublished: post.published_at ? new Date(post.published_at).toISOString() : undefined,
    dateModified: post.updated_at ? new Date(post.updated_at).toISOString() : undefined,
    author: post.author_name ? { '@type': 'Person', name: post.author_name } : undefined,
    mainEntityOfPage: post.canonical_url ? { '@type': 'WebPage', '@id': post.canonical_url } : undefined,
  }
}
