// ../../REM2/dist/kernel/contracts/service-token.js
function defineToken(descriptor) {
  if (!descriptor.id || typeof descriptor.id !== "string") {
    throw new TypeError("defineToken requires a non-empty id");
  }
  return {
    id: descriptor.id,
    describe: descriptor.describe,
    ...descriptor.capability !== void 0 ? { capability: descriptor.capability } : {}
  };
}

// ../../REM2/dist/kernel/errors.js
var KernelError = class extends Error {
  code;
  detail;
  constructor(code, message, detail) {
    super(message);
    this.name = "KernelError";
    this.code = code;
    if (detail !== void 0) {
      this.detail = detail;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
var ManifestError = class extends KernelError {
  issues;
  constructor(issues, filePath) {
    super("E_INVALID_MANIFEST", `invalid plugin manifest${filePath ? ` (${filePath})` : ""}: ${issues.join("; ")}`, { issues, filePath });
    this.name = "ManifestError";
    this.issues = issues;
  }
};

// ../../REM2/dist/kernel/define-plugin.js
function definePlugin(manifest, setup) {
  if (!manifest || typeof manifest.id !== "string" || manifest.id.trim() === "") {
    throw new ManifestError([
      "definePlugin requires manifest.id to be a non-empty string"
    ]);
  }
  if (typeof setup !== "function") {
    throw new TypeError(`setup of plugin ${manifest.id} must be a function`);
  }
  const factory = function rem2Plugin(ctx) {
    return setup(ctx);
  };
  Object.defineProperty(factory, "manifest", {
    value: Object.freeze({ ...manifest }),
    enumerable: true
  });
  return Object.freeze(factory);
}

// ../../REM2/dist/kernel/topics.js
var Topics = {
  /** Lifecycle / system */
  KernelReady: "kernel.ready",
  KernelShutdown: "kernel.shutdown",
  PluginStateChanged: "kernel.plugin.state-changed",
  PluginDegraded: "kernel.plugin.degraded",
  PluginFailed: "kernel.plugin.failed",
  PluginReloaded: "kernel.plugin.reloaded",
  PluginUnloaded: "kernel.plugin.unloaded",
  /** Configuration */
  ConfigChanged: "config.changed",
  /** Commands (commonly used by feature plugins) */
  CommandExecute: "command.execute",
  CommandResult: "command.result",
  /** UI (consumed by the frontend via an IPC allowlist; raw plugin events never leak) */
  UiThemeChanged: "ui.theme.changed",
  /** Plugins proactively push panel data refreshes (`panel.data-changed`). */
  PanelDataChanged: "ui.panel.data-changed",
  /** Health */
  HealthRequest: "health.request"
};

// ../../REM2/dist/kernel/contracts/kernel-tokens.js
var KernelTokens = {
  EventBus: defineToken({
    id: "kernel.event-bus",
    describe: "global event bus"
  }),
  Config: defineToken({
    id: "kernel.config",
    describe: "read-only config access"
  }),
  ConfigService: defineToken({
    id: "kernel.config-service",
    describe: "config service (including provider management)"
  }),
  Log: defineToken({
    id: "kernel.log",
    describe: "log service"
  }),
  Metrics: defineToken({
    id: "kernel.metrics",
    describe: "metrics service"
  }),
  Tracer: defineToken({
    id: "kernel.tracer",
    describe: "tracing service (span collection and export)"
  }),
  Health: defineToken({
    id: "kernel.health",
    describe: "health service"
  }),
  Permissions: defineToken({
    id: "kernel.permissions",
    describe: "permission manager"
  }),
  Plugins: defineToken({
    id: "kernel.plugins",
    describe: "plugin registry view"
  }),
  Scheduler: defineToken({
    id: "kernel.scheduler",
    describe: "scheduler (replaceable via the scheduler.replace extension point)"
  }),
  Resolver: defineToken({
    id: "kernel.resolver",
    describe: "dependency resolver (replaceable via the resolver.replace extension point)"
  }),
  Discovery: defineToken({
    id: "kernel.discovery",
    describe: "plugin discovery"
  }),
  Loader: defineToken({
    id: "kernel.loader",
    describe: "plugin loader (replaceable via the loader.replace extension point)"
  }),
  CapabilityGuard: defineToken({
    id: "kernel.capability-guard",
    describe: "capability guard"
  }),
  Extensions: defineToken({
    id: "kernel.extensions",
    describe: "extension point registry"
  }),
  /**
   * Host-provided UI service: theme registry (catalog + active selection, behind the
   * host default implementation of the `ui.theme` slot).
   */
  UiThemeRegistry: defineToken({
    id: "host.ui.theme-registry",
    describe: "host theme registry",
    capability: "ui.theme"
  })
};

// src/constants.ts
var PLUGIN_ID = "com.rem2.theme-switcher";
var PLUGIN_NAME = "Theme Switcher";
var PLUGIN_VERSION = "1.0.0";
var PANEL_ID = "theme-switcher";
var ROUTE_PATH = "/theme";
var PANEL_COMMAND = "com.rem2.theme-switcher.data";
var PREFERENCES_RELATIVE_PATH = "data/preferences.json";
var UI_THEME_SET_TOPIC = Topics.UiThemeSet ?? "ui.theme.set";

// src/preferences.ts
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// src/types.ts
var THEME_MODES = ["light", "dark", "system"];

// src/preferences.ts
var PREFERENCES_VERSION = 1;
var DEFAULT_MODE = "system";
var DEFAULT_ACCENT = "#4f9cf9";
var ACCENT_PATTERN = /^#[0-9a-fA-F]{6}$/;
var DEFAULT_PREFERENCES = Object.freeze({
  version: PREFERENCES_VERSION,
  mode: DEFAULT_MODE,
  accent: DEFAULT_ACCENT
});
function isThemeMode(value) {
  return typeof value === "string" && THEME_MODES.includes(value);
}
function isAccent(value) {
  return typeof value === "string" && ACCENT_PATTERN.test(value);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizePreferences(raw) {
  if (!isRecord(raw)) return { ...DEFAULT_PREFERENCES };
  return {
    version: PREFERENCES_VERSION,
    mode: isThemeMode(raw.mode) ? raw.mode : DEFAULT_MODE,
    accent: isAccent(raw.accent) ? raw.accent : DEFAULT_ACCENT
  };
}
async function readPreferences(filePath) {
  try {
    return normalizePreferences(JSON.parse(await readFile(filePath, "utf8")));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
var tempCounter = 0;
function tempPathFor(filePath) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${++tempCounter}.tmp`
  );
}
async function writePreferencesAtomic(filePath, preferences) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = tempPathFor(filePath);
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify(normalizePreferences(preferences), null, 2)}
`,
      "utf8"
    );
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => void 0);
    throw error;
  }
}
var PreferencesStore = class {
  constructor(filePath) {
    this.filePath = filePath;
  }
  filePath;
  queue = Promise.resolve();
  load() {
    return readPreferences(this.filePath);
  }
  save(preferences) {
    const snapshot = normalizePreferences(preferences);
    const write = this.queue.then(
      () => writePreferencesAtomic(this.filePath, snapshot)
    );
    this.queue = write.then(
      () => void 0,
      () => void 0
    );
    return write;
  }
  /** Waits for all queued writes (used by onStop without surfacing prior failures). */
  flush() {
    return this.queue;
  }
};

// src/panel.ts
var MODE_OPTIONS = Object.freeze([
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" }
]);
function buildPanelFormData(mode, accent) {
  return {
    kind: "form",
    fields: [
      {
        id: "mode",
        label: "Mode",
        type: "select",
        value: mode,
        options: MODE_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label
        }))
      },
      {
        id: "accent",
        label: "Accent color",
        type: "color",
        value: accent
      }
    ]
  };
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parsePanelChange(payload) {
  if (!isRecord2(payload)) {
    return { ok: false, error: "change payload must be an object" };
  }
  const fieldId = payload.fieldId;
  if (typeof fieldId !== "string" || fieldId === "") {
    return { ok: false, error: "change payload requires a non-empty fieldId" };
  }
  if (fieldId !== "mode" && fieldId !== "accent") {
    return { ok: false, error: `unknown field: ${fieldId}` };
  }
  const value = payload.value;
  if (typeof value !== "string") {
    return { ok: false, error: `field ${fieldId} requires a string value` };
  }
  if (fieldId === "mode") {
    if (!isThemeMode(value)) {
      return {
        ok: false,
        error: `invalid mode: ${value} (expected light, dark, or system)`
      };
    }
    return { ok: true, change: { fieldId: "mode", value } };
  }
  if (!isAccent(value)) {
    return { ok: false, error: `invalid accent: ${value} (expected #RRGGBB)` };
  }
  return { ok: true, change: { fieldId: "accent", value } };
}

