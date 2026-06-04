import { describe, expect, it } from 'vitest'
import {
  addTaskToTree,
  collectAllTags,
  deleteTaskFromTree,
  findTask,
  flattenTasks,
  moveTaskInTree,
  updateTaskInTree
} from './TaskTreeOps'
import { makeTask, type Task } from '../types'

function task(overrides: Partial<Task> & { id: string }): Task {
  return makeTask(overrides)
}

describe('flattenTasks', () => {
  it('flattens a single-level list with depth 0', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const flat = flattenTasks(tasks)
    expect(flat).toHaveLength(2)
    expect(flat[0]).toMatchObject({ depth: 0, parentId: null, visible: true })
    expect(flat[1]).toMatchObject({ depth: 0, parentId: null, visible: true })
  })

  it('assigns depth and parentId to subtasks', () => {
    const tasks = [task({ id: 'a', subtasks: [task({ id: 'a1' })] })]
    const flat = flattenTasks(tasks)
    expect(flat[1]).toMatchObject({ depth: 1, parentId: 'a', visible: true })
  })

  it('marks descendants of a collapsed parent as invisible', () => {
    const tasks = [task({ id: 'a', collapsed: true, subtasks: [task({ id: 'a1' })] })]
    const flat = flattenTasks(tasks)
    expect(flat[0].visible).toBe(true)
    expect(flat[1].visible).toBe(false)
  })

  it('propagates invisibility through multiple levels', () => {
    const grandchild = task({ id: 'a1x' })
    const child = task({ id: 'a1', subtasks: [grandchild] })
    const root = task({ id: 'a', collapsed: true, subtasks: [child] })
    const flat = flattenTasks([root])
    expect(flat.find((f) => f.task.id === 'a1x')?.visible).toBe(false)
  })
})

describe('findTask', () => {
  it('finds a top-level task', () => {
    const target = task({ id: 'b' })
    expect(findTask([task({ id: 'a' }), target], 'b')).toBe(target)
  })

  it('finds a nested task', () => {
    const target = task({ id: 'deep' })
    const tasks = [task({ id: 'a', subtasks: [task({ id: 'a1', subtasks: [target] })] })]
    expect(findTask(tasks, 'deep')).toBe(target)
  })

  it('returns null when the id is not found', () => {
    expect(findTask([task({ id: 'a' })], 'missing')).toBeNull()
  })
})

describe('updateTaskInTree', () => {
  it('updates a top-level task and bumps updatedAt', () => {
    const t = task({ id: 'a', title: 'Old', updatedAt: '2020-01-01T00:00:00.000Z' })
    const tasks = [t]
    expect(updateTaskInTree(tasks, 'a', { title: 'New' })).toBe(true)
    expect(t.title).toBe('New')
    expect(t.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('updates a nested task', () => {
    const child = task({ id: 'c', title: 'Old' })
    const tasks = [task({ id: 'a', subtasks: [child] })]
    expect(updateTaskInTree(tasks, 'c', { title: 'New' })).toBe(true)
    expect(child.title).toBe('New')
  })

  it('returns false when the id is not found', () => {
    expect(updateTaskInTree([task({ id: 'a' })], 'missing', { title: 'x' })).toBe(false)
  })
})

describe('deleteTaskFromTree', () => {
  it('removes a top-level task', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    expect(deleteTaskFromTree(tasks, 'a')).toBe(true)
    expect(tasks.map((t) => t.id)).toEqual(['b'])
  })

  it('removes a nested task', () => {
    const tasks = [task({ id: 'a', subtasks: [task({ id: 'a1' }), task({ id: 'a2' })] })]
    expect(deleteTaskFromTree(tasks, 'a1')).toBe(true)
    expect(tasks[0].subtasks.map((t) => t.id)).toEqual(['a2'])
  })

  it('returns false when the id is not found', () => {
    expect(deleteTaskFromTree([task({ id: 'a' })], 'missing')).toBe(false)
  })
})

describe('addTaskToTree', () => {
  it('appends at top level when parentId is null', () => {
    const tasks = [task({ id: 'a' })]
    addTaskToTree(tasks, task({ id: 'b' }), null)
    expect(tasks.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('appends under the named parent', () => {
    const tasks = [task({ id: 'a', subtasks: [] })]
    addTaskToTree(tasks, task({ id: 'a1' }), 'a')
    expect(tasks[0].subtasks.map((t) => t.id)).toEqual(['a1'])
  })

  it('falls back to top-level when the parent id is unknown', () => {
    const tasks = [task({ id: 'a' })]
    addTaskToTree(tasks, task({ id: 'orphan' }), 'missing')
    expect(tasks.map((t) => t.id)).toEqual(['a', 'orphan'])
  })
})

describe('moveTaskInTree', () => {
  it('moves a task before a sibling', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })]
    expect(moveTaskInTree(tasks, 'c', 'a', 'before')).toBe(true)
    expect(tasks.map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })

  it('moves a task after a sibling', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })]
    expect(moveTaskInTree(tasks, 'a', 'c', 'after')).toBe(true)
    expect(tasks.map((t) => t.id)).toEqual(['b', 'c', 'a'])
  })

  it('recurses into subtask lists', () => {
    const tasks = [task({ id: 'p', subtasks: [task({ id: 'x' }), task({ id: 'y' })] })]
    expect(moveTaskInTree(tasks, 'y', 'x', 'before')).toBe(true)
    expect(tasks[0].subtasks.map((t) => t.id)).toEqual(['y', 'x'])
  })

  it('returns false when source and target are not siblings', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'p', subtasks: [task({ id: 'x' })] })]
    expect(moveTaskInTree(tasks, 'a', 'x', 'before')).toBe(false)
  })
})

describe('collectAllTags', () => {
  it('returns a sorted, deduplicated list', () => {
    const tasks = [
      task({ id: 'a', tags: ['foo', 'bar'] }),
      task({ id: 'b', subtasks: [task({ id: 'b1', tags: ['bar', 'baz'] })] })
    ]
    expect(collectAllTags(tasks)).toEqual(['bar', 'baz', 'foo'])
  })
})

