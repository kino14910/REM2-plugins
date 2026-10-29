import { describe, expect, it } from 'vitest'
import { createThemeSet } from '../src/themes.js'
import type { ThemeDefinitionWithSystem } from '../src/types.js'

function themeOf(
  themes: readonly ThemeDefinitionWithSystem[],
  id: string,
): ThemeDefinitionWithSystem {
  const theme = themes.find(entry => entry.id === id)
  expect(theme).toBeDefined()
  return theme as ThemeDefinitionWithSystem
}

describe('theme catalog', () => {
  it('contributes light, dark and system in that order', () => {
    const { themes } = createThemeSet()
    expect(themes.map(theme => theme.id)).toEqual(['light', 'dark', 'system'])
    expect(themes).toHaveLength(3)
  })

  it('keeps the old theme-dark palettes as the light/dark base', () => {
    const { themes } = createThemeSet()
    expect(themeOf(themes, 'light').colors).toMatchObject({
      background: '#f5f6f8',
      surface: '#ffffff',
      text: '#1b1f27',
      textMuted: '#5b6472',
      accent: '#2563eb',
      border: '#d9dee7',
    })
    expect(themeOf(themes, 'dark').colors).toMatchObject({
      background: '#0f1115',
      surface: '#161922',
      text: '#e6e6e6',
      textMuted: '#9aa4b2',
      accent: '#4f9cf9',
      border: '#232838',
    })
  })

  it('marks the system entry as followSystem while light/dark are fixed', () => {
    const { themes } = createThemeSet()
    const system = themeOf(themes, 'system')
    expect(system.mode).toBe('system')
    expect(system.followSystem).toBe(true)
    expect(themeOf(themes, 'light').followSystem).toBe(false)
    expect(themeOf(themes, 'dark').followSystem).toBe(false)
  })

  it('applies the configured accent to the contributed palettes', () => {
    const set = createThemeSet()
    set.setAccent('#123456')

    expect(themeOf(set.themes, 'light').colors.accent).toBe('#123456')
    expect(themeOf(set.themes, 'dark').colors.accent).toBe('#123456')
    expect(themeOf(set.themes, 'system').colors.accent).toBe('#123456')
    expect(themeOf(set.themes, 'light').colors.background).toBe('#f5f6f8')
  })

  it('uses the persisted default accent for every palette on first contribution', () => {
    const set = createThemeSet('#4f9cf9')
    expect(themeOf(set.themes, 'light').colors.accent).toBe('#4f9cf9')
    expect(themeOf(set.themes, 'dark').colors.accent).toBe('#4f9cf9')
  })
})
