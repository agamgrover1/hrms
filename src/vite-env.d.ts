/// <reference types="vite/client" />

// Injected by vite.config.ts via `define`. Reads the git commit SHA at
// build time so the runtime can compare it against /api/version and tell
// users a fresh deploy is available.
declare const __APP_VERSION__: string;
// Human-readable semver — "1.4", "2.0" etc. Displayed as-is in the
// sidebar footer so users can eyeball which release they're on without
// decoding a git hash.
declare const __APP_SEMVER__: string;
// UTC ISO of when this bundle was built. Displayed alongside the semver
// on the sidebar footer so users can eyeball freshness at a glance.
declare const __BUILD_DATE__: string;
