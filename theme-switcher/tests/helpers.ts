/**
 * Test doubles: a deterministic event bus plus a minimal PluginContext.
 * Tests never touch the real plugin `data/` directory; each uses an OS temp dir.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  EventBus,
  EventHandler,
  ExtensionContribution,
  ExtensionPointId,
  OnOptions,
  PluginContext,
  RequestOptions,
  Unsubscribe,
} from 'rem2-kernel'
import { PLUGIN_ID } from '../src/constants.js'

type AnyHandler = (payload: unknown) => unknown | Promise<unknown>

export interface EmittedEvent {
  topic: string
  payload: unknown
}

export interface RequestedCall {
  topic: string
  payload: unknown
}

export class TestEventBus implements EventBus {
  readonly emitted: EmittedEvent[] = []
  readonly requested: RequestedCall[] = []

  private readonly responders = new Map<string, AnyHandler>()
  private readonly handlers = new Map<string, Set<AnyHandler>>()

  async emit<T = unknown>(event: string, payload?: T): Promise<void> {
    this.emitted.push({ topic: event, payload })
    for (const handler of [...(this.handlers.get(event) ?? [])]) {
      await handler(payload)
    }
  }

  on<T = unknown>(
    pattern: string,
    handler: EventHandler<T>,
    _opts?: OnOptions,
  ): Unsubscribe {
    return this.addHandler(pattern, handler as unknown as AnyHandler)
  }

  once<T = unknown>(pattern: string, handler: EventHandler<T>): Unsubscribe {
    let active = true
    let unsubscribe: Unsubscribe = () => undefined
    const wrapper: AnyHandler = async payload => {
      if (!active) return
      active = false
      unsubscribe()
      await handler(payload as T)
    }
    unsubscribe = this.addHandler(pattern, wrapper)
    return unsubscribe
  }

  off(pattern: string, handler: (...args: never[]) => unknown): void {
    const wrapper = handler as unknown as AnyHandler
    const set = this.handlers.get(pattern)
    if (!set) return
    set.delete(wrapper)
    if (set.size === 0) this.handlers.delete(pattern)
  }

  async request<TReq = unknown, TRes = unknown>(
    topic: string,
    payload?: TReq,
    _opts?: RequestOptions,
  ): Promise<TRes> {
    this.requested.push({ topic, payload })
    const handler = this.responders.get(topic)
    if (!handler) throw new Error(`no responder for topic: ${topic}`)
    return (await handler(payload)) as TRes
  }

  respond<TReq = unknown, TRes = unknown>(
    topic: string,
    handler: (payload: TReq) => TRes | Promise<TRes>,
  ): Unsubscribe {
    const wrapper = handler as unknown as AnyHandler
    this.responders.set(topic, wrapper)
    return () => {
      if (this.responders.get(topic) === wrapper) this.responders.delete(topic)
    }
  }

  matching(pattern: string, event: string): boolean {
    if (pattern === event) return true
    if (pattern.endsWith('*')) return event.startsWith(pattern.slice(0, -1))
    return false
  }

  clear(): void {
    this.handlers.clear()
    this.responders.clear()
  }

  get listenerCount(): number {
    let count = 0
    for (const set of this.handlers.values()) count += set.size
    return count
  }

  get responderCount(): number {
    return this.responders.size
  }

  hasResponder(topic: string): boolean {
    return this.responders.has(topic)
  }

  emittedFor(topic: string): EmittedEvent[] {
    return this.emitted.filter(entry => entry.topic === topic)
  }

  requestedFor(topic: string): RequestedCall[] {
    return this.requested.filter(entry => entry.topic === topic)
  }

  private addHandler(pattern: string, wrapper: AnyHandler): Unsubscribe {
    let set = this.handlers.get(pattern)
    if (!set) {
      set = new Set()
      this.handlers.set(pattern, set)
    }
    set.add(wrapper)
    return () => {
      const current = this.handlers.get(pattern)
      if (!current) return
      current.delete(wrapper)
      if (current.size === 0) this.handlers.delete(pattern)
    }
  }
}

export interface ContributionRecord {
  point: ExtensionPointId
  contributionId: string
  impl: unknown
}

export interface TestContext {
  ctx: PluginContext
  bus: TestEventBus
  contributions: ContributionRecord[]
  logs: string[]
  rootDir: string
}

export function createTestContext(
  rootDir: string,
  bus: TestEventBus = new TestEventBus(),
): TestContext {
  const contributions: ContributionRecord[] = []
  const logs: string[] = []

  const log = {
    trace: (message: string) => logs.push(`trace:${message}`),
    debug: (message: string) => logs.push(`debug:${message}`),
    info: (message: string) => logs.push(`info:${message}`),
    warn: (message: string) => logs.push(`warn:${message}`),
    error: (message: string) => logs.push(`error:${message}`),
    fatal: (message: string) => logs.push(`fatal:${message}`),
  }

  const extensions = {
    contribute<T>(
      point: ExtensionPointId,
      contribution: ExtensionContribution<T>,
    ): void {
      contributions.push({
        point,
        contributionId: contribution.contributionId,
        impl: contribution.impl,
      })
    },
    retract(): void {
      // The kernel force-reclaims contributions on unload; tests do not need it.
    },
  }

  const ctx = {
    pluginId: PLUGIN_ID,
    manifest: {
      id: PLUGIN_ID,
      name: 'Theme Switcher',
      version: '1.0.0',
      entry: 'dist/index.js',
      compatibility: { minKernel: '^1.0.0', contractVersion: '1' },
    },
    phase: 'Start',
    container: {},
    services: {},
    events: bus,
    config: {},
    log,
    metrics: {},
    permissions: {
      pluginId: PLUGIN_ID,
      granted: ['ui.theme', 'ui.panel', 'ui.route'],
      denied: [],
      isGranted: () => true,
    },
    extensions,
    api: {},
    plugins: { all: () => [] },
    resolvePath: (relative: string): string =>
      path.resolve(rootDir, relative),
  } as unknown as PluginContext

  return { ctx, bus, contributions, logs, rootDir }
}

export async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix))
}

export async function removeTempDirs(dirs: string[]): Promise<void> {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
}
