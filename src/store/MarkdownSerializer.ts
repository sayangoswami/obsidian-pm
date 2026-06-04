import type { Task, TaskPriority, TaskStatus } from '../types'

// ─── Status mapping ───────────────────────────────────────────────────────────

const STATUS_TO_CHECKBOX: Record<TaskStatus, string> = {
  'todo':        ' ',
  'in-progress': '/',
  'blocked':     '>',
  'review':      '~',
  'done':        'x',
  'cancelled':   '-',
}

function checkboxFor(status: TaskStatus): string {
  return STATUS_TO_CHECKBOX[status] ?? ' '
}

// ─── Priority serialisation ───────────────────────────────────────────────────

function priorityMarker(priority: TaskPriority): string {
  if (priority === 'critical') return ' !!!'
  if (priority === 'high')     return ' !!'
  if (priority === 'medium')   return ' !'
  return ''
}

// ─── Single task line ─────────────────────────────────────────────────────────

/**
 * Serialise one task to a single markdown checkbox line (no trailing newline).
 * Subtasks are serialised separately with increased indentation.
 */
export function serializeTaskLine(task: Task, depth = 0): string {
  const indent = '  '.repeat(depth)
  const checkbox = checkboxFor(task.status)

  const parts: string[] = [`${task.id} -`, task.title]

  if (task.tags.length > 0) parts.push(task.tags.map(t => `#${t}`).join(' '))
  if (task.start) parts.push(`start:${task.start}`)
  if (task.due)   parts.push(`due:${task.due}`)
  if (task.dependencies.length > 0) parts.push(`after:${task.dependencies.join(',')}`)

  const priority = priorityMarker(task.priority)

  return `${indent}- [${checkbox}] ${parts.join(' ')}${priority}`
}

// ─── Full file serialiser ─────────────────────────────────────────────────────

/**
 * Serialise all tasks back to Tasks.md content.
 *
 * Tasks are grouped under their `## group` header. Tasks with `group === null`
 * are written before any headers. A blank line separates each top-level task
 * block for readability.
 *
 * The `groupOrder` array (from ParsedFile.groups) controls the order headers
 * are emitted, preserving the original document structure.
 */
export function serializeTasksFile(tasks: Task[], groupOrder: Array<string | null>): string {
  // Bucket top-level tasks by group, preserving insertion order within each bucket
  const byGroup = new Map<string | null, Task[]>()
  for (const g of groupOrder) byGroup.set(g, [])
  for (const task of tasks) {
    const key = task.group ?? null
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(task)
  }

  const sections: string[] = []

  for (const group of groupOrder) {
    const groupTasks = byGroup.get(group) ?? []
    if (group !== null) {
      // Write the heading followed by its tasks
      const taskLines = groupTasks.flatMap(t => serializeTaskSubtree(t, 0))
      if (taskLines.length > 0) {
        sections.push(`## ${group}\n\n${taskLines.join('\n')}`)
      } else {
        sections.push(`## ${group}`)
      }
    } else {
      // Ungrouped tasks written before any headers
      const taskLines = groupTasks.flatMap(t => serializeTaskSubtree(t, 0))
      if (taskLines.length > 0) sections.push(taskLines.join('\n'))
    }
  }

  // Include any groups not in groupOrder (shouldn't normally happen, but be safe)
  for (const [group, groupTasks] of byGroup) {
    if (groupOrder.includes(group)) continue
    const taskLines = groupTasks.flatMap(t => serializeTaskSubtree(t, 0))
    if (group !== null) {
      sections.push(`## ${group}\n\n${taskLines.join('\n')}`)
    } else if (taskLines.length > 0) {
      sections.push(taskLines.join('\n'))
    }
  }

  return sections.join('\n\n') + (sections.length > 0 ? '\n' : '')
}

/** Recursively serialise a task and all its subtasks into an array of lines. */
function serializeTaskSubtree(task: Task, depth: number): string[] {
  const lines: string[] = [serializeTaskLine(task, depth)]
  for (const sub of task.subtasks) {
    lines.push(...serializeTaskSubtree(sub, depth + 1))
  }
  return lines
}
