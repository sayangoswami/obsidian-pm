import { makeId } from '../types'
import type { Task, TaskPriority, TaskStatus, TaskType } from '../types'

// ─── Status mapping ───────────────────────────────────────────────────────────

const CHECKBOX_TO_STATUS: Record<string, TaskStatus> = {
  ' ': 'todo',
  '/': 'in-progress',
  '>': 'blocked',
  '~': 'review',
  x: 'done',
  '-': 'cancelled'
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
}

/** Parse YYYY-MM-DD, M/D/YY, M/D/YYYY, or "D Mon" → YYYY-MM-DD. Returns '' on failure. */
export function parseDate(raw: string): string {
  if (!raw) return ''

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  // M/D/YY or M/D/YYYY
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(raw)
  if (slash) {
    const [, m, d, y] = slash
    const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10)
    const mm = m.padStart(2, '0')
    const dd = d.padStart(2, '0')
    return `${year}-${mm}-${dd}`
  }

  // "D Mon" or "DD Mon" — year inferred as current year
  const named = /^(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$/i.exec(raw)
  if (named) {
    const day = parseInt(named[1], 10)
    const month = MONTH_NAMES[named[2].toLowerCase()]
    const year = new Date().getFullYear()
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return ''
}

// ─── Task text tokeniser ──────────────────────────────────────────────────────

interface ParsedTokens {
  id: string
  title: string
  description: string
  tags: string[]
  due: string
  start: string
  priority: TaskPriority
  dependencies: string[]
  type: TaskType
}

// Matches M/D/YY, M/D/YYYY, YYYY-MM-DD, or "D Mon" / "DD Mon"
const DATE_PAT =
  /\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/

/**
 * Extract structured tokens from the raw text after `- [X] `.
 *
 * Supports both natural-language date format and legacy token format:
 *   - New:    "from DATE[, by DATE]"  |  "by DATE"
 *   - Legacy: "start:DATE"  |  "due:DATE"
 * Title ends with a period in the new format; the period is stripped.
 * #tags, after:IDs, and !/!!/!!! are unchanged.
 */
export function parseTaskText(text: string): ParsedTokens {
  let rest = text.trim()

  // 1. ID — must be the first token, optionally followed by " - " separator
  let id = makeId()
  const idMatch = /^(\d+(?:\.\d+)*)(?:\s+-\s+|\s+)/.exec(rest)
  if (idMatch) {
    id = idMatch[1]
    rest = rest.slice(idMatch[0].length)
  }

  // Strip optional [] brackets wrapping metadata groups, e.g. [after:1 !!] [from DATE, to DATE]
  rest = rest.replace(/\[([^\]]*)\]/g, '$1')

  // 2. Tags
  const tags: string[] = []
  rest = rest.replace(/#([\w-]+)/g, (_, tag) => {
    tags.push(tag)
    return ''
  })

  // 3. Dates — "from DATE[, by/to DATE]" combined first to avoid orphan commas
  let start = ''
  let due = ''
  const fromByRe = new RegExp(
    `\\bfrom\\s+(${DATE_PAT.source})(?:\\s*,?\\s*(?:by|to)\\s+(${DATE_PAT.source}))?`,
    'i'
  )
  rest = rest.replace(fromByRe, (_, startRaw: string, dueRaw?: string) => {
    start = parseDate(startRaw)
    if (dueRaw) due = parseDate(dueRaw)
    return ''
  })
  // Standalone "by/to DATE" (when no "from" precedes it)
  rest = rest.replace(new RegExp(`\\b(?:by|to)\\s+(${DATE_PAT.source})`, 'i'), (_, dueRaw: string) => {
    due = due || parseDate(dueRaw)
    return ''
  })
  // Legacy: "due:DATE" and "start:DATE"
  rest = rest.replace(/\bdue:([\d\-/]+)/i, (_, raw: string) => {
    due = due || parseDate(raw)
    return ''
  })
  rest = rest.replace(/\bstart:([\d\-/]+)/i, (_, raw: string) => {
    start = start || parseDate(raw)
    return ''
  })

  // 4. after:ID1,ID2,...
  const dependencies: string[] = []
  rest = rest.replace(/\bafter:\s*([\d.,]+)/i, (_, raw: string) => {
    dependencies.push(
      ...raw
        .replace(/\.+$/, '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    )
    return ''
  })

  // 5. Priority — standalone ! / !! / !!! (not part of a word)
  let priority: TaskPriority = 'low'
  rest = rest.replace(/(?<!\w)(!!!|!!|!)(?!\w)/g, (_, marks: string) => {
    if (marks === '!!!') priority = 'critical'
    else if (marks === '!!') priority = 'high'
    else priority = 'medium'
    return ''
  })

  // Milestone detection — treat "milestone" tag as type
  const type: TaskType = tags.includes('milestone') ? 'milestone' : 'task'

  // Split remaining text on first ". " — left = title, right = inline description.
  // A lone trailing period (no following text) is stripped from the title.
  const cleaned = rest.replace(/\s+/g, ' ').trim()
  const sepIdx = cleaned.search(/\.\s+/)
  let title: string
  let description = ''
  if (sepIdx >= 0) {
    title = cleaned.slice(0, sepIdx).trim()
    description = cleaned.slice(sepIdx + 1).trim()
  } else {
    title = cleaned.replace(/\.$/, '')
  }

  return { id, title, description, tags: tags.filter((t) => t !== 'milestone'), due, start, priority, dependencies, type }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

export interface ParsedFile {
  /** Top-level tasks in document order, with subtasks nested inside. */
  tasks: Task[]
  /**
   * Ordered list of group names encountered (null = tasks before any header).
   * Used by the serializer to reconstruct the file structure.
   */
  groups: Array<string | null>
}

/**
 * Parse the full content of a Tasks.md file into a task tree.
 *
 * Structure rules:
 * - `## Heading` lines start a named group (any level heading).
 * - `- [X] ...` lines are task list items; indentation (one tab per level,
 *   or 2 spaces per level for backward compatibility) determines parent-child relationships.
 * - Non-task, non-heading lines that immediately follow a task (no blank line
 *   in between) are collected as that task's description.
 * - Subtasks inherit their parent's group (group is only set on top-level tasks).
 */
export function parseTasksFile(content: string): ParsedFile {
  const lines = content.split('\n')

  let currentGroup: string | null = null
  const groupOrder: Array<string | null> = []
  const seenGroups = new Set<string | null>()

  // Stack entries: { task, depth }
  const stack: Array<{ task: Task; depth: number }> = []
  // Top-level tasks in order
  const roots: Task[] = []
  // Most recently parsed task — description lines are attached to it
  let lastTask: Task | null = null

  const trackGroup = (g: string | null) => {
    if (!seenGroups.has(g)) {
      seenGroups.add(g)
      groupOrder.push(g)
    }
  }

  // Track initial null group if there are tasks before any header
  // (will be added lazily when first task without header is encountered)

  for (const line of lines) {
    // Blank line: end description collection
    if (line.trim() === '') {
      lastTask = null
      continue
    }

    // Heading → new group
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line)
    if (headingMatch) {
      lastTask = null
      currentGroup = headingMatch[1].trim()
      trackGroup(currentGroup)
      continue
    }

    // Task list item
    const taskMatch = /^(\s*)- \[(.)\] (.+)$/.exec(line)
    if (taskMatch) {
      const [, indent, checkbox, rawText] = taskMatch
      const tabCount = (indent.match(/\t/g) ?? []).length
      const depth = tabCount > 0 ? tabCount : Math.floor(indent.length / 2)
      const status = CHECKBOX_TO_STATUS[checkbox] ?? 'todo'
      const tokens = parseTaskText(rawText)

      const now = new Date().toISOString()
      const task: Task = {
        id: tokens.id,
        title: tokens.title,
        description: tokens.description,
        type: tokens.type,
        status,
        priority: tokens.priority,
        start: tokens.start,
        due: tokens.due,
        progress: 0,
        tags: tokens.tags,
        subtasks: [],
        dependencies: tokens.dependencies,
        group: depth === 0 ? currentGroup : null,
        collapsed: false,
        createdAt: now,
        updatedAt: now
      }

      // Pop stack back to the correct parent depth
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop()
      }

      if (stack.length === 0) {
        // Top-level task
        if (!seenGroups.has(currentGroup)) trackGroup(currentGroup)
        roots.push(task)
      } else {
        // Subtask — attach to the nearest shallower task
        stack[stack.length - 1].task.subtasks.push(task)
      }

      stack.push({ task, depth })
      lastTask = task
      continue
    }

    // Description line — attach to the most recent task
    if (lastTask) {
      const stripped = line.trim()
      lastTask.description = lastTask.description ? `${lastTask.description}\n${stripped}` : stripped
    }
  }

  // Compute progress for all tasks bottom-up
  for (const t of roots) computeProgress(t)

  return { tasks: roots, groups: groupOrder }
}

/** Recursively compute progress from subtask completion status. */
function computeProgress(task: Task): number {
  if (task.subtasks.length === 0) {
    task.progress = task.status === 'done' ? 100 : 0
    return task.progress
  }
  const childProgressValues = task.subtasks.map(computeProgress)
  task.progress = Math.round(childProgressValues.reduce((sum, p) => sum + p, 0) / childProgressValues.length)
  return task.progress
}
