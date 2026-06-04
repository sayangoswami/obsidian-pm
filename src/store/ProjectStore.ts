import { App, Notice, TFile, normalizePath } from 'obsidian'
import { parse as parseYaml, stringify as yamlStringify } from 'yaml'
import type { Project, Task, StatusConfig, SavedView } from '../types'
import { COLOR_ACCENT } from '../constants'
import { parseTasksFile } from './MarkdownParser'
import { serializeTasksFile } from './MarkdownSerializer'
import { computeSchedule } from './Scheduler'
import {
  updateTaskInTree,
  deleteTaskFromTree,
  addTaskToTree,
  findTask,
  flattenTasks,
  moveTaskInTree,
  cloneTaskSubtree,
} from './TaskTreeOps'

export const TASKS_FILE_NAME = 'Tasks.md'

const NUMERIC_ID_RE = /^\d+(\.\d+)*$/

// ─── Frontmatter helpers ──────────────────────────────────────────────────────

interface ProjectFrontmatter {
  icon?: string
  color?: string
  description?: string
  createdAt?: string
  savedViews?: SavedView[]
}

function splitFrontmatter(content: string): { fm: ProjectFrontmatter; body: string } {
  if (!content.startsWith('---\n')) return { fm: {}, body: content }
  const end = content.indexOf('\n---\n', 4)
  if (end === -1) return { fm: {}, body: content }
  try {
    const fm = parseYaml(content.slice(4, end)) as ProjectFrontmatter
    return { fm: fm ?? {}, body: content.slice(end + 5) }
  } catch {
    return { fm: {}, body: content }
  }
}

