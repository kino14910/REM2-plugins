/**
 * Contracts used by the plugin.
 *
 * `PanelFormData` / `PanelFormField` mirror the generic form contract that
 * rem2-kernel will export. They live here until the kernel package exposes them;
 * the shape is exactly the contract, so swapping to `import type` later is a
 * one-line change per type.
 */

import type { ThemeDefinition } from 'rem2-kernel'

/** Modes the panel can persist; `system` means "follow the OS preference". */
export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

/**
 * REM2's current `ThemeDefinition` is light/dark only. The switcher contributes
 * a third `system` entry and marks it with `followSystem`; the other tokens are
 * kept structurally identical to the kernel contract.
 */
export type ThemeDefinitionWithSystem = Omit<
  ThemeDefinition,
  'id' | 'mode' | 'colors'
> & {
  readonly id: ThemeMode
  readonly mode: ThemeMode
  /** Mutable on purpose: an accent change must update the already-contributed object. */
  colors: Record<string, string>
  readonly followSystem: boolean
}

export interface PanelFormOption {
  value: string
  label: string
}

export interface PanelFormField {
  id: string
  label: string
  type: 'select' | 'color'
  value: string
  options?: PanelFormOption[]
}

export interface PanelFormData {
  kind: 'form'
  fields: PanelFormField[]
}

/** Shape persisted at `data/preferences.json`. */
export interface Preferences {
  version: 1
  mode: ThemeMode
  accent: string
}
