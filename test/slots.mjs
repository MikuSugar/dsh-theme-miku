/**
 * Seat-occupancy harness: does `apply()` survive the composition's boot order?
 *
 * This is the check whose absence let a real boot die. The shipped registry
 * (`@deepseek-ai/dsh-client-ui-slots`, the `SlotCore` behind `ctx.slots`) throws
 * from two places this plugin reaches during activation:
 *
 *   - `register()` on a slot that is still **undeclared** —
 *     `slot "<name>" is not declared (a parent entry's children table must
 *     declare it)`. Plugin activation order is the composition's to choose, so a
 *     direct registration races whoever declares the slot.
 *   - `register()` into a **`single`** slot that already holds an entry at the
 *     same **priority** — `single slot "<name>" already has a registration at
 *     priority 0 … register at a different priority to shadow it (lowest
 *     renders)`. `sidebar.brand.mark`, `sidebar.brand.name` and
 *     `conversation.hero.brand.mark` are all `single`, and
 *     `@deepseek-ai/dsh-client-ui-brand-official` fills the two sidebar ones.
 *
 * A throw here is not a local failure: the browser boot reports "N entries did
 * not activate" and the shell answers with a crash dialog instead of the app.
 * The double below implements exactly those rules plus the declaration wait, so
 * every order the composition can produce is exercised offline:
 *
 *   1. seats declared before the plugin activates (the lucky order),
 *   2. seats declared after it (the race that actually happened),
 *   3. a shipped occupant already holding the sidebar brand seats,
 *   4. a drifted service: the theme mounts without the layer that failed rather
 *      than take the boot down with it.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = process.env.MIKU_BUNDLE ?? path.join(HERE, '..', 'lib', 'client.js')

/** Seats this plugin occupies, and the one it only registers a row into. */
const BRAND_SEATS = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']
const SETTINGS_SEAT = 'settings.general.item'
/** Priority the shipped `ui-brand-official` occupants register at. */
const SHIPPED_PRIORITY = 0

// ── the browser surface the bundle touches while it mounts ─────────────────
const head = []
const body = {
  attrs: {},
  setAttribute(name, value) {
    this.attrs[name] = String(value)
  },
  removeAttribute(name) {
    delete this.attrs[name]
  }
}
globalThis.document = {
  head: { appendChild: (node) => head.push(node) },
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  body
}
globalThis.window = { localStorage: { getItem: () => null, setItem: () => {} } }

const registry = new Map()
window.__ModuleLoader__ = { load: (entry) => registry.set(entry.id, entry) }
new Function('window', 'document', fs.readFileSync(BUNDLE, 'utf8'))(window, document)
const entry = registry.get('dsh-theme-miku')
assert.ok(entry, 'the bundle registers a module factory under its package name')

const plugin = entry.factory((request) => {
  if (request === 'react') {
    return { createElement: (type, props, ...children) => ({ type, props, children }) }
  }
  if (request === '@deepseek-ai/dsh-client-ui-primitives') {
    return { BrandWordmark: (props) => ({ type: 'BrandWordmark', props }) }
  }
  if (request === '@deepseek-ai/dsh-client-store') {
    return {
      defineStore: (decl) => ({
        create() {
          let state = decl.init()
          const actions = {}
          for (const key of Object.keys(decl.actions)) {
            actions[key] = (...params) => {
              const draft = structuredClone(state)
              decl.actions[key](draft, ...params)
              state = draft
            }
          }
          return { actions, getSnapshot: () => state, subscribe: () => () => {} }
        }
      })
    }
  }
  throw new Error(`unexpected require: ${request}`)
})

/**
 * The shipped registration rules, without forgiveness: undeclared seats throw,
 * same-priority `single` collisions throw, declarations notify their waiters
 * synchronously, and the lowest priority wins a `single` cell.
 */
