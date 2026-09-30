/**
 * Wiring check, in two halves.
 *
 * The first half reads the committed bundle and always runs: the brand and hero
 * seats are `single`, and the plugin has to take them without racing their
 * declarations or colliding with the shipped occupants — through the
 * declaration-aware occupant helper and at a shadowing priority.
 *
 * The second half inspects an installed profile — does the patch mount this
 * plugin, is the shipped brand row left mounted, does the mounted file exist.
 * That is environment, not source, so it is skipped with a notice when the
 * profile is absent or does not mention the plugin; a fresh clone stays green
 * while a configured machine still validates the seam the bundle cannot see.
 *
 * Point PROFILE at another profile directory to check a different one.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = process.env.PLUGIN ?? path.dirname(HERE)
const PROFILE =
  process.env.PROFILE ?? path.join(process.env.HOME ?? '.', '.dsh', 'profiles', 'desktop')

const source = fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8')
const BRAND_SEATS = ['sidebar.brand.mark', 'sidebar.brand.name', 'conversation.hero.brand.mark']

// ── the bundle: always checked ────────────────────────────────────────────
assert.ok(
  source.includes('BrandWordmark'),
  'the brand name renders the shipped wordmark rather than redrawing it'
)
// Every seat is filled through `occupy`, which waits for the declaration and
// registers at the shadowing priority: registering directly is the race that
// killed the boot, and the same-priority collision with ui-brand-official is
// the other fatal path (see test/slots.mjs for both, executed).
for (const seat of BRAND_SEATS) {
  assert.match(
    source,
    new RegExp(`occupy\\(ctx, '${seat.replaceAll('.', '\\.')}'`),
    `lib/client.js fills "${seat}" through the declaration-aware occupant helper`
  )
}
assert.ok(
  !/ctx\.slots\.register\(\s*\{\s*name: 'sidebar\.brand\.(mark|name)'/.test(source),
  'no brand seat is registered directly, without waiting for its declaration'
)
assert.match(
  source,
  /const SEAT_PRIORITY = -1/,
  'the occupants shadow the shipped ones instead of colliding at priority 0'
)
console.log('ok   bundle takes the brand row and the hero seat by shadowing, declaration-aware')

// ── the installed profile: checked when it is configured for this plugin ──
const patchPath = path.join(PROFILE, 'cordis.patch.yml')
if (!fs.existsSync(patchPath)) {
  console.log(`skip profile wiring — no patch at ${patchPath}`)
  process.exit(0)
}
const patch = fs.readFileSync(patchPath, 'utf8')
if (!/id:\s*dsh-theme-miku/.test(patch)) {
  console.log(`skip profile wiring — ${patchPath} does not mount dsh-theme-miku`)
  process.exit(0)
}

// Shadowing is the whole point: the theme renders over the shipped occupants,
// so the profile keeps every package it was composed with. A patch that stands
// `ui-brand-official` down is the older, fragile route — the theme row alone is
// enough, and a deployment that disables the official package loses the brand
// the moment the theme is switched off.
assert.doesNotMatch(
  patch,
  /ui-brand-official\s*\n\s*name:\s*"@deepseek-ai\/dsh-client-ui-brand-official"\s*\n\s*disabled:\s*true/,
  'the profile leaves ui-brand-official mounted — the theme shadows it, it does not need it disabled'
)

// The row must point at a host half that actually exists.
const mounted = patch.match(/id:\s*dsh-theme-miku\s*\n\s*name:\s*(\S+)/)
assert.ok(mounted, 'the plugin row names a module')
const target = mounted[1].replace(/^file:\/\//, '')
assert.ok(fs.existsSync(target), `the mounted module exists: ${target}`)

console.log(`ok   profile mounts the plugin at ${target} beside the shipped brand row`)
