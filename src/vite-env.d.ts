/// <reference types="vite/client" />

// Injected by vite.config.ts via `define`. Reads the git commit SHA at
// build time so the runtime can compare it against /api/version and tell
// users a fresh deploy is available.
declare const __APP_VERSION__: string;
// UTC ISO of when this bundle was built. Displayed alongside the version
// SHA on the sidebar footer so users can eyeball freshness at a glance.
declare const __BUILD_DATE__: string;
