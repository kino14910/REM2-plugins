/**
 * Identity and topic constants shared by the plugin runtime and its tests.
 */

import { Topics } from 'rem2-kernel'

export const PLUGIN_ID = 'com.rem2.theme-switcher'
export const PLUGIN_NAME = 'Theme Switcher'
export const PLUGIN_VERSION = '1.0.0'

export const PANEL_ID = 'theme-switcher'
export const ROUTE_PATH = '/theme'
/** Private panel data topic (reverse-DNS prefix keeps it out of kernel space). */
export const PANEL_COMMAND = 'com.rem2.theme-switcher.data'

export const PREFERENCES_RELATIVE_PATH = 'data/preferences.json'

/**
 * REM2 will add `Topics.UiThemeSet` (= `ui.theme.set`) for the event-bus form of
 * the switch currently exposed as an IPC method. Reading it defensively keeps
 * this standalone plugin working against kernels that do not export it yet.
 */
export const UI_THEME_SET_TOPIC: string = Topics.UiThemeSet
/** Re-materializes followSystem themes after an in-place accent update. */
export const UI_THEME_REFRESH_TOPIC: string = Topics.UiThemeRefresh
