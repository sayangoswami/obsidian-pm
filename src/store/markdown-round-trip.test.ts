import { describe, it, expect } from 'vitest'
import { parseTasksFile } from './MarkdownParser'
import { serializeTasksFile, serializeTaskLine } from './MarkdownSerializer'
import type { Task } from '../types'

// ─── serializeTaskLine ────────────────────────────────────────────────────────

describe('serializeTaskLine', () => {
  const base: Task = {
    id: '1',
    title: 'Fix login bug',
    description: '',
    type: 'task',
    status: 'todo',
    priority: 'low',
    start: '',
    due: '',
    progress: 0,
    tags: [],
    subtasks: [],
    dependencies: [],
    group: null,
    collapsed: false,
    createdAt: '',
    updatedAt: '',
  }

  it('serialises a minimal task with trailing period', () => {
    expect(serializeTaskLine(base)).toBe('- [ ] 1 - Fix login bug.')
  })

  it('serialises status correctly', () => {
    expect(serializeTaskLine({ ...base, status: 'in-progress' })).toBe('- [/] 1 - Fix login bug.')
    expect(serializeTaskLine({ ...base, status: 'done' })).toBe('- [x] 1 - Fix login bug.')
    expect(serializeTaskLine({ ...base, status: 'cancelled' })).toBe('- [-] 1 - Fix login bug.')
    expect(serializeTaskLine({ ...base, status: 'blocked' })).toBe('- [>] 1 - Fix login bug.')
    expect(serializeTaskLine({ ...base, status: 'review' })).toBe('- [~] 1 - Fix login bug.')
  })

  it('serialises tags', () => {
    const line = serializeTaskLine({ ...base, tags: ['auth', 'backend'] })
    expect(line).toContain('#auth #backend')
  })

  it('serialises due date with "by"', () => {
    const line = serializeTaskLine({ ...base, due: '2025-01-15' })
    expect(line).toContain('by 2025-01-15')
  })

  it('serialises start date only with "from"', () => {
    const line = serializeTaskLine({ ...base, start: '2025-01-10' })
    expect(line).toContain('from 2025-01-10')
    expect(line).not.toContain('by')
  })

  it('serialises start and due together as "from …, by …"', () => {
    const line = serializeTaskLine({ ...base, start: '2025-01-10', due: '2025-01-20' })
    expect(line).toContain('from 2025-01-10, by 2025-01-20')
  })

  it('serialises dependencies', () => {
    const line = serializeTaskLine({ ...base, dependencies: ['0', '1.1'] })
    expect(line).toContain('after:0,1.1')
  })

  it('serialises priority markers', () => {
    expect(serializeTaskLine({ ...base, priority: 'medium' })).toContain(' !')
    expect(serializeTaskLine({ ...base, priority: 'high' })).toContain(' !!')
    expect(serializeTaskLine({ ...base, priority: 'critical' })).toContain(' !!!')
    expect(serializeTaskLine({ ...base, priority: 'low' })).not.toContain('!')
  })

  it('indents subtasks correctly', () => {
    expect(serializeTaskLine(base, 0)).toMatch(/^- \[/)
    expect(serializeTaskLine(base, 1)).toMatch(/^  - \[/)
    expect(serializeTaskLine(base, 2)).toMatch(/^    - \[/)
  })
})

// ─── serializeTasksFile ───────────────────────────────────────────────────────

describe('serializeTasksFile', () => {
  it('serialises ungrouped tasks', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Alpha', description: '', type: 'task', status: 'todo', priority: 'low', start: '', due: '', progress: 0, tags: [], subtasks: [], dependencies: [], group: null, collapsed: false, createdAt: '', updatedAt: '' },
      { id: '2', title: 'Beta',  description: '', type: 'task', status: 'done', priority: 'low', start: '', due: '', progress: 100, tags: [], subtasks: [], dependencies: [], group: null, collapsed: false, createdAt: '', updatedAt: '' },
    ]
    const out = serializeTasksFile(tasks, [null])
    expect(out).toContain('- [ ] 1 - Alpha.')
    expect(out).toContain('- [x] 2 - Beta.')
  })

  it('serialises grouped tasks under headings', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Work task',     description: '', type: 'task', status: 'todo', priority: 'low', start: '', due: '', progress: 0, tags: [], subtasks: [], dependencies: [], group: 'Work',     collapsed: false, createdAt: '', updatedAt: '' },
      { id: '2', title: 'Personal task', description: '', type: 'task', status: 'todo', priority: 'low', start: '', due: '', progress: 0, tags: [], subtasks: [], dependencies: [], group: 'Personal', collapsed: false, createdAt: '', updatedAt: '' },
    ]
    const out = serializeTasksFile(tasks, ['Work', 'Personal'])
    expect(out).toContain('## Work')
    expect(out).toContain('## Personal')
    const workIdx = out.indexOf('## Work')
    const personalIdx = out.indexOf('## Personal')
    const task1Idx = out.indexOf('1 - Work task.')
    const task2Idx = out.indexOf('2 - Personal task.')
    expect(task1Idx).toBeGreaterThan(workIdx)
    expect(task2Idx).toBeGreaterThan(personalIdx)
  })

  it('preserves group order from groupOrder', () => {
    const tasks: Task[] = [
      { id: '1', title: 'B task', description: '', type: 'task', status: 'todo', priority: 'low', start: '', due: '', progress: 0, tags: [], subtasks: [], dependencies: [], group: 'Beta',  collapsed: false, createdAt: '', updatedAt: '' },
      { id: '2', title: 'A task', description: '', type: 'task', status: 'todo', priority: 'low', start: '', due: '', progress: 0, tags: [], subtasks: [], dependencies: [], group: 'Alpha', collapsed: false, createdAt: '', updatedAt: '' },
    ]
    const out = serializeTasksFile(tasks, ['Beta', 'Alpha'])
    expect(out.indexOf('## Beta')).toBeLessThan(out.indexOf('## Alpha'))
  })

  it('serialises description lines indented below the task', () => {
    const tasks: Task[] = [
      { id: '1', title: 'Fix bug', description: 'Line one.\nLine two.', type: 'task', status: 'todo', priority: 'low', start: '', due: '', progress: 0, tags: [], subtasks: [], dependencies: [], group: null, collapsed: false, createdAt: '', updatedAt: '' },
    ]
    const out = serializeTasksFile(tasks, [null])
    expect(out).toContain('- [ ] 1 - Fix bug.')
    expect(out).toContain('      Line one.')
    expect(out).toContain('      Line two.')
  })
})

