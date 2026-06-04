import { App, ButtonComponent, Modal } from 'obsidian'
import type PMPlugin from '../main'
import { Project, makeProject } from '../types'
import { safeAsync } from '../utils'
import { COLOR_DANGER } from '../constants'

const PROJECT_COLORS = [
  '#8b72be',
  '#7c6b9a',
  '#b07d9e',
  COLOR_DANGER,
  '#b8a06b',
  '#79b58d',
  '#6ba8a0',
  '#7a9ec4',
  '#767491',
  '#8aab6b',
]

const PROJECT_ICONS = ['📋', '🚀', '💡', '🎯', '🔬', '🏗', '📊', '🎨', '📱', '🛠', '📝', '⚡']

export class ProjectModal extends Modal {
  private project: Project
  private isNew: boolean
  private parentFolder = ''

  constructor(
    app: App,
    private plugin: PMPlugin,
    existingProject: Project | null,
    private onSave: (project: Project) => void | Promise<void>
  ) {
    super(app)
    if (existingProject) {
      this.project = JSON.parse(JSON.stringify(existingProject)) as Project
      this.isNew = false
    } else {
      this.project = makeProject('New Project', '')
      this.isNew = true
    }
  }

  onOpen(): void {
    this.modalEl.addClass('pm-modal', 'pm-modal--project')
    const el = this.contentEl
    el.empty()
    el.addClass('pm-project-modal')
    this.buildForm(el)
  }

  onClose(): void {
    this.contentEl.empty()
  }

  private buildForm(el: HTMLElement): void {
    // ── Header ────────────────────────────────────────────────────────────────
    const header = el.createDiv('pm-project-modal-header')
    header.createSpan({ text: '✦', cls: 'pm-project-modal-header-icon' })
    header.createEl('h2', {
      text: this.isNew ? 'New project' : 'Project settings',
      cls: 'pm-modal-heading',
    })

    // ── Icon + Title ──────────────────────────────────────────────────────────
    const topRow = el.createDiv('pm-project-top-row')

    // Icon picker
    const iconWrap = topRow.createDiv('pm-icon-picker')
    const iconBtn = iconWrap.createEl('button', { text: this.project.icon, cls: 'pm-icon-picker-btn' })
    const iconGrid = iconWrap.createDiv('pm-icon-grid')
    iconGrid.addClass('pm-hidden')
    for (const emoji of PROJECT_ICONS) {
      const btn = iconGrid.createEl('button', { text: emoji, cls: 'pm-icon-option' })
      btn.addEventListener('click', () => {
        this.project.icon = emoji
        iconBtn.textContent = emoji
        iconGrid.addClass('pm-hidden')
      })
    }
    iconBtn.addEventListener('click', () => {
      iconGrid.toggleClass('pm-hidden', !iconGrid.hasClass('pm-hidden'))
    })

    // Title
    const titleWrap = topRow.createDiv('pm-project-title-wrap')
    titleWrap.createEl('label', { text: 'Project name', cls: 'pm-label' })
    const titleInput = titleWrap.createEl('input', {
      type: 'text',
      value: this.project.title,
      cls: 'pm-input pm-input--lg',
    })
    titleInput.placeholder = 'My project'
    titleInput.addEventListener('input', () => { this.project.title = titleInput.value })
    activeWindow.setTimeout(() => { titleInput.focus(); titleInput.select() }, 50)

    // ── Parent folder (new projects only) ─────────────────────────────────────
    if (this.isNew) {
      const folderSection = el.createDiv('pm-project-modal-section')
      folderSection.createEl('label', { text: 'Location', cls: 'pm-label' })
      const folderInput = folderSection.createEl('input', {
        type: 'text',
        cls: 'pm-input',
        value: this.parentFolder,
      })
      folderInput.placeholder = 'Folder path (blank = vault root)'
      folderInput.addEventListener('input', () => { this.parentFolder = folderInput.value.trim() })
    }

    // ── Color ─────────────────────────────────────────────────────────────────
    const colorSection = el.createDiv('pm-project-modal-section')
    colorSection.createEl('label', { text: 'Color', cls: 'pm-label' })
    const colorPalette = colorSection.createDiv('pm-color-palette')
    for (const color of PROJECT_COLORS) {
      const swatch = colorPalette.createEl('button', { cls: 'pm-color-swatch' })
      swatch.setCssStyles({ background: color })
      if (color === this.project.color) swatch.addClass('pm-color-swatch--selected')
      swatch.addEventListener('click', () => {
        this.project.color = color
        colorPalette.querySelectorAll('.pm-color-swatch').forEach((s) => s.removeClass('pm-color-swatch--selected'))
        swatch.addClass('pm-color-swatch--selected')
      })
    }
    const customColor = colorPalette.createEl('input', { type: 'color', cls: 'pm-color-custom' })
    customColor.value = this.project.color
    customColor.title = 'Custom color'
    customColor.addEventListener('change', () => {
      this.project.color = customColor.value
      colorPalette.querySelectorAll('.pm-color-swatch').forEach((s) => s.removeClass('pm-color-swatch--selected'))
    })

    // ── Description ───────────────────────────────────────────────────────────
    const descSection = el.createDiv('pm-project-modal-section')
    descSection.createEl('label', { text: 'Description', cls: 'pm-label' })
    const descArea = descSection.createEl('textarea', { cls: 'pm-input pm-project-desc' })
    descArea.placeholder = 'What is this project about?'
    descArea.value = this.project.description
    descArea.addEventListener('input', () => { this.project.description = descArea.value })

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = el.createDiv('pm-modal-footer')
    footer.createDiv('pm-footer-spacer')

    new ButtonComponent(footer).setButtonText('Cancel').onClick(() => this.close())

    new ButtonComponent(footer)
      .setButtonText(this.isNew ? '+ Create project' : 'Save')
      .setCta()
      .onClick(
        safeAsync(async () => {
          const title = titleInput.value.trim()
          if (!title) {
            titleInput.addClass('pm-input-error')
            titleInput.focus()
            return
          }
          this.project.title = title

          if (this.isNew) {
            const created = await this.plugin.store.createProject(title, this.parentFolder)
            await this.onSave(created)
          } else {
            await this.plugin.store.saveProject(this.project)
            await this.onSave(this.project)
          }
          this.close()
        })
      )
  }
}
