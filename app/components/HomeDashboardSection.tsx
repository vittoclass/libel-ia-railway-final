"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { BookOpen, Camera, Scale, BarChart3, ChevronRight, Loader2 } from "lucide-react"
import {
  HOME_ACCESS_CARDS,
  filterHomeAccessCards,
  type HomeAccessCardVariant,
} from "@/app/lib/home-access-cards"
import { isMasterEmail } from "@/app/lib/master-access"

const VARIANT_STYLES: Record<
  HomeAccessCardVariant,
  { iconWrap: string; ringHover: string; shadowHover: string; Icon: typeof Camera }
> = {
  docente: {
    iconWrap: "bg-[#0c4a6e] text-white shadow-inner",
    ringHover: "hover:ring-cyan-400/35",
    shadowHover: "hover:shadow-cyan-900/15",
    Icon: Camera,
  },
  panel_docente: {
    iconWrap: "bg-emerald-800 text-white shadow-inner",
    ringHover: "hover:ring-emerald-400/40",
    shadowHover: "hover:shadow-emerald-900/20",
    Icon: BookOpen,
  },
  utp: {
    iconWrap: "bg-[#c2410c] text-white shadow-inner",
    ringHover: "hover:ring-orange-400/40",
    shadowHover: "hover:shadow-orange-900/20",
    Icon: Scale,
  },
  direccion: {
    iconWrap: "bg-[#3730a3] text-white shadow-inner",
    ringHover: "hover:ring-indigo-400/35",
    shadowHover: "hover:shadow-indigo-900/20",
    Icon: BarChart3,
  },
}

type JosefinClass = string

export function HomeDashboardSection({ josefinClass }: { josefinClass: JosefinClass }) {
  const [cardsReady, setCardsReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [isMaster, setIsMaster] = useState(false)
  const [profileRole, setProfileRole] = useState<string | null>(null)
  const [isAdminFromProfile, setIsAdminFromProfile] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const supabase = createClientComponentClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (cancelled) return
      if (!user) {
        setHasSession(false)
        setIsMaster(false)
        setProfileRole(null)
        setIsAdminFromProfile(false)
        setCardsReady(true)
        return
      }
      setHasSession(true)
      setIsMaster(isMasterEmail(user.email))
      try {
        const res = await fetch("/api/profile", { credentials: "include", cache: "no-store" })
        const j = (await res.json()) as {
          profile?: { role?: string | null } | null
          isAdmin?: boolean
        }
        if (cancelled) return
        const role = j?.profile?.role
        setProfileRole(typeof role === "string" ? role : null)
        setIsAdminFromProfile(j?.isAdmin === true)
      } catch {
        if (!cancelled) {
          setProfileRole(null)
          setIsAdminFromProfile(false)
        }
      } finally {
        if (!cancelled) setCardsReady(true)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const visibleCards = useMemo(
    () =>
      filterHomeAccessCards({
        cards: HOME_ACCESS_CARDS,
        profileRole,
        isMaster,
        isAdminFromProfile,
        hasSession,
      }),
    [profileRole, isMaster, isAdminFromProfile, hasSession],
  )

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:py-12">
      <p className="mb-6 text-center text-sm font-medium uppercase tracking-wider text-[#64748b]">
        Accesos rápidos
      </p>

      {cardsReady && isMaster ? (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-center text-sm text-emerald-900 shadow-sm">
          <strong>Modo creador Libelia</strong> — Tienes acceso inmediato a Docente, UTP y Dirección (sin depender del rol
          en base de datos).
        </div>
      ) : null}

      {!cardsReady && hasSession ? (
        <div className="flex min-h-[12rem] items-center justify-center gap-2 text-sm text-[#64748b]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Cargando accesos según tu perfil…
        </div>
      ) : visibleCards.length === 0 ? (
        <p className="rounded-xl border border-[#e2e8f0] bg-white px-4 py-8 text-center text-sm text-[#64748b]">
          No hay accesos rápidos para tu rol actual. Puedes seguir usando el evaluador o{" "}
          <Link href="/perfil" className="font-semibold text-[#0369a1] underline-offset-4 hover:underline">
            revisar tu perfil
          </Link>{" "}
          si necesitas otro rol asignado.
        </p>
      ) : (
        <div
          className={[
            "grid gap-6",
            visibleCards.length === 1 ? "max-w-md mx-auto" : "sm:grid-cols-2",
            visibleCards.length >= 3 ? "lg:grid-cols-3" : "",
            visibleCards.length >= 4 ? "xl:grid-cols-4" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {visibleCards.map((card) => {
            const styles = VARIANT_STYLES[card.variant]
            const Icon = styles.Icon
            return (
              <Link
                key={card.href}
                href={card.href}
                className={[
                  "group relative flex flex-col rounded-2xl border border-white/80 bg-white p-6 shadow-lg",
                  "transition-all duration-300 ease-out",
                  "hover:-translate-y-1 hover:shadow-2xl active:translate-y-0 active:scale-[0.99]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2",
                  styles.ringHover,
                  styles.shadowHover,
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-2xl" aria-hidden>
                    {card.emoji}
                  </span>
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${styles.iconWrap} transition-transform duration-300 group-hover:scale-110`}
                  >
                    <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
                  </span>
                </div>
                <div className="mt-4 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">{card.subtitle}</p>
                  <h2 className={`${josefinClass} mt-1 text-xl font-semibold text-[#0a1628]`}>{card.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[#475569]">{card.description}</p>
                </div>
                <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-[#0369a1] transition-colors group-hover:text-[#0c4a6e]">
                  Entrar
                  <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            )
          })}
        </div>
      )}

      <p className="mt-10 text-center text-sm text-[#64748b]">
        ¿Evaluación con IA y reportes?{" "}
        <Link
          href="/evaluar"
          className="font-semibold text-[#0369a1] underline-offset-4 hover:text-[#0c4a6e] hover:underline"
        >
          Ir al evaluador
        </Link>
      </p>
    </main>
  )
}
