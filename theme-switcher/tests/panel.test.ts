import { describe, expect, it } from 'vitest'
import { buildPanelFormData, parsePanelChange } from '../src/panel.js'

describe('panel form data', () => {
  it('returns the generic form contract for the current values', () => {
    expect(buildPanelFormData('system', '#4f9cf9')).toEqual({
      kind: 'form',
      fields: [
        {
          id: 'mode',
          label: 'Mode',
          type: 'select',
          value: 'system',
          options: [
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ],
        },
        {
          id: 'accent',
          label: 'Accent color',
          type: 'color',
          value: '#4f9cf9',
        },
      ],
    })
  })
})

describe('panel change validation', () => {
  it('accepts every valid mode', () => {
    for (const mode of ['light', 'dark', 'system'] as const) {
      const parsed = parsePanelChange({ fieldId: 'mode', value: mode })
      expect(parsed).toEqual({ ok: true, change: { fieldId: 'mode', value: mode } })
    }
  })

  it('accepts #RRGGBB in either case', () => {
    expect(
      parsePanelChange({ fieldId: 'accent', value: '#4f9cf9' }),
    ).toEqual({
      ok: true,
      change: { fieldId: 'accent', value: '#4f9cf9' },
    })
    expect(
      parsePanelChange({ fieldId: 'accent', value: '#AABBCC' }),
    ).toEqual({
      ok: true,
      change: { fieldId: 'accent', value: '#AABBCC' },
    })
  })

  it('rejects invalid modes', () => {
    for (const value of ['Light', 'DARK', 'auto', '', ' system ']) {
      expect(parsePanelChange({ fieldId: 'mode', value })).toMatchObject({
        ok: false,
      })
    }
  })

  it('rejects anything that is not exactly #RRGGBB', () => {
    for (const value of [
      '#12345',
      '#1234567',
      '123456',
      '#GGGGGG',
      'red',
      ' rgb(1,2,3)',
      '#12345G',
    ]) {
      expect(parsePanelChange({ fieldId: 'accent', value })).toMatchObject({
        ok: false,
      })
    }
  })

  it('rejects unknown fields, malformed payloads and non-string values', () => {
    expect(parsePanelChange({ fieldId: 'font', value: 'sans' })).toEqual({
      ok: false,
      error: 'unknown field: font',
    })
    expect(parsePanelChange(null)).toMatchObject({ ok: false })
    expect(parsePanelChange([])).toMatchObject({ ok: false })
    expect(parsePanelChange({ fieldId: 'mode', value: 1 })).toMatchObject({
      ok: false,
    })
    expect(parsePanelChange({ fieldId: '', value: 'light' })).toMatchObject({
      ok: false,
    })
  })
})