function buildFrontmatter(fm: ProjectFrontmatter): string {
  const data: Record<string, unknown> = {}
  if (fm.icon)              data['icon'] = fm.icon
  if (fm.color)             data['color'] = fm.color
  if (fm.description)       data['description'] = fm.description
  if (fm.createdAt)         data['createdAt'] = fm.createdAt
  if (fm.savedViews?.length) data['savedViews'] = fm.savedViews
  if (Object.keys(data).length === 0) return ''
  return `---\n${yamlStringify(data)}---\n\n`
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

/** Next available top-level integer ID as a string ("1", "2", …) */
function nextTopLevelId(tasks: Task[]): string {
  const used = new Set(tasks.map((t) => t.id))
  let n = tasks.length + 1
  while (used.has(String(n))) n++
  return String(n)
}

/** Next available subtask ID under a parent, e.g. "1.3", "2.1.4" */
function nextSubtaskId(parentId: string, siblings: Task[]): string {
  const used = new Set(siblings.map((t) => t.id))
  let n = siblings.length + 1
  let candidate = `${parentId}.${n}`
  while (used.has(candidate)) {
    n++
    candidate = `${parentId}.${n}`
  }
  return candidate
}

function makeNewTask(id: string, parentGroup: string | null = null): Task {
  const now = new Date().toISOString()
  return {
    id,
    title: id.includes('.') ? 'New Subtask' : 'New Task',
    description: '',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    start: '',
    due: '',
    progress: 0,
    tags: [],
    subtasks: [],
    dependencies: [],
    group: parentGroup,
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Handles all read/write operations against the Obsidian vault.
 *
 * Storage layout:
 *   <Any folder>/Tasks.md  — project identified by parent folder name
 *
 * Project metadata (icon, color, description, savedViews) lives in Tasks.md
 * YAML frontmatter. The task list is the file body as markdown checkboxes.
 * Group order is cached on load so the serializer can reconstruct headings.
 */
export class ProjectStore {
  private saveQueues = new Map<string, Promise<void>>()
  private groupOrderCache = new Map<string, Array<string | null>>()

  constructor(
    private app: App,
    private getStatuses: () => StatusConfig[] = () => []
  ) {}

  // ─── Load ──────────────────────────────────────────────────────────────────

  async loadAllProjects(): Promise<Project[]> {
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.name === TASKS_FILE_NAME)
    const projects: Project[] = []
    for (const file of files) {
      const project = await this.loadProject(file)
      if (project) projects.push(project)
    }
    return projects.sort((a, b) => a.title.localeCompare(b.title))
  }

  async loadProject(file: TFile): Promise<Project | null> {
    try {
      const content = await this.app.vault.read(file)
      const { fm, body } = splitFrontmatter(content)
      const { tasks, groups } = parseTasksFile(body)

      this.groupOrderCache.set(file.path, groups)

      const title = file.parent?.name ?? file.basename
      return {
        id: file.path,
        title,
        description: fm.description ?? '',
        color: fm.color ?? COLOR_ACCENT,
        icon: fm.icon ?? '📋',
        tasks,
        createdAt: fm.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        filePath: file.path,
        savedViews: fm.savedViews ?? [],
      }
    } catch (e) {
      console.error(`[PM] Failed to load project ${file.path}:`, e)
      new Notice(`Project Manager: Failed to load "${file.parent?.name ?? file.name}". Check console for details.`)
      return null
    }
  }

  // ─── Save ──────────────────────────────────────────────────────────────────

  async saveProject(project: Project): Promise<void> {
    const key = project.filePath
    const prev = this.saveQueues.get(key) ?? Promise.resolve()
    const next = prev.then(() => this.doSaveProject(project))
    this.saveQueues.set(key, next.catch(() => {}))
    return next
  }

  /** Replace any non-numeric task ID with the next available sequential ID. */
  private normalizeIds(tasks: Task[], parentId: string | null): void {
    for (const task of tasks) {
      if (!NUMERIC_ID_RE.test(task.id)) {
        const siblings = tasks.filter((t) => t !== task)
        task.id = parentId !== null
          ? nextSubtaskId(parentId, siblings)
          : nextTopLevelId(siblings)
      }
      if (task.subtasks.length > 0) this.normalizeIds(task.subtasks, task.id)
    }
  }

  private async doSaveProject(project: Project): Promise<void> {
    try {
      project.updatedAt = new Date().toISOString()

      // Ensure every task has a valid numeric ID before serializing.
      // Tasks created via makeTask() (e.g. SubtasksPanel) get random hash
      // IDs that are invisible to the user and unusable in `after:` refs.
      this.normalizeIds(project.tasks, null)

      const groups = this.groupOrderCache.get(project.filePath) ?? []
      const taskContent = serializeTasksFile(project.tasks, groups)

      const fmString = buildFrontmatter({
        icon: project.icon,
        color: project.color,
        description: project.description || undefined,
        createdAt: project.createdAt,
        savedViews: project.savedViews.length ? project.savedViews : undefined,
      })

      const content = fmString + taskContent

      const file = this.app.vault.getAbstractFileByPath(project.filePath)
      if (file instanceof TFile) {
        await this.app.vault.modify(file, content)
      } else {
        await this.app.vault.create(project.filePath, content)
      }
    } catch (e) {
      console.error(`[PM] Failed to save project "${project.title}":`, e)
      new Notice(`Project Manager: Failed to save "${project.title}". Check console for details.`)
      throw e
    }
  }

  // ─── CRUD shortcuts ────────────────────────────────────────────────────────

  async createProject(title: string, parentFolder: string): Promise<Project> {
    const safeName = title.replace(/[\\/:*?"<>|]/g, '-')
    const projectFolder = parentFolder
      ? normalizePath(`${parentFolder}/${safeName}`)
      : safeName
    const filePath = normalizePath(`${projectFolder}/${TASKS_FILE_NAME}`)

    if (!this.app.vault.getAbstractFileByPath(projectFolder)) {
      await this.app.vault.createFolder(projectFolder)
    }

    const project: Project = {
      id: filePath,
      title,
      description: '',
      color: COLOR_ACCENT,
      icon: '📋',
      tasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      filePath,
      savedViews: [],
    }

    this.groupOrderCache.set(filePath, [])
    await this.saveProject(project)
    return project
  }

  async addTask(project: Project, parentId: string | null = null): Promise<Task> {
    let task: Task
    if (parentId !== null) {
      const parent = findTask(project.tasks, parentId)
      const id = nextSubtaskId(parentId, parent?.subtasks ?? [])
      task = makeNewTask(id, null) // subtasks have no group
    } else {
      const id = nextTopLevelId(project.tasks)
      // Inherit group of the last top-level task, or null
      const lastGroup = project.tasks.at(-1)?.group ?? null
      task = makeNewTask(id, lastGroup)
    }
    addTaskToTree(project.tasks, task, parentId)
    await this.saveProject(project)
    return task
  }

  async insertTask(project: Project, task: Task, parentId: string | null = null): Promise<void> {
    // Assign a clean numeric ID if the task has a random-generated one
    if (!NUMERIC_ID_RE.test(task.id)) {
      if (parentId !== null) {
        const parent = findTask(project.tasks, parentId)
        task.id = nextSubtaskId(parentId, parent?.subtasks ?? [])
      } else {
        task.id = nextTopLevelId(project.tasks)
        task.group = project.tasks.at(-1)?.group ?? null
      }
    }
    addTaskToTree(project.tasks, task, parentId)
    await this.saveProject(project)
  }

  async duplicateTask(project: Project, sourceId: string, includeSubtasks: boolean): Promise<Task | null> {
    const source = findTask(project.tasks, sourceId)
    if (!source) return null
    const copy = cloneTaskSubtree(source, includeSubtasks)
    copy.title = `${source.title} (copy)`
    copy.id = nextTopLevelId(project.tasks)
    const parentId = flattenTasks(project.tasks).find((f) => f.task.id === sourceId)?.parentId ?? null
    addTaskToTree(project.tasks, copy, parentId)
    moveTaskInTree(project.tasks, copy.id, sourceId, 'after')
    await this.saveProject(project)
    return copy
  }

  async moveTask(project: Project, taskId: string, newParentId: string | null): Promise<void> {
    const task = findTask(project.tasks, taskId)
    if (!task) return
    deleteTaskFromTree(project.tasks, taskId)
    addTaskToTree(project.tasks, task, newParentId)
    await this.saveProject(project)
  }

  async moveTasks(project: Project, taskIds: string[], newParentId: string | null): Promise<void> {
    for (const id of taskIds) {
      const task = findTask(project.tasks, id)
      if (!task) continue
      deleteTaskFromTree(project.tasks, id)
      addTaskToTree(project.tasks, task, newParentId)
    }
    await this.saveProject(project)
  }

  async updateTask(project: Project, taskId: string, patch: Partial<Task>): Promise<void> {
    updateTaskInTree(project.tasks, taskId, patch)
    // collapsed is runtime-only — don't write to disk for this alone
    if (Object.keys(patch).every((k) => k === 'collapsed')) return
    await this.saveProject(project)
  }

  async updateTasks(project: Project, taskIds: string[], patch: Partial<Task>): Promise<void> {
    for (const id of taskIds) updateTaskInTree(project.tasks, id, patch)
    await this.saveProject(project)
  }

  async deleteTask(project: Project, taskId: string): Promise<void> {
    deleteTaskFromTree(project.tasks, taskId)
    await this.saveProject(project)
  }

  async deleteTasks(project: Project, taskIds: string[]): Promise<void> {
    for (const id of taskIds) deleteTaskFromTree(project.tasks, id)
    await this.saveProject(project)
  }

  async deleteProject(project: Project): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(project.filePath)
    if (file instanceof TFile) await this.app.fileManager.trashFile(file)
  }

  // ─── Scheduling ──────────────────────────────────────────────────────────

  async scheduleAfterChange(project: Project, changedTaskId?: string, statuses: StatusConfig[] = []): Promise<number> {
    const { patches } = computeSchedule(project.tasks, changedTaskId, statuses)
    if (patches.length === 0) return 0
    for (const p of patches) {
      updateTaskInTree(project.tasks, p.taskId, { start: p.start, due: p.due })
    }
    await this.saveProject(project)
    return patches.length
  }
}
