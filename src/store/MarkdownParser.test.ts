import { describe, it, expect } from 'vitest'
import { parseDate, parseTaskText, parseTasksFile } from './MarkdownParser'

// ─── parseDate ────────────────────────────────────────────────────────────────

describe('parseDate', () => {
  it('passes through ISO dates unchanged', () => {
    expect(parseDate('2025-01-15')).toBe('2025-01-15')
  })

  it('parses M/D/YY (2-digit year)', () => {
    expect(parseDate('1/15/25')).toBe('2025-01-15')
  })

  it('parses M/D/YYYY', () => {
    expect(parseDate('1/15/2025')).toBe('2025-01-15')
  })

  it('pads single-digit month and day', () => {
    expect(parseDate('3/5/25')).toBe('2025-03-05')
  })

  it('returns empty string for empty input', () => {
    expect(parseDate('')).toBe('')
  })

  it('returns empty string for unrecognised format', () => {
    expect(parseDate('Jan 15')).toBe('')
  })
})

// ─── parseTaskText ────────────────────────────────────────────────────────────

describe('parseTaskText', () => {
  it('extracts a bare title with no tokens', () => {
    const r = parseTaskText('Fix login bug')
    expect(r.title).toBe('Fix login bug')
    expect(r.tags).toEqual([])
    expect(r.due).toBe('')
    expect(r.priority).toBe('low')
    expect(r.dependencies).toEqual([])
  })

  it('extracts numeric ID from the start', () => {
    const r = parseTaskText('1 Fix login bug')
    expect(r.id).toBe('1')
    expect(r.title).toBe('Fix login bug')
  })

  it('extracts dotted ID (subtask)', () => {
    const r = parseTaskText('1.2 Deploy fix')
    expect(r.id).toBe('1.2')
    expect(r.title).toBe('Deploy fix')
  })

  it('extracts deeply nested ID', () => {
    const r = parseTaskText('2.1.3 Write unit tests')
    expect(r.id).toBe('2.1.3')
    expect(r.title).toBe('Write unit tests')
  })

  it('extracts tags', () => {
    const r = parseTaskText('1 Fix bug #auth #backend')
    expect(r.tags).toEqual(['auth', 'backend'])
    expect(r.title).toBe('Fix bug')
  })

  it('extracts ISO due date', () => {
    const r = parseTaskText('1 Fix bug due:2025-01-15')
    expect(r.due).toBe('2025-01-15')
  })

  it('extracts M/D/YY due date', () => {
    const r = parseTaskText('1 Fix bug due:1/15/25')
    expect(r.due).toBe('2025-01-15')
  })

  it('extracts start and due dates together', () => {
    const r = parseTaskText('2 Write report start:1/10/25 due:1/20/25')
    expect(r.start).toBe('2025-01-10')
    expect(r.due).toBe('2025-01-20')
  })

  it('extracts single dependency', () => {
    const r = parseTaskText('1.2 Deploy fix after:1.1')
    expect(r.dependencies).toEqual(['1.1'])
  })

  it('extracts multiple dependencies', () => {
    const r = parseTaskText('3 Deploy after:1,2')
    expect(r.dependencies).toEqual(['1', '2'])
  })

  it('extracts medium priority (!)', () => {
    const r = parseTaskText('1 Fix bug !')
    expect(r.priority).toBe('medium')
  })

  it('extracts high priority (!!)', () => {
    const r = parseTaskText('1 Fix bug !!')
    expect(r.priority).toBe('high')
  })

  it('extracts critical priority (!!!)', () => {
    const r = parseTaskText('1 Fix bug !!!')
    expect(r.priority).toBe('critical')
  })

  it('handles all tokens together', () => {
    const r = parseTaskText('1 Fix login bug #auth due:1/15/25 start:1/10/25 after:0 !!')
    expect(r.id).toBe('1')
    expect(r.title).toBe('Fix login bug')
    expect(r.tags).toEqual(['auth'])
    expect(r.due).toBe('2025-01-15')
    expect(r.start).toBe('2025-01-10')
    expect(r.dependencies).toEqual(['0'])
    expect(r.priority).toBe('high')
  })

  it('does not confuse ! inside a word with priority', () => {
    const r = parseTaskText('1 Check user!input')
    expect(r.priority).toBe('low')
    expect(r.title).toContain('user!input')
  })
})

