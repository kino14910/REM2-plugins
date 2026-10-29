/**
 * Theme token sets.
 *
 * The light/dark palettes are the ones from REM2's old `theme-dark` plugin.
 * `accent` is the single user-configurable token, so an accent change rewrites
 * the already-contributed theme objects in place: the host theme registry keeps
 * the same references, and no retract/re-contribute cycle is needed.
 */

import type { ThemeDefinitionWithSystem, ThemeMode } from './types.js'

const FONTS: Readonly<Record<string, string>> = {
  ui: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", "Fira Code", monospace',
}

const SPACING: Readonly<Record<string, string>> = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
}

export const DARK_COLORS: Readonly<Record<string, string>> = Object.freeze({
  background: '#0f1115',
  surface: '#161922',
  text: '#e6e6e6',
  textMuted: '#9aa4b2',
  accent: '#4f9cf9',
  border: '#232838',
})

export const LIGHT_COLORS: Readonly<Record<string, string>> = Object.freeze({
  background: '#f5f6f8',
  surface: '#ffffff',
  text: '#1b1f27',
  textMuted: '#5b6472',
  accent: '#2563eb',
  border: '#d9dee7',
})

export interface ThemeSet {
  readonly themes: readonly ThemeDefinitionWithSystem[]
  get(mode: ThemeMode): ThemeDefinitionWithSystem | undefined
  setAccent(accent: string): void
}

/**
 * Builds the three resident token sets. Without an initial accent the palettes
 * keep their historic accents; the plugin always passes the persisted accent,
 * whose default is `#4f9cf9` (so both palettes start on that accent).
 */
export function createThemeSet(initialAccent?: string): ThemeSet {
  const lightColors: Record<string, string> = { ...LIGHT_COLORS }
  const darkColors: Record<string, string> = { ...DARK_COLORS }
  // The system entry carries the dark palette as its static fallback; the host
  // decides the effective palette from the OS when followSystem is set.
  const systemColors: Record<string, string> = { ...DARK_COLORS }

  const themes: ThemeDefinitionWithSystem[] = [
    {
      id: 'light',
      mode: 'light',
      colors: lightColors,
      fonts: FONTS,
      spacing: SPACING,
      followSystem: false,
    },
    {
      id: 'dark',
      mode: 'dark',
      colors: darkColors,
      fonts: FONTS,
      spacing: SPACING,
      followSystem: false,
    },
    {
      id: 'system',
      mode: 'system',
      colors: systemColors,
      fonts: FONTS,
      spacing: SPACING,
      followSystem: true,
    },
  ]

  if (initialAccent !== undefined) {
    for (const theme of themes) theme.colors.accent = initialAccent
  }

  const byMode = new Map<ThemeMode, ThemeDefinitionWithSystem>(
    themes.map(theme => [theme.id, theme]),
  )

  return {
    themes,
    get: mode => byMode.get(mode),
    setAccent: accent => {
      for (const theme of themes) theme.colors.accent = accent
    },
  }
}
