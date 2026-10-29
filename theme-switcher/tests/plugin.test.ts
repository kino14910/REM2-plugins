import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Topics } from 'rem2-kernel'
import themeSwitcher from '../src/index.js'
import {
  PANEL_COMMAND,
  PANEL_ID,
  PREFERENCES_RELATIVE_PATH,
  ROUTE_PATH,
  UI_THEME_SET_TOPIC,
} from '../src/constants.js'
import {
  DEFAULT_ACCENT,
  DEFAULT_MODE,
  readPreferences,
  writePreferencesAtomic,
} from '../src/preferences.js'
import type {
  PanelFormData,
  Preferences,
  ThemeDefinitionWithSystem,
} from '../src/types.js'
import {
  TestEventBus,
  createTempDir,
  createTestContext,
  removeTempDirs,
} from './helpers.js'

const tempDirs: string[] = []

async function setup(preferences?: Preferences | string) {
  const rootDir = await createTempDir('rem2-theme-switcher-plugin-')
  tempDirs.push(rootDir)

  const file = path.join(rootDir, PREFERENCES_RELATIVE_PATH)
  if (typeof preferences === 'string') {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, preferences, 'utf8')
  } else if (preferences) {
    await writePreferencesAtomic(file, preferences)
  }

  const bus = new TestEventBus()
  // Simulated future host: the event-bus form of the theme switch accepts our ids.
  bus.respond(UI_THEME_SET_TOPIC, () => ({ ok: true }))

  const { ctx, contributions, logs } = createTestContext(rootDir, bus)
  const hooks = themeSwitcher(ctx)
  await hooks.onStart?.(ctx)

  return { rootDir, file, bus, ctx, contributions, hooks, logs }
}

function themesById(
  contributions: ReturnType<typeof createTestContext>['contributions'],
): Map<string, ThemeDefinitionWithSystem> {
  const map = new Map<string, ThemeDefinitionWithSystem>()
  for (const contribution of contributions) {
    if (contribution.point === 'ui.theme') {
      const theme = contribution.impl as ThemeDefinitionWithSystem
      map.set(theme.id, theme)
    }
  }
  return map
}

function send(bus: TestEventBus, payload: unknown): Promise<unknown> {
  return bus.request(PANEL_COMMAND, payload)
}

function fetchForm(bus: TestEventBus): Promise<PanelFormData> {
  return bus.request<{ panelId: string }, PanelFormData>(PANEL_COMMAND, {
    panelId: PANEL_ID,
  })
}

afterEach(async () => {
  await removeTempDirs(tempDirs)
})

describe('theme-switcher plugin startup', () => {
  it('contributes three themes, a panel and a route with default preferences', async () => {
    const { bus, contributions } = await setup()

    expect(contributions.map(entry => `${entry.point}#${entry.contributionId}`)).toEqual([
      'ui.theme#light',
      'ui.theme#dark',
      'ui.theme#system',
      'ui.panel#theme-switcher',
      `ui.route#${ROUTE_PATH}`,
    ])

    const themes = themesById(contributions)
    expect(themes.get('light')?.colors.accent).toBe(DEFAULT_ACCENT)
    expect(themes.get('dark')?.colors.accent).toBe(DEFAULT_ACCENT)
    expect(themes.get('system')?.followSystem).toBe(true)

    const panel = contributions.find(entry => entry.point === 'ui.panel')
      ?.impl as { panelId: string; command: string; region: string }
    expect(panel.panelId).toBe(PANEL_ID)
    expect(panel.command).toBe(PANEL_COMMAND)
    expect(panel.region).toBe('main')

    const form = await fetchForm(bus)
    expect(form.fields[0]).toMatchObject({
      id: 'mode',
      type: 'select',
      value: DEFAULT_MODE,
    })
    expect(form.fields[1]).toMatchObject({
      id: 'accent',
      type: 'color',
      value: DEFAULT_ACCENT,
    })

    expect(bus.requestedFor(UI_THEME_SET_TOPIC)).toHaveLength(1)
    expect(bus.requestedFor(UI_THEME_SET_TOPIC)[0]?.payload).toEqual({
      themeId: DEFAULT_MODE,
    })
  })

  it('restores a persisted mode/accent and applies the saved theme', async () => {
    const { bus, file, contributions } = await setup({
      version: 1,
      mode: 'dark',
      accent: '#123456',
    })

    const form = await fetchForm(bus)
    expect(form.fields[0]?.value).toBe('dark')
    expect(form.fields[1]?.value).toBe('#123456')

    const themes = themesById(contributions)
    expect(themes.get('light')?.colors.accent).toBe('#123456')
    expect(themes.get('dark')?.colors.accent).toBe('#123456')

    expect(bus.requestedFor(UI_THEME_SET_TOPIC).at(-1)?.payload).toEqual({
      themeId: 'dark',
    })
    expect(await readPreferences(file)).toEqual({
      version: 1,
      mode: 'dark',
      accent: '#123456',
    })
  })

  it('starts on defaults when the preferences file is corrupt', async () => {
    const { bus, file } = await setup('{not valid json')

    const form = await fetchForm(bus)
    expect(form.fields[0]?.value).toBe(DEFAULT_MODE)
    expect(form.fields[1]?.value).toBe(DEFAULT_ACCENT)
    expect(await readPreferences(file)).toEqual({
      version: 1,
      mode: DEFAULT_MODE,
      accent: DEFAULT_ACCENT,
    })
    expect(bus.requestedFor(UI_THEME_SET_TOPIC).at(-1)?.payload).toEqual({
      themeId: DEFAULT_MODE,
    })
  })
})

