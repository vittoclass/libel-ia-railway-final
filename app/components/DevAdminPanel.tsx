"use client"

import { useMemo, useState } from "react"
import { KeyRound, Zap } from "lucide-react"

type DevRole = "TEACHER" | "UTP" | "DIRECCION"

function writeCookie(name: string, value: string, seconds: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${seconds}; samesite=lax`
}

function readCookie(name: string): string | null {
  const raw = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${name}=`))
  if (!raw) return null
  return decodeURIComponent(raw.split("=")[1] ?? "")
}

export default function DevAdminPanel() {
  const [open, setOpen] = useState(false)
  const isDev = process.env.NODE_ENV === "development"
  const currentRole = useMemo(() => {
    if (!isDev || typeof document === "undefined") return null
    const v = readCookie("dev_role_override")
    if (!v) return null
    const up = v.trim().toUpperCase()
    return up === "TEACHER" || up === "UTP" || up === "DIRECCION" ? (up as DevRole) : null
  }, [isDev, open])

  if (!isDev) return null

  const applyRole = (role: DevRole) => {
    writeCookie("dev_role_override", role, 60 * 60 * 8)
    writeCookie("dev_override_enabled", "1", 60 * 60 * 8)
    window.location.reload()
  }

  return (
    <div className="fixed bottom-5 right-5 z-[100]">
      {open && (
        <div className="mb-3 w-56 rounded-xl border border-[var(--border-color)] bg-white shadow-xl p-3 space-y-2">
          <p className="text-xs text-[var(--text-muted)]">
            Llave maestra DEV {currentRole ? `· ${currentRole}` : ""}
          </p>
          <button
            className="w-full text-left rounded-md px-3 py-2 text-sm bg-slate-50 hover:bg-slate-100 border"
            onClick={() => applyRole("TEACHER")}
          >
            Ver como Profe
          </button>
          <button
            className="w-full text-left rounded-md px-3 py-2 text-sm bg-slate-50 hover:bg-slate-100 border"
            onClick={() => applyRole("UTP")}
          >
            Ver como UTP
          </button>
          <button
            className="w-full text-left rounded-md px-3 py-2 text-sm bg-slate-50 hover:bg-slate-100 border"
            onClick={() => applyRole("DIRECCION")}
          >
            Ver como Dirección
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label="Abrir panel de administración de desarrollo"
        onClick={() => setOpen((v) => !v)}
        className="h-11 w-11 rounded-full shadow-lg border border-[var(--border-color)] bg-gradient-to-br from-amber-400 to-yellow-500 text-white flex items-center justify-center"
      >
        {open ? <KeyRound className="h-5 w-5" /> : <Zap className="h-5 w-5" />}
      </button>
    </div>
  )
}
