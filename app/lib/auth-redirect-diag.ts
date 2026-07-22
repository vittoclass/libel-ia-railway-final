/**
 * TEMP DIAG (web-test only): safe auth-redirect tracing.
 * No tokens, codes, cookies, or secrets in logs.
 */

const SENSITIVE_QUERY = /^(code|token|access_token|refresh_token|id_token|provider_token|provider_refresh_token)$/i

export function hostnameOf(raw: string | null | undefined): string {
  if (!raw) return "(empty)"
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(withProto).hostname || "(empty)"
  } catch {
    return "(invalid)"
  }
}

/** Full request URL with OAuth secrets stripped from query. */
export function safeRequestUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const key of [...u.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) u.searchParams.set(key, "[redacted]")
    }
    return u.toString()
  } catch {
    return "(invalid-url)"
  }
}

export function envOriginHosts() {
  return {
    NEXT_PUBLIC_BASE_URL_host: hostnameOf(process.env.NEXT_PUBLIC_BASE_URL),
    APP_BASE_URL_host: hostnameOf(process.env.APP_BASE_URL),
    RAILWAY_PUBLIC_DOMAIN: (process.env.RAILWAY_PUBLIC_DOMAIN || "").trim() || "(empty)",
  }
}

export type AuthDiagPayload = {
  tag: string
  requestUrlSafe: string
  host: string | null
  xForwardedHost: string | null
  xForwardedProto: string | null
  nextUrlOrigin: string
  nextParam: string | null
  resolvedOrigin?: string
  locationFinal?: string
  hasCode?: boolean
  exchangeOk?: boolean | null
  exchangeErrorName?: string | null
} & ReturnType<typeof envOriginHosts>

export function logAuthDiag(payload: AuthDiagPayload): void {
  // Single JSON line for Railway log scrape
  console.info("[AUTH_REDIRECT_DIAG]", JSON.stringify(payload))
}