// ─── Round-trip tests ─────────────────────────────────────────────────────────

describe('markdown round-trip', () => {
  function roundTrip(content: string): string {
    const { tasks, groups } = parseTasksFile(content)
    return serializeTasksFile(tasks, groups)
  }

  it('round-trips tasks in the new format (period + natural dates)', () => {
    const input = `- [ ] 1 - Todo task.\n- [x] 2 - Done task.\n- [-] 3 - Cancelled.\n`
    const output = roundTrip(input)
    expect(output).toContain('- [ ] 1 - Todo task.')
    expect(output).toContain('- [x] 2 - Done task.')
    expect(output).toContain('- [-] 3 - Cancelled.')
  })

  it('also parses tasks written without the dash (backward compat)', () => {
    const input = `- [ ] 1 Todo task\n- [x] 2 Done task\n`
    const output = roundTrip(input)
    expect(output).toContain('- [ ] 1 - Todo task.')
    expect(output).toContain('- [x] 2 - Done task.')
  })

  it('converts legacy "due:/start:" tokens to "by/from" on round-trip', () => {
    const input = `- [/] 1 - Fix bug. #auth due:2025-01-15 start:2025-01-10 after:0 !!\n`
    const output = roundTrip(input)
    expect(output).toContain('[/]')
    expect(output).toContain('1 - Fix bug.')
    expect(output).toContain('#auth')
    expect(output).toContain('from 2025-01-10, by 2025-01-15')
    expect(output).toContain('after:0')
    expect(output).toContain('!!')
    expect(output).not.toContain('due:')
    expect(output).not.toContain('start:')
  })

  it('round-trips "from … by …" dates', () => {
    const input = `- [ ] 1 - Task. from 2025-01-10, by 2025-01-20\n`
    const output = roundTrip(input)
    expect(output).toContain('from 2025-01-10, by 2025-01-20')
  })

  it('normalises M/D/YY dates to ISO on round-trip', () => {
    const input = `- [ ] 1 - Task. by 1/15/25\n`
    const output = roundTrip(input)
    expect(output).toContain('by 2025-01-15')
    expect(output).not.toContain('1/15/25')
  })

  it('preserves subtask nesting', () => {
    const input = `- [/] 1 - Parent.\n  - [ ] 1.1 - Child.\n  - [x] 1.2 - Done child.\n`
    const output = roundTrip(input)
    expect(output).toContain('- [/] 1 - Parent.')
    expect(output).toContain('  - [ ] 1.1 - Child.')
    expect(output).toContain('  - [x] 1.2 - Done child.')
  })

  it('preserves group headings', () => {
    const input = `## Work\n\n- [ ] 1 - Work task.\n\n## Personal\n\n- [ ] 2 - Personal task.\n`
    const output = roundTrip(input)
    expect(output).toContain('## Work')
    expect(output).toContain('## Personal')
    expect(output.indexOf('## Work')).toBeLessThan(output.indexOf('## Personal'))
  })

  it('round-trips description lines', () => {
    const input = `- [ ] 1 - Fix bug.\n      First line.\n      Second line.\n- [ ] 2 - Other task.\n`
    const output = roundTrip(input)
    expect(output).toContain('- [ ] 1 - Fix bug.')
    expect(output).toContain('      First line.')
    expect(output).toContain('      Second line.')
    expect(output).toContain('- [ ] 2 - Other task.')
  })

  it('handles empty file', () => {
    expect(roundTrip('')).toBe('')
  })
})
