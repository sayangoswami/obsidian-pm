import { Plugin, Notice } from 'obsidian'
import { DEFAULT_SETTINGS, PMSettings, Project } from './types'
import { flattenTasks } from './store/TaskTreeOps'
import { ProjectStore } from './store'
import { PMSettingTab } from './settings'
import { ProjectView, PM_PROJECT_VIEW_TYPE } from './views/ProjectView'
import { DashboardView, PM_DASHBOARD_VIEW_TYPE } from './views/DashboardView'
import { PMViewRouter } from './views/PMViewRouter'
import { openProjectModal, openTaskModal, openProjectPicker, openTaskPicker } from './ui/ModalFactory'
import { Notifier } from './components/Notifier'
import { safeAsync } from './utils'

export default class PMPlugin extends Plugin {
  settings: PMSettings = { ...DEFAULT_SETTINGS }
  store!: ProjectStore
  notifier!: Notifier
  router!: PMViewRouter
  undoStack: Array<{ undo: () => Promise<void>; redo: () => Promise<void> }> = []
  redoStack: Array<{ undo: () => Promise<void>; redo: () => Promise<void> }> = []

  pushUndo(entry: { undo: () => Promise<void>; redo: () => Promise<void> }): void {
    this.undoStack.push(entry)
    if (this.undoStack.length > 20) this.undoStack.shift()
    this.redoStack = []
  }

  async undoLastAction(): Promise<void> {
    const entry = this.undoStack.pop()
    if (entry) {
      await entry.undo()
      this.redoStack.push(entry)
    }
  }

  async redoLastAction(): Promise<void> {
    const entry = this.redoStack.pop()
    if (entry) {
      await entry.redo()
      this.undoStack.push(entry)
    }
  }

  async onload(): Promise<void> {
    await this.loadSettings()
    this.store = new ProjectStore(this.app, () => this.settings.statuses)
    this.notifier = new Notifier(this)
    this.router = new PMViewRouter(this)

    this.registerView(PM_PROJECT_VIEW_TYPE, (leaf) => new ProjectView(leaf, this))
    this.registerView(PM_DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this))

    this.app.workspace.onLayoutReady(
      safeAsync(async () => {
        await this.cleanupStaleProjectFilters()
      })
    )

    this.addRibbonIcon('chart-gantt', 'Project manager', async () => {
      await this.router.openDashboard()
    })

    this.addCommand({
      id: 'open-projects',
      name: 'Open projects pane',
      callback: () => { void this.router.openDashboard() },
    })

    this.addCommand({
      id: 'new-project',
      name: 'Create new project',
      callback: () => {
        openProjectModal(this, {
          onSave: async (project) => {
            await this.router.openProjectByPath(project.filePath)
          },
        })
      },
    })

    this.addCommand({
      id: 'new-task',
      name: 'Create new task',
      callback: () => { void this.pickProjectThenCreateTask(null) },
    })

    this.addCommand({
      id: 'new-subtask',
      name: 'Create new subtask',
      callback: () => { void this.pickProjectThenCreateTask('pick-parent') },
    })

    this.addCommand({
      id: 'undo-last-action',
      name: 'Undo last action',
      callback: () => { void this.undoLastAction() },
    })

    this.addCommand({
      id: 'redo-last-action',
      name: 'Redo last action',
      callback: () => { void this.redoLastAction() },
    })

    this.addSettingTab(new PMSettingTab(this.app, this))
    this.notifier.start()
  }

  onunload(): void {
    this.notifier.stop()
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<PMSettings> | null
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {})
    if (!saved?.statuses?.length) this.settings.statuses = DEFAULT_SETTINGS.statuses
    if (!saved?.priorities?.length) this.settings.priorities = DEFAULT_SETTINGS.priorities
    if (!this.settings.projectFilters) this.settings.projectFilters = {}

    // Ensure status configs have the complete field
    let migrated = false
    for (const s of this.settings.statuses) {
      if (s.complete === undefined) {
        s.complete = s.id === 'done' || s.id === 'cancelled'
        migrated = true
      }
    }
    if (migrated) await this.saveSettings()
  }

  async cleanupStaleProjectFilters(): Promise<void> {
    const filters = this.settings.projectFilters
    const cleaned: typeof filters = {}
    let dirty = false
    for (const [path, entry] of Object.entries(filters)) {
      if (this.app.vault.getAbstractFileByPath(path)) {
        cleaned[path] = entry
      } else {
        dirty = true
      }
    }
    if (dirty) {
      this.settings.projectFilters = cleaned
      await this.saveSettings()
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings)
  }

  showNotice(msg: string, duration = 3000): void {
    new Notice(msg, duration)
  }

  private async pickProjectThenCreateTask(mode: null | 'pick-parent'): Promise<void> {
    const projects = await this.store.loadAllProjects()
    if (!projects.length) {
      this.showNotice('No projects yet. Create a project first.')
      return
    }
    openProjectPicker(this, projects, (project) => {
      if (mode === 'pick-parent') {
        const flat = flattenTasks(project.tasks)
        if (!flat.length) {
          this.showNotice('No tasks in this project. Create a task first.')
          return
        }
        openTaskPicker(
          this,
          flat.map((f) => f.task),
          (parentTask) => { this.openTaskModalForProject(project, parentTask.id) }
        )
      } else {
        this.openTaskModalForProject(project, null)
      }
    })
  }

  private openTaskModalForProject(project: Project, parentId: string | null): void {
    openTaskModal(this, project, {
      parentId,
      onSave: async () => {
        await this.store.saveProject(project)
        await this.router.openProjectByPath(project.filePath)
      },
    })
  }
}
