/**
 * Behavioural harness for the Miku theme client bundle.
 *
 * Runs the bundle the way the browser module system does and drives it against
 * a stand-in theme service implementing the documented contract:
 *
 *   - `overrideTokens` with the real validation and disposal rules
 *   - override layers composed onto the active definition, per scheme
 *   - `setTheme` publishing synchronously, unknown ids throwing
 *   - `prefers-color-scheme` owned by the service, which re-resolves `system`
 *
 * Every assertion is about something the user can observe: which scheme the
 * service resolved, whether the Miku tokens are applied, whether the scoped
 * stylesheet is armed, and what the plugin remembers for the next mount.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'

const BUNDLE = process.env.MIKU_BUNDLE ?? new URL('../lib/client.js', import.meta.url).pathname

// ── the browser surface the bundle touches ──────────────────────────────────
const storage = new Map()
const body = {
  attrs: {},
  setAttribute(name, value) {
    this.attrs[name] = String(value)
  },
  removeAttribute(name) {
    delete this.attrs[name]
  }
}
const head = []
globalThis.document = {
  head: { appendChild: (node) => head.push(node) },
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  body
}
globalThis.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  }
}
let prefersDark = true
/** Media listeners registered against the dark-scheme query this boot. */
let schemeListeners = new Set()
globalThis.matchMedia = (query) => ({
  matches: query.includes('dark') ? prefersDark : false,
  addEventListener: (type, listener) => {
    if (type === 'change') schemeListeners.add(listener)
  },
  removeEventListener: (type, listener) => {
    if (type === 'change') schemeListeners.delete(listener)
  }
})

const registry = new Map()
globalThis.window.__ModuleLoader__ = { load: (entry) => registry.set(entry.id, entry) }
new Function('window', 'document', 'matchMedia', fs.readFileSync(BUNDLE, 'utf8'))(
  globalThis.window,
  globalThis.document,
  globalThis.matchMedia
)

const entry = registry.get('dsh-theme-miku')
assert.ok(entry, 'the bundle registered a module factory under its package name')

