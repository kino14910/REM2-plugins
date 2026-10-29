/**
 * Preference validation and persistence.
 *
 * Every read falls back to defaults: a missing file, corrupt JSON, or an
 * individual field of the wrong shape must never make the plugin fail to start.
 * Every write is atomic (same-directory temp file + rename) and serialized per
 * store instance, so concurrent saves cannot interleave or leave a temp file.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { THEME_MODES } from './types.js'
import type { Preferences, ThemeMode } from './types.js'

export const PREFERENCES_VERSION = 1
export const DEFAULT_MODE: ThemeMode = 'system'
export const DEFAULT_ACCENT = '#4f9cf9'
/** Strict `#RRGGBB` (six hex digits, with `#`). */
export const ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/

export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({
  version: PREFERENCES_VERSION,
  mode: DEFAULT_MODE,
  accent: DEFAULT_ACCENT,
})

export function isThemeMode(value: unknown): value is ThemeMode {
  return (
    typeof value === 'string' &&
    (THEME_MODES as readonly string[]).includes(value)
  )
}

export function isAccent(value: unknown): value is string {
  return typeof value === 'string' && ACCENT_PATTERN.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Normalizes untrusted persisted data. The version is always rewritten to 1;
 * invalid mode/accent fields fall back individually, so one bad field does not
 * discard a still-valid sibling.
 */
export function normalizePreferences(raw: unknown): Preferences {
  if (!isRecord(raw)) return { ...DEFAULT_PREFERENCES }
  return {
    version: PREFERENCES_VERSION,
    mode: isThemeMode(raw.mode) ? raw.mode : DEFAULT_MODE,
    accent: isAccent(raw.accent) ? raw.accent : DEFAULT_ACCENT,
  }
}

/** Reads and normalizes preferences; any I/O or JSON error yields defaults. */
export async function readPreferences(filePath: string): Promise<Preferences> {
  try {
    return normalizePreferences(JSON.parse(await readFile(filePath, 'utf8')))
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

let tempCounter = 0

function tempPathFor(filePath: string): string {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${++tempCounter}.tmp`,
  )
}

/** Writes JSON via a same-directory temp file + rename; the temp file is removed on failure. */
export async function writePreferencesAtomic(
  filePath: string,
  preferences: Preferences,
): Promise<void> {
  const directory = path.dirname(filePath)
  await mkdir(directory, { recursive: true })

  const tempPath = tempPathFor(filePath)
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify(normalizePreferences(preferences), null, 2)}\n`,
      'utf8',
    )
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Serialized writer: each save waits for the previous one while `load` stays independent. */
export class PreferencesStore {
  private queue: Promise<void> = Promise.resolve()

  constructor(readonly filePath: string) {}

  load(): Promise<Preferences> {
    return readPreferences(this.filePath)
  }

  save(preferences: Preferences): Promise<void> {
    const snapshot = normalizePreferences(preferences)
    const write = this.queue.then(() =>
      writePreferencesAtomic(this.filePath, snapshot),
    )
    // Keep the chain alive after a rejection so later saves still run.
    this.queue = write.then(
      () => undefined,
      () => undefined,
    )
    return write
  }

  /** Waits for all queued writes (used by onStop without surfacing prior failures). */
  flush(): Promise<void> {
    return this.queue
  }
}
