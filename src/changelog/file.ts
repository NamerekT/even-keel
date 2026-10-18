/** The changelog of a project without its own `changelog` setting, relative to the repository's root. */
export const DEFAULT_CHANGELOG = 'CHANGELOG.md'

/** What a new changelog file starts with, as Keep a Changelog has it. */
const HEADER = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
`

/** A `## ` section of a changelog file. */
export interface Section {
  /** The heading line as written: `## [0.1.0] - 2026-10-21`. */
  heading: string
  /** The version in the heading's brackets, else its first word: `Unreleased`, `0.1.0`. */
  name: string
  /** Where the section starts and ends in the file, its trailing blank lines left out. */
  start: number
  end: number
  /** The heading and the body. */
  text: string
}

/** Where the milestone's draft goes in the changelog (`changelogPlan`). */
export interface ChangelogPlan {
  /** The milestone's section the draft replaces; `null` — the draft is a new section, put above the others. */
  section: Section | null
  /** The heading of a new section. */
  heading: string
  /** The milestone's sections of tagged versions, in the file's order: released and frozen. */
  released: Section[]
  /** The milestone's newest tag; `null` — it has none. */
  tag: string | null
}

const HEADING = /^## +(.*?)\s*$/
const LINK_REFERENCE = /^\[[^\]]+\]:\s*\S/
const FENCE = /^\s*(```|~~~)/
const VERSION = /^v?(\d+(?:\.\d+)*)$/i

/** The `## ` sections of the file, in its order; the last one ends before the link references at the end of the file. */
export function sectionsOf(text: string): Section[] {
  const lines = text.split('\n')
  const offsets: number[] = []
  const starts: number[] = []
  let offset = 0
  let fenced = false
  lines.forEach((line, index) => {
    offsets.push(offset)
    offset += line.length + 1
    if (FENCE.test(line)) fenced = !fenced
    else if (!fenced && HEADING.test(line)) starts.push(index)
  })
  const blank = (at: number) => lines[at]!.trim() === ''
  return starts.map((line, index) => {
    let last = (starts[index + 1] ?? lines.length) - 1
    if (index === starts.length - 1) {
      for (let at = last; at > line && (blank(at) || LINK_REFERENCE.test(lines[at]!)); at--) {
        if (!blank(at)) last = at - 1
      }
    }
    while (last > line && blank(last)) last--
    const start = offsets[line]!
    const end = offsets[last]! + lines[last]!.trimEnd().length
    const heading = lines[line]!.trimEnd()
    const title = HEADING.exec(heading)![1]!
    const name = /^\[([^\]]+)\]/.exec(title)?.[1] ?? title.split(/\s+/)[0]!
    return { heading, name, start, end, text: text.slice(start, end) }
  })
}

/** The version a milestone's label names, `v0.1` → `0.1`; `null` — the label is not a version. */
export function milestoneVersion(milestone: string): string | null {
  return VERSION.exec(milestone.trim())?.[1] ?? null
}

const partsOf = (version: string) => version.split('.').map(Number)
const belongs = (name: string, version: string) => name === version || name.startsWith(`${version}.`)

function byVersion(a: string, b: string): number {
  const [left, right] = [partsOf(a), partsOf(b)]
  for (let at = 0; at < Math.max(left.length, right.length); at++) {
    const diff = (left[at] ?? 0) - (right[at] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** The version after the tag's, by its last part: `0.1.0` → `0.1.1`, `0.1` → `0.1.1`. */
function nextPatch(version: string): string {
  const parts = partsOf(version)
  while (parts.length < 3) parts.push(0)
  parts[parts.length - 1]! += 1
  return parts.join('.')
}

/**
 * Where the milestone's draft goes. A milestone named by a version (`v0.1`) owns the sections of that version and its
 * patches (`[0.1.0]`, `[0.1.1]`); one with a tag (`v0.1.0`) is released, and its section is frozen: the draft is the
 * section of the next patch, put above the others. Until the first tag the milestone's section is also `Unreleased`.
 */
export function changelogPlan(text: string | null, milestone: string, tags: string[]): ChangelogPlan {
  const sections = sectionsOf(text ?? '')
  const version = milestoneVersion(milestone)
  const tagged = version === null ? [] : tags.flatMap((tag) => {
    const found = VERSION.exec(tag.trim())?.[1]
    return found !== undefined && belongs(found, version) ? [{ tag: tag.trim(), version: found }] : []
  })
  tagged.sort((a, b) => byVersion(b.version, a.version))
  const isTagged = (name: string) => tagged.some((each) => byVersion(each.version, name) === 0)
  const own = (name: string) => version !== null && /^\d/.test(name) && belongs(name, version)
  const section = sections.find((each) => (own(each.name) && !isTagged(each.name)) || (tagged.length === 0 && each.name.toLowerCase() === 'unreleased'))
  const newest = tagged[0]
  return {
    section: section ?? null,
    heading: newest === undefined ? '## [Unreleased]' : `## [${nextPatch(newest.version)}]`,
    released: sections.filter((each) => own(each.name) && isTagged(each.name)),
    tag: newest?.tag ?? null,
  }
}

/** The file with the section in the place the plan names; a new file when there is none. */
export function withSection(text: string | null, plan: ChangelogPlan, section: string): string {
  const body = section.trim()
  if (text === null || text.trim() === '') return `${HEADER}\n${body}\n`
  if (plan.section !== null) return text.slice(0, plan.section.start) + body + text.slice(plan.section.end)
  const first = sectionsOf(text)[0]
  if (first === undefined) return `${text.trimEnd()}\n\n${body}\n`
  return `${text.slice(0, first.start)}${body}\n\n${text.slice(first.start)}`
}

/** The section of the agent's answer: from its first `## ` heading, out of a code fence; the heading put on when it has none. */
export function answerSection(answer: string, heading: string): string {
  const lines = answer.trim().split('\n')
  const start = lines.findIndex((line) => HEADING.test(line))
  let body = start === -1 ? lines : lines.slice(start)
  if (start === -1 && FENCE.test(body[0] ?? '')) body = body.slice(1)
  // The fence the answer was wrapped in closes after the section, unmatched within it.
  if (body.filter((line) => FENCE.test(line)).length % 2 === 1 && FENCE.test(body.at(-1) ?? '')) body = body.slice(0, -1)
  const text = body.join('\n').trim()
  return start === -1 ? `${heading}\n\n${text}` : text
}

/**
 * The `changelog` setting as a path relative to the repository's root: any slashes, the outer ones trimmed. `null` — it
 * leads out of the repository (absolute, `~`, `..`) or names nothing.
 */
export function changelogPath(value: string): string | null {
  const text = value.trim().replace(/\\/g, '/')
  if (/^[a-z]:/i.test(text) || text.startsWith('~')) return null
  const parts = text.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0 || parts.includes('..')) return null
  return parts.join('/')
}
