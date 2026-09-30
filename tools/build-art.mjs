#!/usr/bin/env node
/**
 * Build the plugin's inlined artwork.
 *
 * The Web client serves plugin bundles and nothing else under `/plugins`, so a
 * plugin cannot `<img src>` a file from its own directory. Artwork is therefore
 * inlined as a data URI into `lib/art.js`, which the build step splices into
 * `lib/client.js` — one bundle, no extra route, no fetch.
 *
 * Reads whatever exists in `art/` (see art/README.md for the names and the
 * prompts) and writes:
 *
 *   lib/art.js   generated module with the data URIs, or null per asset
 *   lib/client.js   rewritten with that module inlined
 *
 * Run with no arguments after dropping images in; assets that are absent leave
 * their slot on the built-in fallback, so this is safe to run at any time.
 *
 *   node tools/build-art.mjs
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.dirname(HERE)
const ART = path.join(PLUGIN, 'art')
const CLIENT_PATH = path.join(PLUGIN, 'lib', 'client.js')
const ART_MODULE_PATH = path.join(PLUGIN, 'lib', 'art.js')
const MARKER_START = '    // #region generated-art\n'
const MARKER_END = '    // #endregion generated-art\n'

/** Load `sharp` from wherever it is installed; the plugin ships no deps. */
function loadSharp() {
  const candidates = [
    path.join(PLUGIN, 'package.json'),
    path.join(process.env.DSH_PROFILE_DIR ?? path.join(process.env.HOME ?? '.', '.dsh', 'profiles'), 'package.json'),
    path.join(process.env.HOME ?? '.', '.dsh', 'profiles', 'node_modules', 'sharp', 'package.json')
  ]
  for (const candidate of candidates) {
    try {
      return createRequire(candidate)('sharp')
    } catch {
      /* try the next resolution base */
    }
  }
  return undefined
}

/**
 * What each asset is for, and how much of it the UI actually needs. `width` is
 * the largest size the interface renders it at, times a device-pixel allowance.
 */
const ASSETS = [
  {
    name: 'hero',
    // Fit by height: the hero slot hands down a height and the artwork keeps its
    // own aspect ratio, so the rendered height is what constrains the file.
    // Encoded at 2x the drawn height for retina, and trimmed of the ~50px of
    // transparent margin on each side that would otherwise be rendered as gap.
    file: ['hero.png'],
    trim: true,
    height: 256,
    quality: 86,
    note: 'new-session hero illustration (drawn 128px tall)'
  },
  {
    name: 'mark',
    // Both whole heads, cropped to the shipped mark's own proportions: the whale
    // fallback is 23.16:17.04 (1.36:1), so a 1.36:1 asset draws 24x17.6 in the
    // same box and leaves the brand row's geometry exactly as designed. The slot
    // has no square requirement — it hands down one box edge and the asset keeps
    // its own ratio.
    //
    // `crop` is in source pixels, read off a grid overlay, so a re-rendered
    // source needs it re-measured (the two heads span x 85..1160, y 118..909).
    file: ['mark.png'],
    crop: { left: 85, top: 118, width: 1075, height: 791 },
    width: 128,
    quality: 92,
    note: 'sidebar brand mark — both heads, at the shipped mark ratio (1.36:1)'
  },
  {
    name: 'wordmark',
    file: ['wordmark.png'],
    width: 900,
    quality: 88,
    note: 'sidebar brand wordmark'
  },
  {
    name: 'backdrop',
    file: ['bg-aurora.png'],
    width: 1800,
    quality: 74,
    note: 'stage-lighting backdrop'
  }
]

/** First candidate filename that exists, so a new drop-in wins over the sample. */
function findSource(asset) {
  for (const name of asset.file) {
    const candidate = path.join(ART, name)
    if (fs.existsSync(candidate)) return { path: candidate, name }
  }
  return undefined
}