describe('panel command handling', () => {
  it('updates both palettes on an accent change and emits theme/panel events', async () => {
    const { bus, file, contributions } = await setup()

    expect(
      await send(bus, {
        kind: 'change',
        payload: { fieldId: 'accent', value: '#112233' },
      }),
    ).toEqual({ ok: true })

    const themes = themesById(contributions)
    expect(themes.get('light')?.colors.accent).toBe('#112233')
    expect(themes.get('dark')?.colors.accent).toBe('#112233')
    expect(themes.get('system')?.colors.accent).toBe('#112233')

    const form = await fetchForm(bus)
    expect(form.fields[1]?.value).toBe('#112233')

    expect(await readPreferences(file)).toEqual({
      version: 1,
      mode: DEFAULT_MODE,
      accent: '#112233',
    })

    const themeEvents = bus.emittedFor(Topics.UiThemeChanged)
    expect(themeEvents).toHaveLength(1)
    expect(themeEvents[0]?.payload).toMatchObject({
      id: DEFAULT_MODE,
      colors: { accent: '#112233' },
    })

    const panelEvents = bus.emittedFor(Topics.PanelDataChanged)
    expect(panelEvents).toHaveLength(1)
    expect(panelEvents[0]?.payload).toMatchObject({
      panelId: PANEL_ID,
      data: { kind: 'form', fields: [{ value: DEFAULT_MODE }, { value: '#112233' }] },
    })
  })

  it('forwards a mode change through ui.theme.set and persists it', async () => {
    const { bus, file } = await setup()

    expect(
      await send(bus, {
        kind: 'change',
        payload: { fieldId: 'mode', value: 'light' },
      }),
    ).toEqual({ ok: true })

    expect(bus.requestedFor(UI_THEME_SET_TOPIC).at(-1)?.payload).toEqual({
      themeId: 'light',
    })
    expect(await readPreferences(file)).toEqual({
      version: 1,
      mode: 'light',
      accent: DEFAULT_ACCENT,
    })
    expect((await fetchForm(bus)).fields[0]?.value).toBe('light')
    expect(bus.emittedFor(Topics.PanelDataChanged)).toHaveLength(1)
  })

  it('rejects unknown events, unknown fields and invalid values explicitly', async () => {
    const { bus, file } = await setup()

    expect(await send(bus, { kind: 'refresh' })).toEqual({
      ok: false,
      error: 'unknown event: refresh',
    })
    expect(
      await send(bus, {
        kind: 'change',
        payload: { fieldId: 'font', value: 'serif' },
      }),
    ).toEqual({ ok: false, error: 'unknown field: font' })
    expect(
      await send(bus, {
        kind: 'change',
        payload: { fieldId: 'mode', value: 'sepia' },
      }),
    ).toMatchObject({ ok: false })
    expect(
      await send(bus, {
        kind: 'change',
        payload: { fieldId: 'accent', value: '#12345' },
      }),
    ).toMatchObject({ ok: false })

    expect(await readPreferences(file)).toEqual({
      version: 1,
      mode: DEFAULT_MODE,
      accent: DEFAULT_ACCENT,
    })
    expect(bus.requestedFor(UI_THEME_SET_TOPIC)).toHaveLength(1)
  })
})

describe('host-originated theme changes', () => {
  it('persists a top-bar light/dark/system selection from ui.theme.changed', async () => {
    const { bus, file } = await setup()

    await bus.emit(Topics.UiThemeChanged, {
      id: 'dark',
      mode: 'dark',
      colors: {},
      fonts: {},
      spacing: {},
      followSystem: false,
    })

    expect(await readPreferences(file)).toEqual({
      version: 1,
      mode: 'dark',
      accent: DEFAULT_ACCENT,
    })
    expect((await fetchForm(bus)).fields[0]?.value).toBe('dark')
    expect(
      bus.emittedFor(Topics.PanelDataChanged).at(-1)?.payload,
    ).toMatchObject({
      panelId: PANEL_ID,
      data: { fields: [{ value: 'dark' }, { value: DEFAULT_ACCENT }] },
    })

    await bus.emit(Topics.UiThemeChanged, { id: 'system' })
    expect((await readPreferences(file)).mode).toBe('system')

    await bus.emit(Topics.UiThemeChanged, { id: 'sepia' })
    expect((await readPreferences(file)).mode).toBe('system')
  })
})

describe('plugin shutdown', () => {
  it('unsubscribes the command responder and the theme listener', async () => {
    const { bus, ctx, hooks } = await setup()

    expect(bus.listenerCount).toBe(1)
    expect(bus.hasResponder(PANEL_COMMAND)).toBe(true)

    await hooks.onStop?.(ctx, 'shutdown')

    expect(bus.listenerCount).toBe(0)
    expect(bus.hasResponder(PANEL_COMMAND)).toBe(false)
    // The host's own ui.theme.set responder is untouched.
    expect(bus.hasResponder(UI_THEME_SET_TOPIC)).toBe(true)
    await expect(send(bus, { panelId: PANEL_ID })).rejects.toThrow(
      /no responder/,
    )
  })
})
