#!/bin/bash
# Offline self-test for the dsh-theme-miku plugin: no browser, no DSH process.
#
#   ./test/verify.sh
#
# Checks that both halves parse, that package.json declares the browser half the
# way the module system expects, that the token layer satisfies the theme
# service's own `{ light, dark }` validation, and that every behaviour a user can
# observe holds (mount, toggle, OS-scheme flip, Appearance cubes, disposal).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$(dirname "$HERE")"
export PLUGIN
# An explicit PROFILE wins, then the launcher's own variable, then the default.
# The profile half of the checks skips itself when the patch is absent, so this
# is only consulted, never required.
PROFILE="${PROFILE:-${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}}"
export PROFILE
fail=0
step() { printf '\n=== %s ===\n' "$1"; }

step "bundles parse"
for f in "$PLUGIN/lib/index.js" "$PLUGIN/lib/client.js"; do
  if node --check "$f"; then echo "ok   $f"; else echo "FAIL $f"; fail=1; fi
done

step "package metadata"
node -e '
const assert = require("node:assert/strict")
const pkg = require(process.env.PLUGIN + "/package.json")
assert.equal(pkg.type, "module")
assert.ok(pkg.exports["."].default, "exports the host half")
assert.ok(pkg.exports["./client"].default, "exports the browser half")
assert.equal(pkg.dsh.client.platform, "web")
assert.ok(pkg.dsh.client.inject.includes("@deepseek-ai/dsh-client-ui-theme"), "loads after ui-theme")
assert.deepEqual(pkg.dsh.client.external, [
  "@deepseek-ai/dsh-client-store",
  "@deepseek-ai/dsh-client-ui-primitives",
], "declares the store engine and the wordmark component it is seeded")
assert.equal(pkg.dsh.bundle, undefined, "mounted as a profile row, not a bundle")
// The module-loader id must match the package name the scanner derives.
const name = pkg.name
const bundle = require("node:fs").readFileSync(process.env.PLUGIN + "/lib/client.js", "utf8")
assert.ok(bundle.includes(`id: ${JSON.stringify(name)}`) || bundle.includes(`id: \x27${name}\x27`),
  `client bundle registers under "${name}"`)
console.log("ok   package.json + bundle id agree")
'

step "client behaviour"
node "$HERE/behaviour.mjs" || fail=1

step "seat occupancy across boot orders"
node "$HERE/slots.mjs" || fail=1

step "brand occupants and profile wiring"
node "$HERE/wiring.mjs" || fail=1

step "host half mounts and disposes"
node --input-type=module -e '
import assert from "node:assert/strict"
const mod = await import(process.env.PLUGIN + "/lib/index.js")
assert.equal(typeof mod.apply, "function")
const effects = []
mod.apply({ effect: (fn) => { const d = fn(); effects.push(d); return d }, logger: { debug() {} } })
assert.equal(effects.length, 1, "registers exactly one effect")
for (const dispose of effects.reverse()) dispose?.()
console.log("ok   host half is inert and cleanly disposable")
' || fail=1

printf '\n%s\n' "$([ $fail -eq 0 ] && echo 'ALL CHECKS PASSED' || echo 'SOME CHECKS FAILED')"
exit $fail
