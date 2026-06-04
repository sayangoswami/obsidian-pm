import type PMPlugin from '../../main'
import type { Project, FilterState } from '../../types'
import { type FlatTask, flattenTasks, findTask } from '../../store/TaskTreeOps'
import { applyTaskFilterFlat, isFilterActive } from '../../store/TaskFilter'
import { openTaskModal } from '../../ui/ModalFactory'
import { compareTask } from './TableFilters'
import { renderTaskRow, updateSelectedRow, updateSelectAllCheckbox } from './TableRow'

// Columns: select-all | expand | title | status | priority | due | progress | actions = 8
const TOTAL_COLS = 8

export type SortKey = 'title' | 'status' | 'priority' | 'due' | 'progress'
export type SortDir = 'asc' | 'desc'

export interface TableState {
  sortKey: SortKey
  sortDir: SortDir
  filter: FilterState
  selectedTaskId: string | null
  selectedTaskIds: Set<string>
  lastCheckedTaskId: string | null
  tableBody: HTMLElement | null
}

export interface TableContext {
  container: HTMLElement
  project: Project
  plugin: PMPlugin
  state: TableState
  onRefresh: () => Promise<void>
  onSelectionChange: () => void
  onBulkDelete: () => void
}

export function renderTable(ctx: TableContext): void {
  const wrapper = ctx.container.createDiv('pm-table-wrapper')
  const table = wrapper.createEl('table', { cls: 'pm-table' })

  // ── Header ──────────────────────────────────────────────────────────────────
  const thead = table.createEl('thead')
  const hrow = thead.createEl('tr')

  const selectAllTh = hrow.createEl('th', { cls: 'pm-table-cell-select' })
  const selectAllCb = selectAllTh.createEl('input', { type: 'checkbox', cls: 'pm-select-all-checkbox' })
  selectAllCb.addEventListener('change', () => {
    const ids = getVisibleTaskIds(ctx.state)
    if (selectAllCb.checked) {
      for (const id of ids) ctx.state.selectedTaskIds.add(id)
    } else {
      ctx.state.selectedTaskIds.clear()
    }
    updateSelectCheckboxes(ctx.state)
    ctx.onSelectionChange()
  })

  const cols: { key: SortKey | null; label: string; width?: string }[] = [
    { key: null,       label: '',         width: '32px'  },
    { key: 'title',    label: 'Task',     width: 'auto'  },
    { key: 'status',   label: 'Status',   width: '130px' },
    { key: 'priority', label: 'Priority', width: '110px' },
    { key: 'due',      label: 'Due',      width: '110px' },
    { key: 'progress', label: 'Progress', width: '120px' },
  ]

  for (const col of cols) {
    const th = hrow.createEl('th')
    if (col.width) th.setCssStyles({ width: col.width })
    if (col.key) {
      th.addClass('pm-table-th-sortable')
      th.setAttribute('role', 'button')
      th.setAttribute('aria-label', `Sort by ${col.label}`)
      th.createSpan({ text: col.label })
      if (ctx.state.sortKey === col.key) {
        th.createSpan({
          text: ctx.state.sortDir === 'asc' ? ' ↑' : ' ↓',
          cls: 'pm-sort-indicator',
        })
      }
      th.addEventListener('click', () => {
        if (ctx.state.sortKey === col.key) {
          ctx.state.sortDir = ctx.state.sortDir === 'asc' ? 'desc' : 'asc'
        } else {
          ctx.state.sortKey = col.key as SortKey
          ctx.state.sortDir = 'asc'
        }
        refreshTableBody(ctx)
      })
    } else {
      th.setText(col.label)
    }
  }

  const actionsTh = hrow.createEl('th')
  actionsTh.setCssStyles({ width: '40px' })

  ctx.state.tableBody = table.createEl('tbody')
  fillTableBody(ctx)
}

export function refreshTableBody(ctx: TableContext): void {
  if (ctx.state.tableBody) fillTableBody(ctx)
}

