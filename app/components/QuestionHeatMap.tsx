"use client"

/**
 * Mapa de calor de preguntas para el resumen pedagógico del curso.
 * Misma lógica de colores (≥70% verde, 50-69% amarillo, <50% rojo).
 * Solo presentación; no modifica datos ni backend.
 */
import * as React from "react"
import { getHeatMapLevel } from "@/app/lib/pedagogical-diagnosis-text"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/app/components/ui/tooltip"

export type QuestionHeatMapItem = {
  item_number: number
  logro_pct: number
  axis?: string
  skill?: string
}

const QUESTIONS_PER_ROW = 10
const LEVEL_STYLES = {
  green: "bg-emerald-600 text-white border-emerald-700",
  yellow: "bg-amber-500 text-white border-amber-600",
  red: "bg-red-600 text-white border-red-700",
} as const

type Props = {
  items: QuestionHeatMapItem[]
  totalQuestions?: number
}

function safeHeatMapLabel(value: unknown, fallback = "—"): string {
  if (value == null) return fallback
  if (typeof value === "string") return value.trim() || fallback
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>
    const candidate =
      (typeof obj.descripcion === "string" && obj.descripcion) ||
      (typeof obj.label === "string" && obj.label) ||
      (typeof obj.nombre === "string" && obj.nombre) ||
      (typeof obj.name === "string" && obj.name) ||
      (typeof obj.titulo === "string" && obj.titulo) ||
      (typeof obj.title === "string" && obj.title) ||
      (typeof obj.ejemplo === "string" && obj.ejemplo) ||
      ""
    return candidate.trim() || fallback
  }
  return fallback
}

function HeatMapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--text-muted)] mb-3">
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 h-5 rounded border border-emerald-700 bg-emerald-600 flex-shrink-0" aria-hidden />
        Verde = ≥70%
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 h-5 rounded border border-amber-600 bg-amber-500 flex-shrink-0" aria-hidden />
        Amarillo = 50–69%
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-5 h-5 rounded border border-red-700 bg-red-600 flex-shrink-0" aria-hidden />
        Rojo = &lt;50%
      </span>
    </div>
  )
}

export function QuestionHeatMap({ items, totalQuestions }: Props) {
  const sorted = React.useMemo(
    () => [...items].sort((a, b) => a.item_number - b.item_number),
    [items]
  )

  if (sorted.length === 0) return null
  const maxItem = Math.max(
    1,
    totalQuestions && Number.isFinite(totalQuestions) ? Math.floor(totalQuestions) : 0,
    ...sorted.map((q) => q.item_number),
  )
  const byNum = new Map(sorted.map((q) => [q.item_number, q] as const))
  const aligned: QuestionHeatMapItem[] = []
  for (let i = 1; i <= maxItem; i++) {
    aligned.push(
      byNum.get(i) ?? {
        item_number: i,
        logro_pct: 0,
        axis: "—",
        skill: "—",
      },
    )
  }

  return (
    <div className="rounded-md border bg-[var(--bg-muted)] p-4">
      <HeatMapLegend />
      <TooltipProvider delayDuration={200}>
        <div className="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-1.5 w-full">
          {aligned.map((q) => {
            const level = getHeatMapLevel(q.logro_pct)
            const style = LEVEL_STYLES[level]
            const axis = safeHeatMapLabel(q.axis, "—")
            const skill = safeHeatMapLabel(q.skill, "—")
            return (
              <Tooltip key={q.item_number}>
                <TooltipTrigger asChild>
                  <div
                    className={`
                      min-w-0 aspect-square rounded border flex items-center justify-center
                      text-sm font-medium cursor-default
                      ${style}
                    `}
                    aria-label={`Pregunta ${q.item_number}, logro ${q.logro_pct}%`}
                  >
                    {q.item_number}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[240px]">
                  <div className="space-y-1 text-left">
                    <div className="font-semibold">Pregunta {q.item_number}</div>
                    <div>Logro: {q.logro_pct}%</div>
                    <div className="text-muted-foreground">Eje: {axis}</div>
                    <div className="text-muted-foreground">Habilidad: {skill}</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      </TooltipProvider>
    </div>
  )
}
