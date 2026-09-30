/**
 * Host half of `dsh-theme-miku`.
 *
 * The Miku theme is presentation-only, so the Node side adds no Host service,
 * row, or model-facing surface. It exists because a Cordis plugin package needs
 * a Node entry, and because this row is what `dsh-client-modules` scans: the
 * `dsh.client` declaration in `package.json` plus `exports["./client"]` turn
 * this one enabled Loader row into the browser bundle that registers the
 * palettes. Keeping the Host side inert means enabling or disabling the theme
 * never changes Sessions, storage, or tool declarations.
 *
 * @param ctx - owning Cordis context.
 */
export function apply(ctx) {
  ctx.effect(() => {
    ctx.logger?.debug?.('dsh-theme-miku: host half mounted; palette lives in the client half')
  }, 'dsh-theme-miku: host marker')
}

/** Nothing here is configurable on the Host side. */
export const name = 'dsh-theme-miku'
