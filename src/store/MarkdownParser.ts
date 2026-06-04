import { makeId } from '../types'
import type { Task, TaskPriority, TaskStatus, TaskType } from '../types'

// ─── Status mapping ───────────────────────────────────────────────────────────

const CHECKBOX_TO_STATUS: Record<string, TaskStatus> = {
  ' ': 'todo',
  '/': 'in-progress',
  '>': 'blocked',
  '~': 'review',
  'x': 'done',
  '-': 'cancelled',
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

/** Parse YYYY-MM-DD, M/D/YY, or M/D/YYYY → YYYY-MM-DD string. Returns '' on failure. */
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

  return ''
}

// ─── Task text tokeniser ──────────────────────────────────────────────────────

interface ParsedTokens {
  id: string
  title: string
  tags: string[]
  due: string
  start: string
  priority: TaskPriority
  dependencies: string[]
  type: TaskType
}

/**
 * Extract structured tokens from the raw text after `- [X] `.
 *
 * Token extraction order (all are stripped from the text before deriving title):
 *   1. ID  — leading token matching /^\d+(\.\d+)+/
 *   2. #tags
 *   3. due:DATE
 *   4. start:DATE
 *   5. after:ID1,ID2
 *   6. priority  — trailing ! / !! / !!!
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

  // 2. Tags
  const tags: string[] = []
  rest = rest.replace(/#([\w-]+)/g, (_, tag) => {
    tags.push(tag)
    return ''
  })

  // 3. due:DATE
  let due = ''
  rest = rest.replace(/\bdue:([\d\-/]+)/i, (_, raw) => {
    due = parseDate(raw)
    return ''
  })

  // 4. start:DATE
  let start = ''
  rest = rest.replace(/\bstart:([\d\-/]+)/i, (_, raw) => {
    start = parseDate(raw)
    return ''
  })

  // 5. after:ID1,ID2,...
  const dependencies: string[] = []
  rest = rest.replace(/\bafter:([\d.,]+)/i, (_, raw) => {
    dependencies.push(...raw.split(',').map((s: string) => s.trim()).filter(Boolean))
    return ''
  })

  // 6. Priority — standalone ! / !! / !!! (not part of a word)
  let priority: TaskPriority = 'low'
  rest = rest.replace(/(?<!\w)(!!!|!!|!)(?!\w)/g, (_, marks) => {
    if (marks === '!!!') priority = 'critical'
    else if (marks === '!!') priority = 'high'
    else priority = 'medium'
    return ''
  })

  // Milestone detection — treat "milestone" tag as type
  const type: TaskType = tags.includes('milestone') ? 'milestone' : 'task'

  const title = rest.replace(/\s+/g, ' ').trim()

  return { id, title, tags: tags.filter(t => t !== 'milestone'), due, start, priority, dependencies, type }
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
 * - `- [X] ...` lines are task list items; indentation (2 spaces per level)
 *   determines parent-child relationships.
 * - Non-task lines are ignored for task purposes but the group context is
 *   preserved so the serializer can reconstruct them.
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

  const trackGroup = (g: string | null) => {
    if (!seenGroups.has(g)) {
      seenGroups.add(g)
      groupOrder.push(g)
    }
  }

  // Track initial null group if there are tasks before any header
  // (will be added lazily when first task without header is encountered)

  for (const line of lines) {
    // Heading → new group
    const headingMatch = /^#{1,6}\s+(.+)$/.exec(line)
    if (headingMatch) {
      currentGroup = headingMatch[1].trim()
      trackGroup(currentGroup)
      continue
    }

    // Task list item
    const taskMatch = /^(\s*)- \[(.)\] (.+)$/.exec(line)
    if (!taskMatch) continue

    const [, indent, checkbox, rawText] = taskMatch
    const depth = Math.floor(indent.length / 2)
    const status = CHECKBOX_TO_STATUS[checkbox] ?? 'todo'
    const tokens = parseTaskText(rawText)

    const now = new Date().toISOString()
    const task: Task = {
      id: tokens.id,
      title: tokens.title,
      description: '',
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
      updatedAt: now,
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
  task.progress = Math.round(
    childProgressValues.reduce((sum, p) => sum + p, 0) / childProgressValues.length
  )
  return task.progress
}