// src/themes.ts
var FONTS = {
  ui: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", "Fira Code", monospace'
};
var SPACING = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px"
};
var DARK_COLORS = Object.freeze({
  background: "#0f1115",
  surface: "#161922",
  text: "#e6e6e6",
  textMuted: "#9aa4b2",
  accent: "#4f9cf9",
  border: "#232838"
});
var LIGHT_COLORS = Object.freeze({
  background: "#f5f6f8",
  surface: "#ffffff",
  text: "#1b1f27",
  textMuted: "#5b6472",
  accent: "#2563eb",
  border: "#d9dee7"
});
function createThemeSet(initialAccent) {
  const lightColors = { ...LIGHT_COLORS };
  const darkColors = { ...DARK_COLORS };
  const systemColors = { ...DARK_COLORS };
  const themes = [
    {
      id: "light",
      mode: "light",
      colors: lightColors,
      fonts: FONTS,
      spacing: SPACING,
      followSystem: false
    },
    {
      id: "dark",
      mode: "dark",
      colors: darkColors,
      fonts: FONTS,
      spacing: SPACING,
      followSystem: false
    },
    {
      id: "system",
      mode: "system",
      colors: systemColors,
      fonts: FONTS,
      spacing: SPACING,
      followSystem: true
    }
  ];
  if (initialAccent !== void 0) {
    for (const theme of themes) theme.colors.accent = initialAccent;
  }
  const byMode = new Map(
    themes.map((theme) => [theme.id, theme])
  );
  return {
    themes,
    get: (mode) => byMode.get(mode),
    setAccent: (accent) => {
      for (const theme of themes) theme.colors.accent = accent;
    }
  };
}