function fillTableBody(ctx: TableContext): void {
  const tbody = ctx.state.tableBody
  if (!tbody) return
  tbody.empty()

  let flat = flattenTasks(ctx.project.tasks)
  const hasActiveFilter = isFilterActive(ctx.state.filter)
  flat = applyTaskFilterFlat(flat, ctx.state.filter, ctx.plugin.settings.statuses)
  const filteredIds = new Set(flat.map((f) => f.task.id))

  // Derive group order from top-level tasks in document order
  const groupOrder: Array<string | null> = []
  const seenGroups = new Set<string | null>()
  for (const task of ctx.project.tasks) {
    const g = task.group ?? null
    if (!seenGroups.has(g)) { seenGroups.add(g); groupOrder.push(g) }
  }
  const hasGroups = groupOrder.some((g) => g !== null)

  // Recursive helper: sort and collect a task's subtasks into `out`
  const addChildren = (out: FlatTask[], parentId: string) => {
    const children = flat.filter((f) => f.parentId === parentId)
    children.sort((a, b) => compareTask(a.task, b.task, ctx.state, ctx.plugin.settings.statuses))
    for (const item of children) {
      out.push(item)
      addChildren(out, item.task.id)
    }
  }

  const renderRows = (items: FlatTask[]) => {
    for (const { task, depth, parentId, visible } of items) {
      if (!hasActiveFilter && !visible) continue
      renderTaskRow(tbody, task, depth, hasActiveFilter ? null : parentId, ctx)
    }
  }

  if (hasGroups) {
    // Render per group with divider rows; sort within each group independently
    for (const group of groupOrder) {
      const topItems = flat.filter((f) => f.parentId === null && (f.task.group ?? null) === group)
      // Also promote orphaned filtered items into the right group
      const promoted = flat.filter(
        (f) => f.parentId !== null && !filteredIds.has(f.parentId) && (f.task.group ?? null) === group
      )
      const allItems = [...topItems, ...promoted]
      if (allItems.length === 0) continue

      if (group !== null) renderGroupDivider(tbody, group)

      allItems.sort((a, b) => compareTask(a.task, b.task, ctx.state, ctx.plugin.settings.statuses))
      const groupRows: FlatTask[] = []
      for (const item of allItems) {
        groupRows.push(item)
        addChildren(groupRows, item.task.id)
      }
      renderRows(groupRows)
    }
  } else {
    // No named groups: flat sort
    const topItems = flat.filter(
      (f) =>
        f.parentId === null ||
        (hasActiveFilter && f.parentId !== null && !filteredIds.has(f.parentId))
    )
    topItems.sort((a, b) => compareTask(a.task, b.task, ctx.state, ctx.plugin.settings.statuses))
    const allRows: FlatTask[] = []
    for (const item of topItems) {
      allRows.push(item)
      addChildren(allRows, item.task.id)
    }
    renderRows(allRows)
  }

  // "Add task" row
  const addRow = tbody.createEl('tr', { cls: 'pm-table-add-row' })
  const addCell = addRow.createEl('td', { attr: { colspan: String(TOTAL_COLS) } })
  const addBtn = addCell.createEl('button', { text: '+ add task', cls: 'pm-table-add-btn' })
  addBtn.addEventListener('click', () => {
    openTaskModal(ctx.plugin, ctx.project, { onSave: () => ctx.onRefresh() })
  })
}

function renderGroupDivider(tbody: HTMLElement, group: string): void {
  const tr = tbody.createEl('tr', { cls: 'pm-table-group-divider' })
  const td = tr.createEl('td', { attr: { colspan: String(TOTAL_COLS) } })
  td.createSpan({ text: group, cls: 'pm-table-group-label' })
}

export function updateSelectCheckboxes(state: TableState): void {
  if (!state.tableBody) return
  const rows = state.tableBody.querySelectorAll('tr[data-task-id]')
  for (const row of Array.from(rows)) {
    const id = (row as HTMLElement).dataset.taskId!
    const cb = row.querySelector('.pm-select-checkbox')
    if (cb) (cb as HTMLInputElement).checked = state.selectedTaskIds.has(id)
  }
  updateSelectAllCheckbox(state)
}

// ─── Keyboard handling ──────────────────────────────────────────────────────

export function handleTableKeyDown(e: KeyboardEvent, ctx: TableContext): void {
  const active = activeDocument.activeElement
  const isInput =
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.contentEditable === 'true')

  if (e.key === 'Escape') {
    if (isInput) { active.blur(); return }
    if (ctx.state.selectedTaskIds.size > 0) {
      ctx.state.selectedTaskIds.clear()
      updateSelectCheckboxes(ctx.state)
      ctx.onSelectionChange()
      return
    }
    ctx.state.selectedTaskId = null
    updateSelectedRow(ctx.state)
    return
  }

  if (isInput) return

  const rows = getVisibleTaskIds(ctx.state)
  if (!rows.length) return

  switch (e.key) {
    case 'ArrowDown':
    case 'j': {
      e.preventDefault()
      const idx = ctx.state.selectedTaskId ? rows.indexOf(ctx.state.selectedTaskId) : -1
      ctx.state.selectedTaskId = rows[Math.min(idx + 1, rows.length - 1)]
      updateSelectedRow(ctx.state)
      break
    }
    case 'ArrowUp':
    case 'k': {
      e.preventDefault()
      const idx = ctx.state.selectedTaskId ? rows.indexOf(ctx.state.selectedTaskId) : rows.length
      ctx.state.selectedTaskId = rows[Math.max(idx - 1, 0)]
      updateSelectedRow(ctx.state)
      break
    }
    case 'Enter':
    case 'e': {
      if (!ctx.state.selectedTaskId) return
      e.preventDefault()
      const task = findTask(ctx.project.tasks, ctx.state.selectedTaskId)
      if (task) openTaskModal(ctx.plugin, ctx.project, { task, onSave: async () => { await ctx.onRefresh() } })
      break
    }
    case 'Delete':
    case 'Backspace': {
      e.preventDefault()
      if (ctx.state.selectedTaskIds.size > 0) { ctx.onBulkDelete(); break }
      if (!ctx.state.selectedTaskId) return
      const id = ctx.state.selectedTaskId
      const currentIdx = rows.indexOf(id)
      const nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : currentIdx - 1
      ctx.state.selectedTaskId = nextIdx >= 0 ? rows[nextIdx] : null
      void deleteTask(id, ctx)
      break
    }
  }
}

export function getVisibleTaskIds(state: TableState): string[] {
  if (!state.tableBody) return []
  return Array.from(state.tableBody.querySelectorAll('tr[data-task-id]')).map(
    (r) => (r as HTMLElement).dataset.taskId!
  )
}

async function deleteTask(id: string, ctx: TableContext): Promise<void> {
  await ctx.plugin.store.deleteTask(ctx.project, id)
  await ctx.onRefresh()
}
