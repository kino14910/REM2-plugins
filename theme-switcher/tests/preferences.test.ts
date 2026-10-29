import { mkdir, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_ACCENT,
  DEFAULT_MODE,
  DEFAULT_PREFERENCES,
  PREFERENCES_VERSION,
  PreferencesStore,
  normalizePreferences,
  readPreferences,
  writePreferencesAtomic,
} from '../src/preferences.js'
import type { Preferences } from '../src/types.js'
import { createTempDir, removeTempDirs } from './helpers.js'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await createTempDir('rem2-theme-switcher-prefs-')
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await removeTempDirs(tempDirs)
})

describe('preference normalization', () => {
  it('falls back to defaults for missing or non-object input', () => {
    expect(normalizePreferences(undefined)).toEqual(DEFAULT_PREFERENCES)
    expect(normalizePreferences(null)).toEqual(DEFAULT_PREFERENCES)
    expect(normalizePreferences('nope')).toEqual(DEFAULT_PREFERENCES)
    expect(DEFAULT_PREFERENCES).toEqual({
      version: PREFERENCES_VERSION,
      mode: DEFAULT_MODE,
      accent: DEFAULT_ACCENT,
    })
  })

  it('falls back per field when only one field is invalid', () => {
    expect(
      normalizePreferences({ mode: 'sepia', accent: '#AABBCC' }),
    ).toEqual({
      version: PREFERENCES_VERSION,
      mode: DEFAULT_MODE,
      accent: '#AABBCC',
    })
    expect(
      normalizePreferences({ mode: 'dark', accent: 'rgb(1,2,3)' }),
    ).toEqual({
      version: PREFERENCES_VERSION,
      mode: 'dark',
      accent: DEFAULT_ACCENT,
    })
    expect(
      normalizePreferences({ version: 1, mode: 'system', accent: '#12345' }),
    ).toEqual({
      version: PREFERENCES_VERSION,
      mode: 'system',
      accent: DEFAULT_ACCENT,
    })
  })

  it('defaults when the file is missing or contains corrupt JSON', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'data', 'preferences.json')

    expect(await readPreferences(file)).toEqual(DEFAULT_PREFERENCES)

    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '{"version": 1, "mode": ', 'utf8')
    expect(await readPreferences(file)).toEqual(DEFAULT_PREFERENCES)
  })
})

describe('preference persistence', () => {
  it('round-trips a valid preference file', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'data', 'preferences.json')
    const preferences: Preferences = {
      version: 1,
      mode: 'dark',
      accent: '#123456',
    }

    await writePreferencesAtomic(file, preferences)
    expect(await readPreferences(file)).toEqual(preferences)

    const store = new PreferencesStore(file)
    expect(await store.load()).toEqual(preferences)
  })

  it('writes atomically without leaving temp files', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'data', 'preferences.json')
    const store = new PreferencesStore(file)

    await store.save({ version: 1, mode: 'light', accent: '#abcdef' })
    const entries = await readdir(path.dirname(file))
    expect(entries).toEqual(['preferences.json'])
  })

  it('serializes concurrent saves so the last write wins without leftovers', async () => {
    const dir = await tempDir()
    const file = path.join(dir, 'data', 'preferences.json')
    const store = new PreferencesStore(file)

    const writes = [
      store.save({ version: 1, mode: 'light', accent: '#111111' }),
      store.save({ version: 1, mode: 'dark', accent: '#222222' }),
      store.save({ version: 1, mode: 'system', accent: '#333333' }),
    ]
    await Promise.all(writes)
    await store.flush()

    expect(await readPreferences(file)).toEqual({
      version: 1,
      mode: 'system',
      accent: '#333333',
    })
    const entries = await readdir(path.dirname(file))
    expect(entries).toEqual(['preferences.json'])
    expect(entries.some(entry => entry.endsWith('.tmp'))).toBe(false)
  })
})