// src/index.ts
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
function failureMessage(reply) {
  if (reply === false) return "host rejected the theme switch";
  if (isRecord3(reply) && reply.ok === false) {
    return typeof reply.error === "string" ? reply.error : "host rejected the theme switch";
  }
  return void 0;
}
var index_default = definePlugin(
  {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION
  },
  (ctx) => {
    const themes = createThemeSet();
    const store = new PreferencesStore(
      ctx.resolvePath(PREFERENCES_RELATIVE_PATH)
    );
    let mode = DEFAULT_MODE;
    let accent = DEFAULT_ACCENT;
    let unsubscribes = [];
    function panelData() {
      return buildPanelFormData(mode, accent);
    }
    function currentTheme() {
      return themes.get(mode);
    }
    function snapshot() {
      return { version: PREFERENCES_VERSION, mode, accent };
    }
    async function persist() {
      await store.save(snapshot());
    }
    async function emitPanelData() {
      await ctx.events.emit(Topics.PanelDataChanged, {
        panelId: PANEL_ID,
        data: panelData()
      });
    }
    async function requestTheme(next) {
      try {
        const reply = await ctx.events.request(UI_THEME_SET_TOPIC, { themeId: next });
        const failure = failureMessage(reply);
        return failure ? { ok: false, error: failure } : { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: `theme switch request failed: ${messageOf(error)}`
        };
      }
    }
    async function changeMode(next) {
      const result = await requestTheme(next);
      if (!result.ok) return result;
      mode = next;
      try {
        await persist();
      } catch (error) {
        return {
          ok: false,
          error: `failed to persist preferences: ${messageOf(error)}`
        };
      }
      await emitPanelData();
      return { ok: true };
    }
    async function changeAccent(next) {
      const previous = accent;
      accent = next;
      themes.setAccent(next);
      try {
        await persist();
      } catch (error) {
        accent = previous;
        themes.setAccent(previous);
        return {
          ok: false,
          error: `failed to persist preferences: ${messageOf(error)}`
        };
      }
      const theme = currentTheme();
      if (theme) await ctx.events.emit(Topics.UiThemeChanged, theme);
      await emitPanelData();
      return { ok: true };
    }
    async function handlePanelCommand(payload) {
      if (isRecord3(payload) && "kind" in payload) {
        if (typeof payload.kind !== "string") {
          return { ok: false, error: "invalid event kind" };
        }
        if (payload.kind !== "change") {
          return { ok: false, error: `unknown event: ${payload.kind}` };
        }
        const parsed = parsePanelChange(payload.payload);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        return parsed.change.fieldId === "mode" ? await changeMode(parsed.change.value) : await changeAccent(parsed.change.value);
      }
      return panelData();
    }
    async function handleThemeChanged(payload) {
      const themeId = typeof payload === "string" ? payload : isRecord3(payload) && typeof payload.id === "string" ? payload.id : void 0;
      if (!isThemeMode(themeId) || themeId === mode) return;
      mode = themeId;
      try {
        await persist();
      } catch (error) {
        ctx.log.warn(
          `Failed to persist theme choice: ${messageOf(error)}`
        );
      }
      await emitPanelData();
    }
    return {
      async onStart() {
        const saved = await store.load();
        mode = saved.mode;
        accent = saved.accent;
        themes.setAccent(accent);
        for (const theme of themes.themes) {
          ctx.extensions.contribute("ui.theme", {
            contributionId: theme.id,
            impl: theme
          });
        }
        ctx.extensions.contribute("ui.panel", {
          contributionId: PANEL_ID,
          impl: {
            panelId: PANEL_ID,
            title: PLUGIN_NAME,
            icon: "\u25D0",
            region: "main",
            order: 20,
            command: PANEL_COMMAND
          }
        });
        ctx.extensions.contribute("ui.route", {
          contributionId: ROUTE_PATH,
          impl: {
            path: ROUTE_PATH,
            title: "Theme",
            panelId: PANEL_ID,
            commandPrefix: "",
            order: 20
          }
        });
        unsubscribes.push(
          ctx.events.respond(PANEL_COMMAND, handlePanelCommand),
          ctx.events.on(Topics.UiThemeChanged, handleThemeChanged)
        );
        const applied = await requestTheme(mode);
        if (!applied.ok) {
          ctx.log.warn(`Saved theme mode was not applied: ${applied.error}`);
        }
        ctx.log.info(
          `Theme Switcher active (mode=${mode}, accent=${accent})`
        );
      },
      async onStop(hookCtx, reason) {
        for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
        await store.flush();
        hookCtx.log.info(`Theme Switcher stopped (${reason})`);
      }
    };
  }
);
export {
  index_default as default
};
