import { connect } from './bridge'
import { mountUI, type Options } from './ui'

export type { Options }
export { capture, type SnapshotRecord } from './snapshot'

declare global {
  interface Window {
    __yoyo?: boolean
  }
}

/** Mount the toolbar and shortcuts. Safe to call more than once. A bare import calls it with defaults. */
export function init(opts: Options = {}) {
  // Split view loads the app in an iframe; don't nest another yoyo inside it.
  if (typeof window === 'undefined' || window !== window.top || window.__yoyo) return
  window.__yoyo = true // on window so it survives HMR re-evaluating this module
  const api = mountUI(opts)
  if (opts.cli !== false) connect(api, opts.cli ?? 7357)
}

// Deferred one task so `import('@northlite/yoyo').then(m => m.init({...}))` wins over the default.
if (typeof window !== 'undefined') setTimeout(() => init())
