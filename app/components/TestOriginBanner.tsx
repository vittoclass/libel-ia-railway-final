"use client"

/** TEMP DIAG: visible origin marker for web-test only. */
export function TestOriginBanner() {
  const host =
    typeof window !== "undefined" ? window.location.hostname : "async-evaluation-web-test-production.up.railway.app"

  return (
    <div
      data-testid="test-origin-banner"
      className="w-full border-b border-amber-600/40 bg-amber-500/15 px-3 py-2 text-center text-xs font-mono text-amber-950 dark:text-amber-100"
      role="status"
    >
      TEST ORIGIN: {host}
      <span className="mx-2 opacity-50">|</span>
      expected: async-evaluation-web-test-production.up.railway.app
    </div>
  )
}
