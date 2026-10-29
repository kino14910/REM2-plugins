/**
 * Panel form contract and strict change validation.
 *
 * The host renders the form; this plugin only returns data and validates
 * incoming `ui.event` changes. Anything outside the declared field/color
 * grammar is rejected explicitly instead of being coerced.
 */

import { isAccent, isThemeMode } from './preferences.js'
import type { PanelFormData, PanelFormOption, ThemeMode } from './types.js'

export const MODE_OPTIONS: readonly PanelFormOption[] = Object.freeze([
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
])

export function buildPanelFormData(
  mode: ThemeMode,
  accent: string,
): PanelFormData {
  return {
    kind: 'form',
    fields: [
      {
        id: 'mode',
        label: 'Mode',
        type: 'select',
        value: mode,
        options: MODE_OPTIONS.map(option => ({
          value: option.value,
          label: option.label,
        })),
      },
      {
        id: 'accent',
        label: 'Accent color',
        type: 'color',
        value: accent,
      },
    ],
  }
}

export type PanelChange =
  | { fieldId: 'mode'; value: ThemeMode }
  | { fieldId: 'accent'; value: string }

export type ParseChangeResult =
  | { ok: true; change: PanelChange }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validates a `ui.event` payload of kind `change`. */
export function parsePanelChange(payload: unknown): ParseChangeResult {
  if (!isRecord(payload)) {
    return { ok: false, error: 'change payload must be an object' }
  }

  const fieldId = payload.fieldId
  if (typeof fieldId !== 'string' || fieldId === '') {
    return { ok: false, error: 'change payload requires a non-empty fieldId' }
  }
  if (fieldId !== 'mode' && fieldId !== 'accent') {
    return { ok: false, error: `unknown field: ${fieldId}` }
  }

  const value = payload.value
  if (typeof value !== 'string') {
    return { ok: false, error: `field ${fieldId} requires a string value` }
  }

  if (fieldId === 'mode') {
    if (!isThemeMode(value)) {
      return {
        ok: false,
        error: `invalid mode: ${value} (expected light, dark, or system)`,
      }
    }
    return { ok: true, change: { fieldId: 'mode', value } }
  }

  if (!isAccent(value)) {
    return { ok: false, error: `invalid accent: ${value} (expected #RRGGBB)` }
  }
  return { ok: true, change: { fieldId: 'accent', value } }
}
