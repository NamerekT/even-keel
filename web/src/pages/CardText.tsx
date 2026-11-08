import Markdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { isTaskId } from '../../../src/stats/model.js'
import type { TaskCard as Card } from '../../../src/tracker/card.js'
import type { TaskStatus } from '../../../src/tracker/model.js'
import '../ui/markdown.css'

/** A task's text as the card draws it: its description, a comment. */
export function Text({ children, components }: { children: string; components: Components }) {
  return (
    <div className="markdown task-card__markdown">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>
        {children}
      </Markdown>
    </div>
  )
}

export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span className={`task-card__status task-card__status--${status.category}`}>
      <span className="task-card__dot" />
      {status.name}
    </span>
  )
}

// A link to a task opens its card; a web link opens in a new tab; a link the tracker keeps to itself stays text.
export function useMarkdown(onOpen: (task: string) => void, attachments: Card['attachments']): Components {
  const localFiles = new Set(attachments.map((file) => file.url).filter((url) => url.startsWith('/api/tasks/')))
  return {
    a: ({ href, children }) => {
      if (typeof children === 'string' && isTaskId(children) && !/^https?:/i.test(href ?? '')) {
        return (
          <button type="button" className="task-card__inline-ref" onClick={() => onOpen(children)}>
            {children}
          </button>
        )
      }
      if (href !== undefined && (/^(https?|mailto):/i.test(href) || localFiles.has(href))) {
        return (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }
      return <span>{children}</span>
    },
    img: ({ src, alt }) => typeof src === 'string' && localFiles.has(src)
      ? <img src={src} alt={alt ?? ''} loading="lazy" style={{ maxWidth: '100%', height: 'auto' }} />
      : (alt ? <span className="markdown__image">[{alt}]</span> : null),
  }
}
