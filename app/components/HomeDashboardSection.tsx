"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { Camera, Scale, BarChart3, ChevronRight } from "lucide-react"
import { HOME_ACCESS_CARDS, type HomeAccessCardVariant } from "@/app/lib/home-access-cards"
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
  const [sessionReady, setSessionReady] = useState(false)
  const [isMaster, setIsMaster] = useState(false)

  useEffect(() => {
    const supabase = createClientComponentClient()
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        setIsMaster(isMasterEmail(user?.email))
      })
      .catch(() => setIsMaster(false))
      .finally(() => setSessionReady(true))
  }, [])

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:py-12">
      <p className="mb-6 text-center text-sm font-medium uppercase tracking-wider text-[#64748b]">
        Accesos rápidos
      </p>

      {sessionReady && isMaster ? (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-center text-sm text-emerald-900 shadow-sm">
          <strong>Modo creador Libelia</strong> — Tienes acceso inmediato a Docente, UTP y Dirección (sin depender del rol
          en base de datos).
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-3">
        {HOME_ACCESS_CARDS.map((card) => {
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