/** Encode one artwork file as a WebP data URI at the size the UI needs. */
async function encode(sharp, asset) {
  const source = findSource(asset)
  if (source === undefined) return undefined
  const bound = asset.width === undefined ? { height: asset.height } : { width: asset.width }
  let pipeline = sharp(source.path)
  if (asset.trim === true) {
    // Trim only the fully transparent margin, then pad a hair back so anti-aliased
    // edges are not clipped.
    pipeline = pipeline.trim({ threshold: 1 })
  }
  if (asset.crop !== undefined) pipeline = pipeline.extract(asset.crop)
  const bytes = await pipeline
    .resize({ ...bound, withoutEnlargement: true })
    .webp({ quality: asset.quality, effort: 4 })
    .toBuffer()
  const meta = await sharp(bytes).metadata()
  return {
    uri: `data:image/webp;base64,${bytes.toString('base64')}`,
    width: meta.width,
    height: meta.height,
    sourceFile: source.name,
    sourceBytes: fs.statSync(source.path).size,
    bytes: bytes.length
  }
}

/**
 * Build the sidebar watermark: the hero illustration, faded upward so it rises
 * out of the bottom edge instead of ending on a hard horizontal line.
 *
 * The fade is baked into the alpha rather than applied with a CSS pseudo-element
 * or `opacity`, because a pseudo-element would paint over the sidebar's own
 * children (positioned descendants paint above in-flow content) and `opacity`
 * cannot target a background image alone. Baking it also lets each colour scheme
 * carry its own strength: the artwork is drawn with dark line art, which reads on
 * the light sidebar and largely disappears on the dark one.
 */
async function encodeSidebarArt(sharp, { file, width, peak }) {
  const source = path.join(ART, file)
  if (!fs.existsSync(source)) return undefined
  const resized = await sharp(source).trim({ threshold: 1 }).resize({ width }).png().toBuffer()
  const meta = await sharp(resized).metadata()
  const fade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}">` +
      '<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#fff" stop-opacity="0"/>' +
      `<stop offset="0.5" stop-color="#fff" stop-opacity="${(peak * 0.78).toFixed(3)}"/>` +
      `<stop offset="1" stop-color="#fff" stop-opacity="${peak}"/>` +
      '</linearGradient></defs>' +
      `<rect width="${meta.width}" height="${meta.height}" fill="url(#f)"/>` +
      '</svg>'
  )
  const bytes = await sharp(resized)
    // dest-in keeps the artwork where the gradient is opaque and multiplies the
    // artwork's own alpha by the gradient's, which is the fade.
    .composite([{ input: fade, blend: 'dest-in' }])
    // Quality tracks the alpha: at 50-58% the layer is legible enough that
    // compression would show, so it is encoded close to lossless again.
    .webp({ quality: 86, effort: 5 })
    .toBuffer()
  return { uri: `data:image/webp;base64,${bytes.toString('base64')}`, width: meta.width, height: meta.height, bytes: bytes.length }
}

/** Render the generated module text. */
function renderModule(built) {
  // `const`, not `export const`: the bundle inlines this body into a factory,
  // and the export statement lives at the end so stripping it leaves valid code.
  const entries = ASSETS.map((asset) => {
    const value = built[asset.name]
    if (value === undefined) return `  ${asset.name}: null,`
    return (
      `  /** ${value.width}x${value.height} — art/${value.sourceFile}. */\n` +
      `  ${asset.name}: { uri: ${JSON.stringify(value.uri)}, width: ${value.width}, height: ${value.height} },`
    )
  }).join('\n')
  const sidebar = built.sidebarArt
  const sidebarEntry =
    sidebar === undefined
      ? '  /** sidebar watermark — not supplied; the sidebar stays a flat surface. */\n  sidebarArt: null,'
      : '  /** sidebar watermark, one strength per colour scheme. */\n' +
        `  sidebarArt: { light: ${JSON.stringify(sidebar.light.uri)}, dark: ${JSON.stringify(sidebar.dark.uri)},` +
        ` width: ${sidebar.light.width}, height: ${sidebar.light.height} },`
  return `/**
 * GENERATED by tools/build-art.mjs — do not edit.
 *
 * Each value is a WebP data URI with its pixel size, or null when that artwork
 * has not been supplied. The size travels with the URI because the artwork is
 * not necessarily square and the slots hand down a single box dimension; the
 * bundle inlines this body, because the Web plugin route serves client bundles
 * only — a plugin cannot fetch a file from its own directory.
 */
const ART = {
${entries}
${sidebarEntry}
}

export { ART }
export default ART
`
}

