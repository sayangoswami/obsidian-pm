import type { Task } from '../../types'
import { formatDateShort } from '../../utils'
import { Badge } from '../primitives/Badge'
import { Chip } from '../primitives/Chip'
import { DueDateChip } from '../primitives/DueDateChip'
import { ProgressBar } from '../primitives/ProgressBar'

export interface KanbanCardProps {
  task: Task
  priorityColor?: string
  parentTitle?: string
  subtaskProgress?: { done: number; total: number }
  overdue: boolean
  onClick: () => void
  onContextMenu: (e: MouseEvent) => void
  onDragStart: () => void
  onDragEnd: () => void
}

export class KanbanCard {
  el: HTMLElement

  constructor(parentEl: HTMLElement, props: KanbanCardProps) {
    const { task } = props
    const card = parentEl.createDiv('pm-kanban-card')
    card.draggable = true
    card.dataset.taskId = task.id
    this.el = card

    if (props.priorityColor) {
      const priorityBar = card.createDiv('pm-kanban-card-priority-bar')
      priorityBar.setCssStyles({ background: props.priorityColor })
    }

    const body = card.createDiv('pm-kanban-card-body')

    if (props.parentTitle) {
      body.createSpan({ text: props.parentTitle, cls: 'pm-kanban-card-parent' })
    }

    const titleRow = body.createDiv('pm-kanban-card-title-row')
    titleRow.createSpan({ text: task.title, cls: 'pm-kanban-card-title' })
    if (task.type === 'milestone') {
      new Badge(titleRow).setLabel('M').setSize('sm').setColor('var(--color-purple)').setTooltip('Milestone')
    }
    if (task.type === 'subtask') {
      new Badge(titleRow).setLabel('Sub').setSize('sm').setColor('var(--color-green)').setTooltip('Subtask')
    }
    if (task.tags.length) {
      const tagsEl = body.createDiv('pm-kanban-card-tags')
      for (const tag of task.tags.slice(0, 3)) {
        new Chip(tagsEl).setLabel(tag).setShape('pill').setSize('sm')
      }
    }

    const footer = body.createDiv('pm-kanban-card-footer')
    if (task.due) {
      new DueDateChip(footer)
        .setVariant('label')
        .setLabel(formatDateShort(task.due))
        .setUrgency(props.overdue ? 'overdue' : 'normal')
    }

    if (task.progress > 0) {
      new ProgressBar(body).setSize('sm').setValue(task.progress)
    }

    if (props.subtaskProgress) {
      const { done, total } = props.subtaskProgress
      body.createSpan({
        text: `${done}/${total} subtasks`,
        cls: 'pm-kanban-card-subtasks'
      })
    }

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', task.id)
      card.addClass('pm-kanban-card--dragging')
      activeWindow.setTimeout(() => card.addClass('pm-dragging'), 0)
      props.onDragStart()
    })

    card.addEventListener('dragend', () => {
      card.removeClass('pm-kanban-card--dragging')
      card.removeClass('pm-dragging')
      props.onDragEnd()
    })

    card.addEventListener('click', () => props.onClick())
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      props.onContextMenu(e)
    })
  }
}