function createSeats() {
  const records = new Map()
  const record = (key) => {
    let held = records.get(key)
    if (held === undefined) {
      held = { spec: undefined, entries: [], waiters: new Set() }
      records.set(key, held)
    }
    return held
  }
  return {
    /** Declare seats the way a parent entry's `children` table does. */
    declare(keys) {
      for (const key of keys) {
        const held = record(key)
        held.spec = { kind: key === SETTINGS_SEAT ? 'list' : 'single', scope: 'root' }
      }
      for (const key of keys) for (const waiter of [...record(key).waiters]) waiter()
    },
    /** Run `listener` on every declaration of `key` from now on. */
    onDeclare(key, listener) {
      const held = record(key)
      held.waiters.add(listener)
      return () => held.waiters.delete(listener)
    },
    isDeclared: (key) => record(key).spec !== undefined,
    entries: (key) => record(key).entries,
    /** The rendered winner of a `single` cell: lowest priority, first registered. */
    winner(key) {
      const held = record(key)
      if (held.spec?.kind !== 'single') return undefined
      return [...held.entries].sort((left, right) => left.options.priority - right.options.priority)[0]
    },
    register(options, component) {
      const held = record(options.name)
      if (held.spec === undefined) {
        throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`)
      }
      const priority = options.priority ?? 0
      if (held.spec.kind === 'single' && held.entries.some((heldEntry) => heldEntry.options.priority === priority)) {
        throw new Error(
          `single slot "${options.name}" already has a registration at priority ${priority} — register at a different priority to shadow it (lowest renders)`
        )
      }
      const occupant = { component, options: { ...options, priority } }
      held.entries.push(occupant)
      return () => {
        held.entries = held.entries.filter((heldEntry) => heldEntry !== occupant)
      }
    }
  }
}

/**
 * Run one mount of the plugin and report what it left behind.
 *
 * @param options.order - whether the seats are declared before or after apply.
 * @param options.shipped - whether `ui-brand-official` already holds the brand seats.
 * @param options.brokenTheme - make `overrideTokens` throw.
 * @param options.brokenSlots - make `slots.register` throw.
 */
function mount({ order, shipped, brokenTheme = false, brokenSlots = false }) {
  const seats = createSeats()
  const warnings = []
  const logged = console.warn
  console.warn = (...args) => warnings.push(args.map(String).join(' '))

  const effects = []
  const ctx = {
    effect(fn, label) {
      const disposer = fn()
      effects.push(disposer)
      return disposer
    },
    on: () => () => {},
    logger: { debug() {} },
    locale: {
      registered: new Set(),
      register(ns) {
        this.registered.add(ns)
        return () => this.registered.delete(ns)
      }
    },
    theme: {
      layers: new Map(),
      overrideTokens(source, tokens) {
        if (brokenTheme) throw new Error('theme service contract drifted')
        for (const [name, modes] of Object.entries(tokens)) {
          if (typeof modes?.light !== 'string' || typeof modes?.dark !== 'string') {
            throw new TypeError(`theme override "${name}" must map to a { light, dark } pair of strings`)
          }
        }
        this.layers.set(source, tokens)
        return () => this.layers.delete(source)
      },
      getTheme: () => ({
        preference: 'light',
        fontSize: 14,
        active: { id: 'light', colorScheme: 'light', tokens: {} },
        themes: [],
        revision: 0
      })
    },
    slots: {
      register: (options, component) => {
        if (brokenSlots) throw new Error('slot registry contract drifted')
        return seats.register(options, component)
      },
      /** The shipped wait: run now when declared, otherwise on the declaration. */
      inject(key, callback) {
        let active
        const run = () => {
          active?.()
          active = undefined
          if (!seats.isDeclared(key)) return
          active = ctx.effect(callback, `slots.inject(${JSON.stringify(key)}): declaration`)
        }
        const off = seats.onDeclare(key, run)
        run()
        return () => {
          off()
          active?.()
        }
      }
    }
  }

  const occupyShipped = () => {
    if (!shipped) return
    for (const seat of BRAND_SEATS.slice(0, 2)) {
      seats.register({ name: seat, priority: SHIPPED_PRIORITY }, () => null)
    }
  }
  if (order === 'declared') {
    seats.declare([...BRAND_SEATS, SETTINGS_SEAT])
    occupyShipped()
  }

  let error
  try {
    plugin.apply(ctx)
  } catch (thrown) {
    error = thrown
  }

  if (order === 'undeclared') {
    seats.declare([...BRAND_SEATS, SETTINGS_SEAT])
    occupyShipped()
  }

  console.warn = logged
  return { ctx, seats, error, warnings }
}

let failures = 0
const check = (label, actual, expected) => {
  try {
    assert.deepEqual(actual, expected)
    console.log('ok  ', label)
  } catch {
    failures += 1
    console.log('FAIL', label, '\n     got ', JSON.stringify(actual), '\n     want', JSON.stringify(expected))
  }
}

for (const order of ['declared', 'undeclared']) {
  for (const shipped of [false, true]) {
    const situation = `seats ${order}${shipped ? ', shipped occupant mounted' : ''}`
    const { ctx, seats, error, warnings } = mount({ order, shipped })
    check(`mounts: ${situation}`, error, undefined)
    check(`no layer lost: ${situation}`, warnings, [])
    for (const seat of BRAND_SEATS) {
      const winner = seats.winner(seat)
      check(
        `wins "${seat}": ${situation}`,
        [seats.entries(seat).length, winner?.options.priority],
        [shipped && seat.startsWith('sidebar') ? 2 : 1, -1]
      )
    }
    check(
      `registers its settings row: ${situation}`,
      seats.entries(SETTINGS_SEAT).map((occupied) => [occupied.options.id, occupied.options.order]),
      [['miku-theme', 12]]
    )
    check(`stacks the palette: ${situation}`, [...ctx.theme.layers.keys()], ['dsh-theme-miku'])
    check(`registers its copy: ${situation}`, [...ctx.locale.registered], ['settings.miku'])
  }
}

// A drifted service costs its own layer, never the boot: the failure is reported
// as a console warning and every other layer still mounts.
{
  const broken = mount({ order: 'declared', shipped: true, brokenTheme: true })
  check('a drifted theme service does not throw', broken.error, undefined)
  check('a drifted theme service is reported once', broken.warnings.length, 1)
  check('a drifted theme service still registers the row', broken.seats.entries(SETTINGS_SEAT).length, 1)
  check('a drifted theme service stacks no layer', broken.ctx.theme.layers.size, 0)
  check('a drifted theme service still fills the seats', BRAND_SEATS.map((seat) => broken.seats.winner(seat)?.options.priority), [-1, -1, -1])
}
{
  const broken = mount({ order: 'declared', shipped: true, brokenSlots: true })
  check('a drifted slot registry does not throw', broken.error, undefined)
  check('a drifted slot registry still stacks the palette', [...broken.ctx.theme.layers.keys()], ['dsh-theme-miku'])
  check('a drifted slot registry reports every lost seat', broken.warnings.length, 4)
}

console.log(failures === 0 ? '\nSEATS: every boot order survives' : `\nSEATS: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
