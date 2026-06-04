import { ButtonComponent, ExtraButtonComponent, Menu } from 'obsidian'
import type { TaskStatus, TaskPriority } from '../../types'
import { findTask, flattenTasks, collectAllTags } from '../../store'
import { formatBadgeText } from '../../utils'
import { today } from '../../dates'
import { promptText } from '../../ui/ModalFactory'
import { TaskPickerModal } from '../../modals/PickerModals'
import type { TableContext } from './TableRenderer'
import { updateSelectAllCheckbox } from './TableRow'

export type BulkAction =
  | { type: 'set-status'; status: TaskStatus }
  | { type: 'set-priority'; priority: TaskPriority }
  | { type: 'set-tag'; tag: string }
  | { type: 'set-due-date'; due: string }
  | { type: 'set-progress'; progress: number }
  | { type: 'set-parent'; parentId: string }
  | { type: 'remove-parent' }
  | { type: 'delete' }

export interface BulkActionBarOpts {
  ctx: TableContext
  onAction: (action: BulkAction) => void
}

export function renderBulkActionBar(opts: BulkActionBarOpts): void {
  const { ctx, onAction } = opts
  const existing = ctx.container.querySelector('.pm-bulk-bar')

  if (ctx.state.selectedTaskIds.size === 0) {
    existing?.remove()
    return
  }

  const bar = existing ?? createBar(ctx.container)
  updateBarContent(bar as HTMLElement, ctx, onAction)
}

function createBar(container: HTMLElement): HTMLElement {
  const bar = createDiv({ cls: 'pm-bulk-bar' })
  container.prepend(bar)
  return bar
}

function updateBarContent(bar: HTMLElement, ctx: TableContext, onAction: (a: BulkAction) => void): void {
  bar.empty()
  const count = ctx.state.selectedTaskIds.size

  const left = bar.createDiv('pm-bulk-bar-left')
  left.createSpan({ text: `${count} selected`, cls: 'pm-bulk-bar-count' })

  new ButtonComponent(left).setButtonText('Set status').onClick((e) => {
    const menu = new Menu()
    for (const s of ctx.plugin.settings.statuses) {
      menu.addItem((item) =>
        item.setTitle(formatBadgeText(s.icon, s.label)).onClick(() => onAction({ type: 'set-status', status: s.id }))
      )
    }
    menu.showAtMouseEvent(e)
  })

  new ButtonComponent(left).setButtonText('Set priority').onClick((e) => {
    const menu = new Menu()
    for (const p of ctx.plugin.settings.priorities) {
      menu.addItem((item) =>
        item.setTitle(formatBadgeText(p.icon, p.label)).onClick(() => onAction({ type: 'set-priority', priority: p.id }))
      )
    }
    menu.showAtMouseEvent(e)
  })

  new ButtonComponent(left).setButtonText('Set tag').onClick((e) => {
    const menu = new Menu()
    const allTags = collectAllTags(ctx.project.tasks)
    for (const t of allTags) {
      menu.addItem((item) => item.setTitle(t).onClick(() => onAction({ type: 'set-tag', tag: t })))
    }
    menu.addSeparator()
    menu.addItem((item) =>
      item.setTitle('+ new tag...').onClick(async () => {
        const tag = await promptText(ctx.plugin.app, 'Enter tag:', 'Tag')
        if (tag) onAction({ type: 'set-tag', tag })
      })
    )
    menu.addSeparator()
    menu.addItem((item) => item.setTitle('Clear tags').onClick(() => onAction({ type: 'set-tag', tag: '' })))
    menu.showAtMouseEvent(e)
  })

  new ButtonComponent(left).setButtonText('Set due date').onClick((e) => {
    const menu = new Menu()
    const now = today()
    const ahead = (days: number) => now.add({ days }).toString()
    menu.addItem((item) =>
      item.setTitle(`Today (${ahead(0)})`).onClick(() => onAction({ type: 'set-due-date', due: ahead(0) }))
    )
    menu.addItem((item) =>
      item.setTitle(`Tomorrow (${ahead(1)})`).onClick(() => onAction({ type: 'set-due-date', due: ahead(1) }))
    )
    menu.addItem((item) =>
      item.setTitle(`In 1 week (${ahead(7)})`).onClick(() => onAction({ type: 'set-due-date', due: ahead(7) }))
    )
    menu.addSeparator()
    menu.addItem((item) =>
      item.setTitle('Pick date...').onClick(() => {
        const input = activeDocument.createEl('input')
        input.type = 'date'
        input.addClass('pm-offscreen')
        activeDocument.body.appendChild(input)
        input.addEventListener('change', () => {
          if (input.value) onAction({ type: 'set-due-date', due: input.value })
          input.remove()
        })
        input.addEventListener('blur', () => activeWindow.setTimeout(() => input.remove(), 200))
        input.showPicker()
      })
    )
    menu.addSeparator()
    menu.addItem((item) => item.setTitle('Clear due date').onClick(() => onAction({ type: 'set-due-date', due: '' })))
    menu.showAtMouseEvent(e)
  })

  new ButtonComponent(left).setButtonText('Set progress').onClick((e) => {
    const menu = new Menu()
    for (const pct of [0, 25, 50, 75, 100]) {
      menu.addItem((item) => item.setTitle(`${pct}%`).onClick(() => onAction({ type: 'set-progress', progress: pct })))
    }
    menu.showAtMouseEvent(e)
  })

  new ButtonComponent(left).setButtonText('Set parent').onClick(() => {
    const selectedIdSet = new Set(ctx.state.selectedTaskIds)
    const excludedIds = new Set<string>(selectedIdSet)
    for (const id of selectedIdSet) {
      const task = findTask(ctx.project.tasks, id)
      if (task) {
        for (const ft of flattenTasks(task.subtasks)) excludedIds.add(ft.task.id)
      }
    }
    const candidates = flattenTasks(ctx.project.tasks)
      .filter((ft) => !excludedIds.has(ft.task.id))
      .map((ft) => ft.task)
    new TaskPickerModal(ctx.plugin.app, candidates, (chosen) => {
      onAction({ type: 'set-parent', parentId: chosen.id })
    }).open()
  })

  new ButtonComponent(left).setButtonText('Remove parent').onClick(() => onAction({ type: 'remove-parent' }))

  new ButtonComponent(left).setButtonText('Delete').setWarning().onClick(() => onAction({ type: 'delete' }))

  const right = bar.createDiv('pm-bulk-bar-right')
  new ExtraButtonComponent(right)
    .setIcon('x')
    .setTooltip('Clear selection')
    .onClick(() => {
      ctx.state.selectedTaskIds.clear()
      if (ctx.state.tableBody) {
        ctx.state.tableBody.querySelectorAll('.pm-select-checkbox').forEach((cb) => {
          ;(cb as HTMLInputElement).checked = false
        })
      }
      updateSelectAllCheckbox(ctx.state)
      renderBulkActionBar({ ctx, onAction })
    })
}
