import type { Metadata } from "next"
import Image from "next/image"
import { Josefin_Sans } from "next/font/google"
import { HomeDashboardSection } from "@/app/components/HomeDashboardSection"

const josefin = Josefin_Sans({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
})

export const metadata: Metadata = {
  title: "Libelia — Inteligencia Educativa",
  description:
    "Plataforma de evaluación, estación de escaneo, auditoría UTP y trazabilidad institucional.",
}

export default function Home() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex flex-col bg-[#f8fafc] text-[#0f172a]">
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

      <HomeDashboardSection josefinClass={josefin.className} />

      <footer className="border-t border-[#e2e8f0] bg-white py-4 text-center text-xs text-[#94a3b8]">
        Libelia - Inteligencia Educativa 2026
      </footer>
    </div>
  )
}