/** Splice the generated module into the hand-written bundle. */
function weave(clientSource, moduleText) {
  const withoutOld = clientSource.replace(
    new RegExp(`${escapeRegExp(MARKER_START)}[\\s\\S]*?${escapeRegExp(MARKER_END)}`),
    ''
  )
  // The bundle is a factory body, not a module: the generated source keeps its
  // `export` statements for the file on disk, and they are stripped for inlining.
  const inlinable = moduleText
    .split('\n')
    .filter((line) => !line.startsWith('export '))
    .join('\n')
    .trimEnd()
  const block =
    MARKER_START +
    '    // Inlined by tools/build-art.mjs — edit that script, not this block.\n' +
    inlinable
      .split('\n')
      .map((line) => (line.length === 0 ? '' : `    ${line}`))
      .join('\n') +
    '\n' +
    MARKER_END
  const anchor = '    const React = require(\'react\')\n'
  if (!withoutOld.includes(anchor)) throw new Error('lib/client.js: the React require anchor moved; update tools/build-art.mjs')
  return withoutOld.replace(anchor, `${anchor}${block}`)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const sharp = loadSharp()
if (sharp === undefined) {
  console.error('build-art: cannot resolve `sharp`; install it in the profile or run this from a directory that can')
  process.exit(1)
}

const built = {}
for (const asset of ASSETS) built[asset.name] = await encode(sharp, asset)

// The sidebar watermark is derived from the hero artwork, so it follows whatever
// hero.png is supplied rather than being a separate asset to keep in sync.
// Peak alpha per scheme, and the asymmetry is the point: the artwork is drawn
// with dark line art, so it is legible on the light sidebar at a lower alpha
// than it is on the dark one, where only its pale areas survive. Equal values
// would look washed out in dark mode and heavy in light mode.
const SIDEBAR_ART = { file: 'hero.png', width: 720, peak: { light: 0.5, dark: 0.58 } }
if (fs.existsSync(path.join(ART, SIDEBAR_ART.file))) {
  built.sidebarArt = {
    light: await encodeSidebarArt(sharp, { ...SIDEBAR_ART, peak: SIDEBAR_ART.peak.light }),
    dark: await encodeSidebarArt(sharp, { ...SIDEBAR_ART, peak: SIDEBAR_ART.peak.dark })
  }
}

const moduleText = renderModule(built)
fs.writeFileSync(ART_MODULE_PATH, moduleText)

const clientSource = fs.readFileSync(CLIENT_PATH, 'utf8')
if (!clientSource.includes(MARKER_START)) {
  console.error('build-art: lib/client.js has no generated-art region to fill')
  process.exit(1)
}
fs.writeFileSync(CLIENT_PATH, weave(clientSource, moduleText))

const supplied = ASSETS.filter((asset) => built[asset.name] !== undefined)
for (const asset of ASSETS) {
  const value = built[asset.name]
  const label = value === undefined ? asset.file[0] : value.sourceFile
  if (value === undefined) console.log(`  –      ${label.padEnd(15)} not supplied (fallback in use)`)
  else console.log(`  built  ${label.padEnd(15)} ${value.width}x${value.height}  ${(value.bytes / 1024).toFixed(0)} KB inlined`)
}
if (built.sidebarArt !== undefined) {
  const { light, dark } = built.sidebarArt
  console.log(
    `  built  ${'sidebarArt'.padEnd(15)} ${light.width}x${light.height}  ` +
      `${(light.bytes / 1024).toFixed(0)} + ${(dark.bytes / 1024).toFixed(0)} KB (light + dark)`
  )
}
console.log(`build-art: wrote lib/art.js and wove ${supplied.length}/${ASSETS.length} assets into lib/client.js`)