// ─── parseTasksFile ───────────────────────────────────────────────────────────

describe('parseTasksFile', () => {
  it('parses a flat list of tasks', () => {
    const content = `
- [ ] 1 Todo task
- [x] 2 Done task
- [-] 3 Cancelled task
`.trim()
    const { tasks } = parseTasksFile(content)
    expect(tasks).toHaveLength(3)
    expect(tasks[0].status).toBe('todo')
    expect(tasks[1].status).toBe('done')
    expect(tasks[2].status).toBe('cancelled')
  })

  it('maps all checkbox characters to statuses', () => {
    const content = [
      '- [ ] 1 todo',
      '- [/] 2 in-progress',
      '- [>] 3 blocked',
      '- [~] 4 review',
      '- [x] 5 done',
      '- [-] 6 cancelled',
    ].join('\n')
    const { tasks } = parseTasksFile(content)
    expect(tasks.map(t => t.status)).toEqual([
      'todo', 'in-progress', 'blocked', 'review', 'done', 'cancelled',
    ])
  })

  it('parses nested subtasks', () => {
    const content = `
- [/] 1 Parent task
  - [ ] 1.1 Child one
  - [ ] 1.2 Child two
    - [ ] 1.2.1 Grandchild
`.trim()
    const { tasks } = parseTasksFile(content)
    expect(tasks).toHaveLength(1)
    const parent = tasks[0]
    expect(parent.subtasks).toHaveLength(2)
    expect(parent.subtasks[1].subtasks).toHaveLength(1)
    expect(parent.subtasks[1].subtasks[0].title).toBe('Grandchild')
  })

  it('assigns group from ## headings to top-level tasks', () => {
    const content = `
## Work
- [ ] 1 Work task

## Personal
- [ ] 2 Personal task
`.trim()
    const { tasks } = parseTasksFile(content)
    expect(tasks[0].group).toBe('Work')
    expect(tasks[1].group).toBe('Personal')
  })

  it('subtasks do not inherit group (group is null)', () => {
    const content = `
## Work
- [/] 1 Parent
  - [ ] 1.1 Child
`.trim()
    const { tasks } = parseTasksFile(content)
    expect(tasks[0].group).toBe('Work')
    expect(tasks[0].subtasks[0].group).toBeNull()
  })

  it('returns groups in document order', () => {
    const content = `
## Alpha
- [ ] 1 A

## Beta
- [ ] 2 B

## Alpha
- [ ] 3 A2
`.trim()
    const { groups } = parseTasksFile(content)
    // Alpha appears first, Beta second; duplicate Alpha not re-added
    expect(groups).toEqual(['Alpha', 'Beta'])
  })

  it('handles tasks before any heading (null group)', () => {
    const content = `
- [ ] 1 Ungrouped task

## Later
- [ ] 2 Grouped task
`.trim()
    const { tasks, groups } = parseTasksFile(content)
    expect(tasks[0].group).toBeNull()
    expect(tasks[1].group).toBe('Later')
    expect(groups[0]).toBeNull()
    expect(groups[1]).toBe('Later')
  })

  it('computes progress from subtask completion', () => {
    const content = `
- [ ] 1 Parent
  - [x] 1.1 Done
  - [x] 1.2 Done
  - [ ] 1.3 Not done
`.trim()
    const { tasks } = parseTasksFile(content)
    // 2 of 3 subtasks done → ~67%
    expect(tasks[0].progress).toBeCloseTo(67, 0)
  })

  it('ignores non-task lines', () => {
    const content = `
Some introductory text.

- [ ] 1 Task one

> A blockquote is not a task.

- [ ] 2 Task two
`.trim()
    const { tasks } = parseTasksFile(content)
    expect(tasks).toHaveLength(2)
  })

  it('returns empty array for empty file', () => {
    const { tasks, groups } = parseTasksFile('')
    expect(tasks).toHaveLength(0)
    expect(groups).toHaveLength(0)
  })
})
