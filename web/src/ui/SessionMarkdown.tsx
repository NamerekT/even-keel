import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './markdown.css'

const PARTS: Components = {
  a: ({ href, children }) =>
    href !== undefined && /^(https?|mailto):/i.test(href) ? (
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  img: ({ alt }) => (alt ? <span className="markdown__image">[{alt}]</span> : null),
}

/** Markdown a session wrote: only web and mail links open, pictures stay their alt text. */
export function SessionMarkdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={[remarkGfm]} components={PARTS}>
        {text}
      </Markdown>
    </div>
  )
}
