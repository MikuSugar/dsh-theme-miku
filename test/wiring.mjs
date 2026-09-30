/**
 * Wiring check, in two halves.
 *
 * The first half reads the committed bundle and always runs: the brand slots are
 * `single`, and the plugin has to occupy both the mark and the name, because an
 * occupant suppresses the shell's fallback.
 *
 * The second half inspects an installed profile — does the patch mount this
 * plugin, does it stand the shipped brand row down, does the mounted file exist.
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
const mentions = (slot) =>
  source.includes(`name: '${slot}'`) || source.includes(`name: ${JSON.stringify(slot)}`)

// ── the bundle: always checked ────────────────────────────────────────────
assert.ok(mentions('sidebar.brand.mark'), 'lib/client.js registers an occupant for the brand mark')
assert.ok(mentions('sidebar.brand.name'), 'lib/client.js registers an occupant for the brand name')
assert.ok(
  mentions('conversation.hero.brand.mark'),
  'lib/client.js registers an occupant for the hero slot'
)
assert.ok(
  source.includes('BrandWordmark'),
  'the brand name renders the shipped wordmark rather than redrawing it'
)
console.log('ok   bundle occupies the brand row (mark + name) and the hero slot')

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

assert.match(
  patch,
  /id:\s*ui-brand-official\s*\n\s*name:\s*"@deepseek-ai\/dsh-client-ui-brand-official"\s*\n\s*disabled:\s*true/,
  'the profile patch stands the shipped brand row down beside the theme row'
)

// The row must point at a host half that actually exists.
const mounted = patch.match(/id:\s*dsh-theme-miku\s*\n\s*name:\s*(\S+)/)
assert.ok(mounted, 'the plugin row names a module')
const target = mounted[1].replace(/^file:\/\//, '')
assert.ok(fs.existsSync(target), `the mounted module exists: ${target}`)

console.log(`ok   profile mounts the plugin at ${target} with the brand row stood down`)