const requested = []
const moduleExports = entry.factory((request) => {
  requested.push(request)
  if (request === 'react') {
    return {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useRef: (initial) => ({ current: initial })
    }
  }
  if (request === '@deepseek-ai/dsh-client-ui-primitives') {
    // Platform seed module: only the wordmark is used.
    return { BrandWordmark: (props) => ({ type: 'BrandWordmark', props }) }
  }
  if (request === '@deepseek-ai/dsh-client-store') {
    // The engine contract: a handle whose create() yields actions plus snapshot.
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

assert.deepEqual(
  requested,
  ['react', '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-primitives'],
  'requires exactly its declared modules'
)

// Slot occupancy follows artwork availability. A registered occupant replaces
// the shell's fallback even when it renders nothing, so an unconditional
// registration would blank the sidebar brand name.
//
// The double is strict about the two rules the shipped registry enforces, so
// this block cannot pass on wiring that would throw in a real boot: a seat must
// be declared before it is registered, and a `single` seat takes one entry per
// priority. Declared here, occupied by a stand-in for `ui-brand-official`, so
// the plugin has to shadow rather than collide.
{
  const declared = new Set(['settings.general.item', 'conversation.hero.brand.mark'])
  const occupied = new Map()
  for (const seat of ['sidebar.brand.mark', 'sidebar.brand.name']) {
    declared.add(seat)
    occupied.set(seat, new Set([0]))
  }
  const registered = []
  const ctx = {
    slots: {
      register: (definition, component) => {
        if (!declared.has(definition.name)) {
          throw new Error(`slot "${definition.name}" is not declared`)
        }
        const priority = definition.priority ?? 0
        const cells = occupied.get(definition.name) ?? new Set()
        if (cells.has(priority)) {
          throw new Error(`single slot "${definition.name}" already has a registration at priority ${priority}`)
        }
        cells.add(priority)
        occupied.set(definition.name, cells)
        registered.push([definition.name, priority, component])
      },
      inject: (key, callback) => {
        if (declared.has(key)) callback()
      }
    },
    theme: { overrideTokens: () => () => {} },
    effect: (fn) => fn(),
    on: () => () => {},
    locale: { register() {} }
  }
  moduleExports.apply(ctx)
  // The settings row is a separate seat that is always contributed. Each brand
  // seat is taken only when there is artwork for it, since occupying a `single`
  // seat suppresses the shell's fallback — registering without an image would
  // leave the row emptier than the shipped occupant did. The mark is taken and
  // the name is not: the whale is replaced while "deepseek HARNESS" stays.
  const slots = registered
    .filter(([name]) => name !== 'settings.general.item')
    .map(([name]) => name)
    .sort()
  const expected = []
  if (moduleExports.ART.mark !== null) {
    // The two sidebar seats move together: they are one brand row, so
    // contributing one half would leave the other with the shipped occupant.
    expected.push('sidebar.brand.mark', 'sidebar.brand.name')
  }
  if (moduleExports.ART.hero !== null) expected.push('conversation.hero.brand.mark')
  assert.deepEqual(slots, expected.sort(), 'occupies exactly the brand seats it has artwork for')
  for (const [name, priority] of registered) {
    if (name === 'settings.general.item') continue
    assert.equal(priority, -1, `${name} shadows the shipped occupant instead of colliding with it`)
  }
  assert.ok(
    registered.some(([name]) => name === 'settings.general.item'),
    'always contributes its settings row'
  )
}
assert.deepEqual(moduleExports.inject, ['theme', 'slots', 'locale'], 'declares its service dependencies')
assert.equal(typeof moduleExports.apply, 'function', 'exports apply')
assert.ok(moduleExports.OVERRIDES, 'exports the token layer for inspection')

// ── the token layer must satisfy the service's own validation ──────────────
{
  const names = Object.keys(moduleExports.OVERRIDES)
  assert.ok(names.length > 100, `layer carries the full palette (${names.length} tokens)`)
  for (const [name, modes] of Object.entries(moduleExports.OVERRIDES)) {
    assert.match(name, /^--/, `token ${name} is a custom property`)
    assert.equal(typeof modes.light, 'string', `${name} has a light value`)
    assert.equal(typeof modes.dark, 'string', `${name} has a dark value`)
    // Palette entries are colours; the sidebar watermark is a url() image, which
    // the service accepts just as readily as any other CSS value.
    if (name === '--miku-sidebar-art') {
      assert.match(modes.light, /^url\('data:image\//, 'watermark light value is an inlined image')
      assert.match(modes.dark, /^url\('data:image\//, 'watermark dark value is an inlined image')
      assert.notEqual(modes.light, modes.dark, 'the two schemes carry different strengths')
      continue
    }
    assert.match(modes.light, /^#|^color-mix\(/, `${name} light value is a CSS color`)
    assert.match(modes.dark, /^#|^color-mix\(/, `${name} dark value is a CSS color`)
  }
  // The accents are deliberately the same in both schemes; the surfaces and
  // text are not, and those are what would break if the tables were swapped.
  for (const name of ['--dsw-alias-bg-base', '--dsw-alias-label-primary', '--dsw-specific-sidebar-fill']) {
    assert.notEqual(moduleExports.OVERRIDES[name].light, moduleExports.OVERRIDES[name].dark, `${name} differs per scheme`)
  }
  assert.equal(moduleExports.OVERRIDES['--dsw-static-blue-450'].light, '#39c5cf', 'Miku teal is the shared accent')
}

// ── one boot: a fresh theme service and a fresh composition ────────────────
/** Effects of the boot that is currently mounted, so a reboot can retract it. */
let liveEffects = []
function boot() {
  // A page has one composition at a time: retract the previous one first, or
  // its root attribute would outlive it and the next boot would read as armed
  // before it ever ran.
  for (const disposer of [...liveEffects].reverse()) disposer?.()
  liveEffects = []
  schemeListeners = new Set()
  const themes = [
    { id: 'light', colorScheme: 'light', tokens: {} },
    { id: 'dark', colorScheme: 'dark', tokens: {} }
  ]
  /** Override layers by source, as ThemeRuntime holds them. */
  const layers = new Map()
  let preference = 'system'
  let revision = 0
  const byEvent = new Map()
  const emit = (event, payload) => {
    for (const listener of [...(byEvent.get(event) ?? [])]) listener(payload)
  }
  const snapshot = () => {
    const scheme = preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference
    const base = themes.find((theme) => theme.id === scheme)
    if (!base) throw new Error(`theme registry lost "${scheme}"`)
    const tokens = { ...base.tokens }
    for (const layer of [...layers.values()].sort((left, right) => left.seq - right.seq)) {
      for (const [name, modes] of Object.entries(layer.tokens)) tokens[name] = modes[base.colorScheme]
    }
    return Object.freeze({
      preference,
      fontSize: 14,
      active: Object.freeze({ ...base, tokens: Object.freeze(tokens) }),
      themes: Object.freeze([...themes]),
      revision
    })
  }
  const publish = () => {
    revision += 1
    emit('theme/change', snapshot())
  }
  const theme = {
    getTheme: snapshot,
    setTheme(id) {
      if (id !== 'system' && !themes.some((candidate) => candidate.id === id)) {
        throw new Error(`theme "${id}" is not registered`)
      }
      if (preference === id) return
      preference = id
      publish()
    },
    register(definition) {
      if (themes.some((candidate) => candidate.id === definition.id)) {
        throw new Error(`theme "${definition.id}" is already registered`)
      }
      themes.push(definition)
      layers.set(definition.id, {
        seq: layers.size,
        tokens: Object.fromEntries(Object.entries(definition.tokens).map(([name, value]) => [name, { light: value, dark: value }]))
      })
      publish()
      return () => {
        const index = themes.findIndex((candidate) => candidate.id === definition.id)
        if (index < 0) return
        themes.splice(index, 1)
        layers.delete(definition.id)
        if (preference === definition.id) preference = 'system'
        publish()
      }
    },
    overrideTokens(source, tokens) {
      const validated = {}
      for (const [name, modes] of Object.entries(tokens)) {
        if (typeof modes === 'string') {
          throw new TypeError(`theme override "${name}" from "${source}" is a bare string — pass { light, dark }`)
        }
        if (typeof modes?.light !== 'string' || typeof modes?.dark !== 'string') {
          throw new TypeError(`theme override "${name}" must map to a { light, dark } pair`)
        }
        validated[name] = { light: modes.light, dark: modes.dark }
      }
      const layer = { seq: layers.size, tokens: validated }
      layers.set(source, layer)
      publish()
      return () => {
        if (layers.get(source) !== layer) return
        layers.delete(source)
        publish()
      }
    }
  }
  // The service owns the OS query and re-resolves `system` on a flip.
  schemeListeners.add(() => {
    if (preference === 'system') publish()
  })
  let slot
  const effects = []
  // The seats this plugin fills are declared by other packages, and the two
  // sidebar brand seats already hold the shipped occupant: the double enforces
  // both rules, so a boot that would throw in the shell throws here first.
  const declared = new Set([
    'settings.general.item',
    'sidebar.brand.mark',
    'sidebar.brand.name',
    'conversation.hero.brand.mark'
  ])
  const claimed = new Set(['sidebar.brand.mark:0', 'sidebar.brand.name:0'])
  const ctx = {
    theme,
    effect(fn) {
      const disposer = fn()
      effects.push(disposer)
      return disposer
    },
    on(event, listener) {
      const set = byEvent.get(event) ?? new Set()
      set.add(listener)
      byEvent.set(event, set)
      return () => set.delete(listener)
    },
    locale: { register() {} },
    slots: {
      inject(key, callback) {
        if (declared.has(key)) callback()
      },
      register(definition, component) {
        if (!declared.has(definition.name)) {
          throw new Error(`slot "${definition.name}" is not declared`)
        }
        const cell = `${definition.name}:${definition.priority ?? 0}`
        if (claimed.has(cell)) {
          throw new Error(`single slot "${definition.name}" already has a registration at priority ${definition.priority ?? 0}`)
        }
        claimed.add(cell)
        if (definition.name === 'settings.general.item') slot = definition
      }
    }
  }
  moduleExports.apply(ctx)
  liveEffects = effects
  // The kit binds the registered store handle to an instance and hands its
  // actions to `inject`, whose return value becomes the row's extra props.
  const instance = slot.store.create()
  return {
    theme,
    extras: slot.inject(instance.actions),
    store: instance,
    dispose: () => {
      for (const disposer of [...effects].reverse()) disposer?.()
    }
  }
}

// ── what the user can observe ─────────────────────────────────────────────
const ACCENTS = new Set(['#39c5cf', '#2b9fae'])
const state = (booted) => {
  const view = booted.theme.getTheme()
  return {
    scheme: view.active.colorScheme,
    preference: view.preference,
    miku: ACCENTS.has(view.active.tokens['--dsw-static-blue-450']),
    attr: body.attrs['data-dsh-miku'] ?? null,
    remembered: storage.get('dsh-theme-miku:enabled') ?? null
  }
}
let failures = 0
const check = (label, actual, expected) => {
  try {
    assert.deepEqual(actual, expected)
    console.log('ok  ', label, JSON.stringify(actual))
  } catch {
    failures += 1
    console.log('FAIL', label, '\n     got ', JSON.stringify(actual), '\n     want', JSON.stringify(expected))
  }
}
const MIKU = true
const PLAIN = false
const flip = (dark) => {
  prefersDark = dark
  for (const listener of [...schemeListeners]) listener({ matches: dark })
}

storage.clear(); prefersDark = true
check('mount in dark OS', state(boot()), { scheme: 'dark', preference: 'system', miku: MIKU, attr: '', remembered: null })

storage.clear(); prefersDark = false
check('mount in light OS', state(boot()), { scheme: 'light', preference: 'system', miku: MIKU, attr: '', remembered: null })

storage.set('dsh-theme-miku:enabled', '0'); prefersDark = true
check('remembered opt-out', state(boot()), { scheme: 'dark', preference: 'system', miku: PLAIN, attr: null, remembered: '0' })

storage.clear(); prefersDark = true
const toggled = boot()
toggled.extras.toggle()
check('toggle off', state(toggled), { scheme: 'dark', preference: 'system', miku: PLAIN, attr: null, remembered: '0' })
toggled.extras.toggle()
check('toggle back on', state(toggled), { scheme: 'dark', preference: 'system', miku: MIKU, attr: '', remembered: '1' })

// The point of layering: the built-in preference is never written, so a
// `system` preference keeps tracking the OS in both directions.
storage.clear(); prefersDark = true
const following = boot()
flip(false)
check('OS flip to light', state(following), { scheme: 'light', preference: 'system', miku: MIKU, attr: '', remembered: null })
flip(true)
check('OS flip back to dark', state(following), { scheme: 'dark', preference: 'system', miku: MIKU, attr: '', remembered: null })

storage.clear(); prefersDark = true
const cubes = boot()
cubes.theme.setTheme('light') // what the Appearance Light cube does
check('Appearance cube -> light', state(cubes), { scheme: 'light', preference: 'light', miku: MIKU, attr: '', remembered: null })

storage.clear(); prefersDark = true
const off = boot()
off.extras.toggle()
off.theme.setTheme('light')
check('scheme change while off', state(off), { scheme: 'light', preference: 'light', miku: PLAIN, attr: null, remembered: '0' })

storage.clear(); prefersDark = true
const disposed = boot()
disposed.dispose()
check('plugin disposed', state(disposed), { scheme: 'dark', preference: 'system', miku: PLAIN, attr: null, remembered: null })

// The row store mirrors the flag and the resolved scheme for its own render.
storage.clear(); prefersDark = false
const row = boot()
row.store.actions.sync(row.theme.getTheme())
check('row store', row.store.getSnapshot(), {
  enabled: true,
  backdrop: true,
  palette: 'light',
  revision: row.theme.getTheme().revision
})

// ── stage lighting is its own switch, and follows the theme switch ─────────
storage.clear(); prefersDark = true
const lit = boot()
check('lighting armed on mount', body.attrs['data-dsh-miku-bg'], '')
lit.extras.toggleBackdrop()
check('lighting off', [body.attrs['data-dsh-miku-bg'] ?? null, storage.get('dsh-theme-miku:backdrop')], [null, '0'])
check('palette stays on with lighting off', lit.theme.getTheme().active.tokens['--dsw-static-blue-450'], '#39c5cf')
lit.extras.toggle()
check('theme off also clears the lighting attribute', body.attrs['data-dsh-miku-bg'] ?? null, null)

storage.set('dsh-theme-miku:backdrop', '0'); storage.set('dsh-theme-miku:enabled', '1')
check('remembered lighting opt-out', boot().theme.getTheme().active.colorScheme !== undefined && (body.attrs['data-dsh-miku-bg'] ?? null), null)

console.log(failures === 0 ? '\nJOURNEY: all behaviours correct' : `\nJOURNEY: ${failures} failure(s)`)
process.exit(failures === 0 ? 0 : 1)
