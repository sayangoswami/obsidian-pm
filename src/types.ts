import { COLOR_ACCENT } from './constants'
import { today } from './dates'

export type TaskStatus = string
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
export type GanttGranularity = 'day' | 'week' | 'month' | 'quarter'
export type GanttWeekLabel = 'weekNumber' | 'dateRange' | 'both'
export type ViewMode = 'table' | 'gantt' | 'kanban'
export type DueDateFilter = 'any' | 'overdue' | 'this-week' | 'this-month' | 'no-date'
export type TaskType = 'task' | 'milestone' | 'subtask'

export interface Task {
  id: string
  title: string
  description: string
  type: TaskType
  status: TaskStatus
  priority: TaskPriority
  start: string // YYYY-MM-DD, empty string = unset
  due: string   // YYYY-MM-DD, empty string = unset
  progress: number // 0–100, computed from subtask completion on load
  tags: string[]
  subtasks: Task[]
  dependencies: string[] // task IDs (user-assigned, e.g. "1", "1.1")
  group: string | null   // section header (## Heading) in Tasks.md; null for subtasks
  collapsed: boolean     // runtime-only UI state, not persisted to Tasks.md
  createdAt: string
  updatedAt: string
}

export interface Project {
  id: string
  title: string
  description: string
  color: string // hex
  icon: string  // emoji
  tasks: Task[]
  createdAt: string
  updatedAt: string
  filePath: string // vault path to Tasks.md
  savedViews: SavedView[]
}

export interface FilterState {
  text: string
  statuses: TaskStatus[]
  priorities: TaskPriority[]
  tags: string[]
  dueDateFilter: DueDateFilter
  showArchived: boolean // show done/cancelled tasks
}

export interface SavedView {
  id: string
  name: string
  filter: FilterState
  sortKey: string
  sortDir: 'asc' | 'desc'
  viewMode?: ViewMode
}

export interface PerProjectFilter {
  filter: FilterState
  activeSavedViewId: string | null
}

export interface StatusConfig {
  id: string
  label: string
  color: string
  icon: string
  complete: boolean
}

export interface PriorityConfig {
  id: TaskPriority
  label: string
  color: string
  icon: string
}

export interface PMSettings {
  defaultView: ViewMode
  ganttGranularity: GanttGranularity
  ganttWeekLabel: GanttWeekLabel
  statuses: StatusConfig[]
  priorities: PriorityConfig[]
  notificationsEnabled: boolean
  notificationLeadDays: number
  autoSchedule: boolean
  kanbanShowSubtasks: boolean
  saveTaskOnClose: boolean
  projectFilters: Record<string, PerProjectFilter>
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_STATUSES: StatusConfig[] = [
  { id: 'todo',        label: 'To Do',       color: '#8a94a0', icon: '',  complete: false },
  { id: 'in-progress', label: 'In Progress',  color: '#8b72be', icon: '',  complete: false },
  { id: 'blocked',     label: 'Blocked',      color: '#c47070', icon: '',  complete: false },
  { id: 'review',      label: 'In Review',    color: '#b8a06b', icon: '',  complete: false },
  { id: 'done',        label: 'Done',         color: '#79b58d', icon: '',  complete: true  },
  { id: 'cancelled',   label: 'Cancelled',    color: '#767491', icon: '',  complete: true  },
]

export const DEFAULT_PRIORITIES: PriorityConfig[] = [
  { id: 'critical', label: 'Critical', color: '#c47070', icon: '' },
  { id: 'high',     label: 'High',     color: '#b8a06b', icon: '' },
  { id: 'medium',   label: 'Medium',   color: '#8a94a0', icon: '' },
  { id: 'low',      label: 'Low',      color: '#79b58d', icon: '' },
]

export const DEFAULT_SETTINGS: PMSettings = {
  defaultView: 'table',
  ganttGranularity: 'week',
  ganttWeekLabel: 'weekNumber',
  statuses: DEFAULT_STATUSES,
  priorities: DEFAULT_PRIORITIES,
  notificationsEnabled: true,
  notificationLeadDays: 2,
  autoSchedule: true,
  kanbanShowSubtasks: false,
  saveTaskOnClose: true,
  projectFilters: {},
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title: 'New Task',
    description: '',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    start: today().toString(),
    due: '',
    progress: 0,
    tags: [],
    subtasks: [],
    dependencies: [],
    group: null,
    collapsed: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeProject(title: string, filePath: string): Project {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title,
    description: '',
    color: COLOR_ACCENT,
    icon: '📋',
    tasks: [],
    createdAt: now,
    updatedAt: now,
    filePath,
    savedViews: [],
  }
}

export function makeDefaultFilter(): FilterState {
  return {
    text: '',
    statuses: [],
    priorities: [],
    tags: [],
    dueDateFilter: 'any',
    showArchived: false,
  }
}
