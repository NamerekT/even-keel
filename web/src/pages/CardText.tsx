import Markdown, { type Components } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import type { ConfigView, EvenKeelState } from '../../../src/state.js'
import { isTaskId } from '../../../src/stats/model.js'
import type { TaskCard as Card } from '../../../src/tracker/card.js'
import type { TaskStatus } from '../../../src/tracker/model.js'
import { CodeBlock } from '../ui/CodeBlock.js'
import { remarkTaskRefs, taskRefParts } from './cardTaskRefs.js'
import '../ui/markdown.css'

export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <span className={`task-card__status task-card__status--${status.category}`}>
      <span className="task-card__dot" />
      {status.name}
    </span>
  )
}

type PrefixSource = Pick<EvenKeelState, 'taskPrefixes'> & { config: Pick<ConfigView, 'feeds'> }

export function cardMarkdown(state: PrefixSource | null, onOpen: (task: string) => void, attachments: Card['attachments']) {
  const prefixes = new Set(Object.values(state?.taskPrefixes ?? {}))
  for (const feeds of Object.values(state?.config.feeds ?? {})) {
    for (const feed of feeds) prefixes.add(feed.prefix ?? feed.key)
  }
  const localFiles = new Set(attachments.map((file) => file.url).filter((url) => url.startsWith('/api/tasks/')))
  const reference = (id: string, key?: number) => <button key={key} type="button" className="task-card__inline-ref" onClick={() => onOpen(id)}>{id}</button>
  const components: Components = {
    a: ({ href, children }) => {
      if (typeof children === 'string' && isTaskId(children) && !/^https?:/i.test(href ?? '')) {
        return reference(children)
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
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  }
  return {
    render: (text: string) => <div className="markdown task-card__markdown">
      <Markdown remarkPlugins={[remarkGfm, [remarkTaskRefs, prefixes]]} rehypePlugins={[rehypeRaw, rehypeSanitize]} components={components}>{text}</Markdown>
    </div>,
    plain: (text: string) => taskRefParts(text, prefixes).map((part, i) => part.type === 'link' ? reference(part.url, i) : part.value),
  }
}
