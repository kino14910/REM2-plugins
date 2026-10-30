/**
 * Contracts used by the plugin.
 *
 * Theme preferences use the public kernel theme/form contracts. Only the
 * mutable accent palette and persisted file shape are plugin-local.
 */

import type { ThemeDefinition } from 'rem2-kernel'

export type {
  PanelFormData,
  PanelFormField,
  PanelFormOption,
} from 'rem2-kernel'

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

/** Shape persisted at `data/preferences.json`. */
export interface Preferences {
  version: 1
  mode: ThemeMode
  accent: string
}
