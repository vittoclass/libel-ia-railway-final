import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { Josefin_Sans } from "next/font/google"
import { Camera, Scale, BarChart3, ChevronRight } from "lucide-react"

const josefin = Josefin_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

export const metadata: Metadata = {
  title: "Libelia — Inteligencia Educativa",
  description:
    "Plataforma de evaluación, estación de escaneo, auditoría UTP y trazabilidad institucional.",
}

const cards = [
  {
    href: "/docente/estacion",
    emoji: "📸",
    title: "Estación de Escaneo",
    subtitle: "Sección Docente",
    description: "Captura y digitalización de pruebas en el aula o sala.",
    icon: Camera,
    iconWrap: "bg-[#0c4a6e] text-white shadow-inner",
    ringHover: "hover:ring-cyan-400/35",
    shadowHover: "hover:shadow-cyan-900/15",
  },
  {
    href: "/dashboard/utp",
    emoji: "⚖️",
    title: "Auditoría de Lotes",
    subtitle: "Sección UTP",
    description: "Revisión, control y liberación de evaluaciones por lote.",
    icon: Scale,
    iconWrap: "bg-[#c2410c] text-white shadow-inner",
    ringHover: "hover:ring-orange-400/40",
    shadowHover: "hover:shadow-orange-900/20",
  },
  {
    href: "/dashboard/direccion/trazabilidad",
    emoji: "📊",
    title: "Trazabilidad",
    subtitle: "Sección Dirección",
    description: "Visibilidad de resultados y trazabilidad curricular.",
    icon: BarChart3,
    iconWrap: "bg-[#3730a3] text-white shadow-inner",
    ringHover: "hover:ring-indigo-400/35",
    shadowHover: "hover:shadow-indigo-900/20",
  },
] as const

export default function Home() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col bg-[#f8fafc] text-[#0f172a]">
      {/* Cabecera de marca */}
      <header className="relative overflow-hidden bg-gradient-to-br from-[#0a1628] via-[#0f2847] to-[#0c4a6e] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #38bdf8 0%, transparent 45%), radial-gradient(circle at 80% 60%, #818cf8 0%, transparent 40%)",
          }}
        />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-4 py-10 md:py-14">
          <div className="mb-5 flex items-center justify-center rounded-2xl bg-white/5 p-3 ring-1 ring-white/10 backdrop-blur-sm">
            <Image
              src="/libelia-mark.svg"
              alt="Libelia"
              width={80}
              height={80}
              priority
              className="h-[72px] w-[72px] md:h-20 md:w-20"
            />
          </div>
          <h1
            className={`${josefin.className} text-center text-3xl font-bold tracking-tight text-white md:text-4xl`}
          >
            Libelia
          </h1>
          <p className="mt-2 max-w-md text-center text-sm text-sky-100/90 md:text-base">
            Inteligencia educativa para evaluar, auditar y dar cuenta con rigor.
          </p>
        </div>
      </header>

      {/* Tarjetas de acceso */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 md:py-12">
        <p className="mb-6 text-center text-sm font-medium uppercase tracking-wider text-[#64748b]">
          Accesos rápidos
        </p>
        <div className="grid gap-6 md:grid-cols-3">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <Link
                key={card.href}
                href={card.href}
                className={[
                  "group relative flex flex-col rounded-2xl border border-white/80 bg-white p-6 shadow-lg",
                  "transition-all duration-300 ease-out",
                  "hover:-translate-y-1 hover:shadow-2xl active:translate-y-0 active:scale-[0.99]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2",
                  card.ringHover,
                  card.shadowHover,
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-2xl" aria-hidden>
                    {card.emoji}
                  </span>
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${card.iconWrap} transition-transform duration-300 group-hover:scale-110`}
                  >
                    <Icon className="h-6 w-6" strokeWidth={2} aria-hidden />
                  </span>
                </div>
                <div className="mt-4 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#64748b]">
                    {card.subtitle}
                  </p>
                  <h2 className={`${josefin.className} mt-1 text-xl font-semibold text-[#0a1628]`}>
                    {card.title}
                  </h2>
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

      <footer className="border-t border-[#e2e8f0] bg-white py-4 text-center text-xs text-[#94a3b8]">
        Libelia - Inteligencia Educativa 2026
      </footer>
    </div>
  )
}
