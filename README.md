# REM2-plugins

Standalone plugin repository for REM2 (Kernel + Everything-as-Plugin) — plugins are developed, tested and built here, then installed into a REM2 (rem2-kernel) host. Nothing in this repository is part of REM2 itself.

## Plugins

### `theme-switcher` — `com.rem2.theme-switcher`

A single plugin that owns the theme catalog and its settings panel:

| Contribution | Detail |
| --- | --- |
| `ui.theme` | Three resident themes: `light`, `dark`, `system`. `light`/`dark` reuse the old `theme-dark` palettes; `system` carries `followSystem: true`. |
| `ui.panel` | Panel `theme-switcher`, served by the private topic `com.rem2.theme-switcher.data`. |
| `ui.route` | Route `/theme` → panel `theme-switcher`. |

Panel data is the generic form contract:

```ts
{
  kind: 'form',
  fields: [
    {
      id: 'mode',
      label: 'Mode',
      type: 'select',
      value: 'light' | 'dark' | 'system',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
      ],
    },
    { id: 'accent', label: 'Accent color', type: 'color', value: '#RRGGBB' },
  ],
}
```

The panel command also accepts `ui.event` requests of the shape
`{ kind: 'change', payload: { fieldId, value } }`:

- `mode` must be exactly `light` / `dark` / `system`; it is forwarded to the host via `ui.theme.set` (event topic `Topics.UiThemeSet`).
- `accent` must be exactly `#RRGGBB`; it rewrites the already-contributed palettes and emits `ui.theme.changed` for the active theme.
- Every successful update persists preferences and emits `ui.panel.data-changed`.
- Unknown events, unknown fields and invalid values return an explicit `{ ok: false, error }`.

Host-originated `ui.theme.changed` (for example a top-bar light/dark/system switch) is mirrored into preferences, so the panel and the host stay consistent.

#### Preferences

Stored at the plugin-relative path `data/preferences.json` (resolved with `ctx.resolvePath`):

```json
{ "version": 1, "mode": "system", "accent": "#4f9cf9" }
```

- Defaults: `mode: "system"`, `accent: "#4f9cf9"`.
- Missing file, corrupt JSON and invalid individual fields fall back to defaults (valid sibling fields are kept).
- Writes use a same-directory temp file plus `rename`, and each store serializes saves, so concurrent updates cannot interleave or leave temp files behind.
- The plugin never writes into this repository at test time; tests use OS temp directories and `.gitignore` also excludes `theme-switcher/data/`.

#### Kernel contract notes

This plugin is built against the current public `rem2-kernel` surface and expects these upcoming REM2 additions:

- `Topics.UiThemeSet` with value `ui.theme.set`. Until it is exported, `src/constants.ts` falls back to the literal value.
- `PanelFormData` / `PanelFormField` exported from `rem2-kernel`. Until then `src/types.ts` mirrors their contract exactly (swap to `import type` when available).
- A `system` theme mode and `followSystem` flag on the theme contracts. `ThemeDefinitionWithSystem` models that extension locally.

## Development

Prerequisites: Node.js >= 20 and pnpm >= 9.

```bash
pnpm install
pnpm test        # vitest run for every workspace package
pnpm typecheck   # tsc --noEmit
pnpm build       # esbuild bundle -> theme-switcher/dist/index.js
pnpm verify      # typecheck + test + build
```

Per-package:

```bash
pnpm --filter @rem2/plugin-theme-switcher test
pnpm --filter @rem2/plugin-theme-switcher typecheck
pnpm --filter @rem2/plugin-theme-switcher build
```

The `rem2-kernel` development dependency is a local link to the sibling `REM2` checkout (`link:../../REM2`). A `link:` dependency is used instead of `file:` because pnpm's `file:` packing honors REM2's `.gitignore`, which excludes the built `dist/kernel` that the package exports point at. If your kernel checkout lives elsewhere, update `theme-switcher/package.json` and re-run `pnpm install`.

The build bundles `rem2-kernel` into `dist/index.js` while keeping Node built-ins external (`node:*`), producing a self-contained Node 20 ESM entry — the same shape the kernel loader expects (`plugin.json` → `entry: dist/index.js`).

## Repository layout

```text
REM2-plugins/
├── package.json            # workspace scripts (test/typecheck/build/verify)
├── pnpm-workspace.yaml
├── .gitignore
├── LICENSE                 # MIT
└── theme-switcher/
    ├── plugin.json         # id com.rem2.theme-switcher, contributions
    ├── package.json
    ├── tsconfig.json
    ├── src/
    │   ├── constants.ts    # ids, topics, preferences path
    │   ├── types.ts        # theme/panel/preference contracts
    │   ├── preferences.ts  # validation, atomic serialized store
    │   ├── themes.ts       # light/dark/system token sets
    │   ├── panel.ts        # form data + strict change validation
    │   └── index.ts        # definePlugin wiring (lifecycle/events)
    ├── tests/              # unit + integration tests (temp dirs only)
    └── dist/index.js       # build artifact (committed/installable)
```

## Installing the plugin into REM2

1. Build it (`pnpm build`).
2. Copy `theme-switcher/plugin.json` and `theme-switcher/dist/index.js` into a plugin directory (the `dist/` folder must sit next to `plugin.json`).
3. Ensure the host grants the declared capabilities `ui.theme`, `ui.panel`, `ui.route` (a sandboxed user plugin needs explicit grants; the manifest always declares them).
4. The host must support the event-bus `ui.theme.set` topic and render the generic `form` panel shape.

## License

MIT. See [LICENSE](./LICENSE).
