import React from 'react'
import type { ReactNode } from 'react'
import { Link } from '../components/ui.js'
import { TERMS_VERSION, legalBySlug, legalDocs } from '../legal/content.js'
import { PublicFrame } from './Public.js'

// Tiny renderer for the legal docs' format: "## " headings, "- " lists, **bold**.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))
}

function render(body: string) {
  const out: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
    list = []
  }
  for (const line of body.trim().split('\n')) {
    if (line.startsWith('- ')) {
      list.push(line.slice(2))
      continue
    }
    flush()
    if (line.startsWith('## ')) out.push(<h2 key={out.length}>{line.slice(3)}</h2>)
    else if (/^\d+\. /.test(line)) out.push(<p key={out.length}>{inline(line)}</p>)
    else if (line.trim()) out.push(<p key={out.length}>{inline(line)}</p>)
  }
  flush()
  return out
}

export function Legal({ slug }: { slug: string }) {
  const doc = legalBySlug[slug] ?? legalDocs[0]
  return (
    <PublicFrame>
      <div className="wrap legal">
        <nav className="legal-nav glass-card" aria-label="Legal documents">
          {legalDocs.map((d) => (
            <Link key={d.slug} to={`/legal/${d.slug}`} aria-current={d.slug === doc.slug ? 'page' : undefined}>{d.title}</Link>
          ))}
        </nav>
        <article className="legal-doc glass-card rise" key={doc.slug}>
          <div className="eyebrow">Legal</div>
          <h1 style={{ marginTop: 8 }}>{doc.title}</h1>
          <div className="meta">Effective {TERMS_VERSION} · {doc.summary}</div>
          <div className="draft">Template for attorney review. Items in [brackets] must be completed before public launch.</div>
          {render(doc.body)}
        </article>
      </div>
    </PublicFrame>
  )
}
