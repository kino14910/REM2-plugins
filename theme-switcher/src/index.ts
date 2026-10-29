/**
 * Theme Switcher plugin (`com.rem2.theme-switcher`).
 *
 * - Contributes light/dark/system token sets into `ui.theme`; the system entry
 *   carries `followSystem: true`.
 * - Contributes a form panel (`theme-switcher`, route `/theme`) served over the
 *   private topic `com.rem2.theme-switcher.data`.
 * - Persists `{ version: 1, mode, accent }` under `data/preferences.json`, with
 *   atomic writes and per-field fallback on corrupt input.
 * - Forwards a mode change to the host via `ui.theme.set`, updates both palettes
 *   on an accent change, and mirrors host-originated `ui.theme.changed` choices.
 */

import { definePlugin, Topics } from 'rem2-kernel'
import type {
  PanelContribution,
  PluginContext,
  RouteContribution,
  Unsubscribe,
} from 'rem2-kernel'
import {
  PANEL_COMMAND,
  PANEL_ID,
  PLUGIN_ID,
  PLUGIN_NAME,
  PLUGIN_VERSION,
  PREFERENCES_RELATIVE_PATH,
  ROUTE_PATH,
  UI_THEME_SET_TOPIC,
} from './constants.js'
import { buildPanelFormData, parsePanelChange } from './panel.js'
import {
  DEFAULT_ACCENT,
  DEFAULT_MODE,
  PREFERENCES_VERSION,
  PreferencesStore,
  isThemeMode,
} from './preferences.js'
import { createThemeSet } from './themes.js'
import type {
  PanelFormData,
  Preferences,
  ThemeDefinitionWithSystem,
  ThemeMode,
} from './types.js'

type ActionResult = { ok: true } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A host reply is a failure when it is `false` or `{ ok: false }`; anything else counts as success. */
function failureMessage(reply: unknown): string | undefined {
  if (reply === false) return 'host rejected the theme switch'
  if (isRecord(reply) && reply.ok === false) {
    return typeof reply.error === 'string'
      ? reply.error
      : 'host rejected the theme switch'
  }
  return undefined
}

export default definePlugin(
  {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
  },
  (ctx: PluginContext) => {
    const themes = createThemeSet()
    const store = new PreferencesStore(
      ctx.resolvePath(PREFERENCES_RELATIVE_PATH),
    )

    let mode: ThemeMode = DEFAULT_MODE
    let accent = DEFAULT_ACCENT
    let unsubscribes: Unsubscribe[] = []

    function panelData(): PanelFormData {
      return buildPanelFormData(mode, accent)
    }

    function currentTheme(): ThemeDefinitionWithSystem | undefined {
      return themes.get(mode)
    }

    function snapshot(): Preferences {
      return { version: PREFERENCES_VERSION, mode, accent }
    }

    async function persist(): Promise<void> {
      await store.save(snapshot())
    }

    async function emitPanelData(): Promise<void> {
      await ctx.events.emit(Topics.PanelDataChanged, {
        panelId: PANEL_ID,
        data: panelData(),
      })
    }

    async function requestTheme(next: ThemeMode): Promise<ActionResult> {
      try {
        const reply = await ctx.events.request<
          { themeId: ThemeMode },
          unknown
        >(UI_THEME_SET_TOPIC, { themeId: next })
        const failure = failureMessage(reply)
        return failure ? { ok: false, error: failure } : { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: `theme switch request failed: ${messageOf(error)}`,
        }
      }
    }

    async function changeMode(next: ThemeMode): Promise<ActionResult> {
      const result = await requestTheme(next)
      if (!result.ok) return result

      mode = next
      try {
        await persist()
      } catch (error) {
        return {
          ok: false,
          error: `failed to persist preferences: ${messageOf(error)}`,
        }
      }
      await emitPanelData()
      return { ok: true }
    }

    async function changeAccent(next: string): Promise<ActionResult> {
      const previous = accent
      accent = next
      themes.setAccent(next)

      try {
        await persist()
      } catch (error) {
        accent = previous
        themes.setAccent(previous)
        return {
          ok: false,
          error: `failed to persist preferences: ${messageOf(error)}`,
        }
      }

      const theme = currentTheme()
      if (theme) await ctx.events.emit(Topics.UiThemeChanged, theme)
      await emitPanelData()
      return { ok: true }
    }

    /**
     * Panel command responder.
     *
     * - `{ panelId }` (host data request) -> form data.
     * - `{ kind: 'change', payload: { fieldId, value } }` -> validated update.
     * - any other event kind / field -> explicit `{ ok: false, error }`.
     */
    async function handlePanelCommand(payload: unknown): Promise<unknown> {
      if (isRecord(payload) && 'kind' in payload) {
        if (typeof payload.kind !== 'string') {
          return { ok: false, error: 'invalid event kind' }
        }
        if (payload.kind !== 'change') {
          return { ok: false, error: `unknown event: ${payload.kind}` }
        }

        const parsed = parsePanelChange(payload.payload)
        if (!parsed.ok) return { ok: false, error: parsed.error }

        return parsed.change.fieldId === 'mode'
          ? await changeMode(parsed.change.value)
          : await changeAccent(parsed.change.value)
      }

      return panelData()
    }

    /** Host top-bar selection (including choices made outside this panel) is persisted here. */
    async function handleThemeChanged(payload: unknown): Promise<void> {
      const themeId =
        typeof payload === 'string'
          ? payload
          : isRecord(payload) && typeof payload.id === 'string'
            ? payload.id
            : undefined
      if (!isThemeMode(themeId) || themeId === mode) return

      mode = themeId
      try {
        await persist()
      } catch (error) {
        ctx.log.warn(
          `Failed to persist theme choice: ${messageOf(error)}`,
        )
      }
      await emitPanelData()
    }

    return {
      async onStart(): Promise<void> {
        const saved = await store.load()
        mode = saved.mode
        accent = saved.accent
        themes.setAccent(accent)

        for (const theme of themes.themes) {
          // contributionId = theme.id: the multi slot's duplicate check owns id uniqueness.
          ctx.extensions.contribute<ThemeDefinitionWithSystem>('ui.theme', {
            contributionId: theme.id,
            impl: theme,
          })
        }

        ctx.extensions.contribute<PanelContribution>('ui.panel', {
          contributionId: PANEL_ID,
          impl: {
            panelId: PANEL_ID,
            title: PLUGIN_NAME,
            icon: '◐',
            region: 'main',
            order: 20,
            command: PANEL_COMMAND,
          },
        })

        ctx.extensions.contribute<RouteContribution>('ui.route', {
          contributionId: ROUTE_PATH,
          impl: {
            path: ROUTE_PATH,
            title: 'Theme',
            panelId: PANEL_ID,
            commandPrefix: '',
            order: 20,
          },
        })

        unsubscribes.push(
          ctx.events.respond(PANEL_COMMAND, handlePanelCommand),
          ctx.events.on(Topics.UiThemeChanged, handleThemeChanged),
        )

        // Restore the saved selection after the themes are resident. A host that
        // does not support the topic yet must not fail plugin startup.
        const applied = await requestTheme(mode)
        if (!applied.ok) {
          ctx.log.warn(`Saved theme mode was not applied: ${applied.error}`)
        }

        ctx.log.info(
          `Theme Switcher active (mode=${mode}, accent=${accent})`,
        )
      },

      async onStop(hookCtx: PluginContext, reason: string): Promise<void> {
        for (const unsubscribe of unsubscribes.splice(0)) unsubscribe()
        await store.flush()
        hookCtx.log.info(`Theme Switcher stopped (${reason})`)
      },
    }
  },
)
