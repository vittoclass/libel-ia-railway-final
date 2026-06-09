"use client"

/**
 * Vistas HTML mínimas para PDF en ZIP masivo (sin Recharts): resumen SIMCE curso y análisis técnico.
 * Solo exportación; no altera OMR ni APIs.
 */
import * as React from "react"
import { formatPedagogicalReadableText } from "@/app/lib/pedagogical-export-formatting"
import { formatStudentDisplayName } from "@/app/lib/format-student-name"
import { SIMCE_PROJECTION_DISCLAIMER, SIMCE_PROJECTION_SCALE_LABEL } from "@/app/lib/simceProjectionCanonical"

export type CourseZipNationalRow = {
  student_name?: string
  logro_pct?: number | null
  simce_score?: number | null
  simce_level?: string | null
}

export type CourseZipSummaryPayload = {
  course?: string
  evaluation_count?: number
  student_count?: number
  analytics_mode?: string | null
  by_skill?: Array<{ dimension_value: string; logro_pct: number | null; question_count: number }>
  by_axis?: Array<{ dimension_value: string; logro_pct: number | null; question_count: number }>
  weakest_skills?: Array<{ skill: string; average_logro_pct: number | null }>
  weakest_axes?: Array<{ axis: string; average_logro_pct: number | null; question_count: number }>
  most_failed_questions?: Array<{
    item_number: number
    axis: string
    skill: string
    error_pct: number
    student_count: number
  }>
  national_analytics?: {
    by_evaluation?: CourseZipNationalRow[]
    course_summary?: {
      average_logro_pct?: number | null
      average_simce?: number
      simce_distribution?: { Adecuado: number; Elemental: number; Insuficiente: number }
    }
  }
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 9,
  marginTop: 8,
}
const thtd: React.CSSProperties = { border: "1px solid #cbd5e1", padding: "4px 6px", textAlign: "left" as const }

function clampDisplayPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return "—"
  return `${clampDisplayPct(Number(v))}%`
}

export function CourseResumenSimceZipBody({
  data,
  courseLabel,
}: {
  data: CourseZipSummaryPayload
  courseLabel: string
}) {
  const nat = data.national_analytics
  const rows = nat?.by_evaluation ?? []
  const cs = nat?.course_summary
  const dist = cs?.simce_distribution

  return (
    <div className="space-y-3 text-sm p-4 bg-white text-slate-900" style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Resumen SIMCE — curso</h1>
      <p style={{ margin: 0, fontSize: 11, color: "#475569" }}>
        Curso: <strong>{courseLabel || data.course || "Curso"}</strong>
        {" · "}
        Evaluaciones: {data.evaluation_count ?? "—"} · Estudiantes (registros): {data.student_count ?? "—"}
      </p>
      {cs ? (
        <div style={{ fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 6, padding: 8, background: "#f8fafc" }}>
          <div>
            <strong>Promedio logro curso:</strong> {pct(cs.average_logro_pct)}
          </div>
          <div>
            <strong>Puntaje SIMCE promedio (estimado):</strong>{" "}
            {cs.average_simce != null && Number.isFinite(Number(cs.average_simce)) ? Math.round(Number(cs.average_simce)) : "—"}
          </div>
          {dist ? (
            <div style={{ marginTop: 6 }}>
              <strong>Distribución nivel SIMCE:</strong> Adecuado {dist.Adecuado ?? 0}, Elemental {dist.Elemental ?? 0}, Insuficiente{" "}
              {dist.Insuficiente ?? 0}
            </div>
          ) : null}
          <div style={{ marginTop: 6, fontSize: 9, color: "#64748b", lineHeight: 1.35 }}>
            {SIMCE_PROJECTION_SCALE_LABEL} · {SIMCE_PROJECTION_DISCLAIMER}
          </div>
        </div>
      ) : null}
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: "12px 0 0" }}>Resultados por estudiante</h2>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={thtd}>Estudiante</th>
            <th style={thtd}>Logro</th>
            <th style={thtd}>SIMCE est.</th>
            <th style={thtd}>Nivel</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} style={thtd}>
                Sin filas de analítica nacional para este curso.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                <td style={thtd}>{formatStudentDisplayName(r.student_name) || r.student_name || "—"}</td>
                <td style={thtd}>{pct(r.logro_pct)}</td>
                <td style={thtd}>
                  {r.simce_score != null && Number.isFinite(Number(r.simce_score)) ? Math.round(Number(r.simce_score)) : "—"}
                </td>
                <td style={thtd}>{r.simce_level ?? "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

export function CourseAnalisisPedagogicoZipBody({
  data,
  courseLabel,
}: {
  data: CourseZipSummaryPayload
  courseLabel: string
}) {
  const skills = data.by_skill ?? []
  const axes = data.by_axis ?? []
  const weak = data.weakest_skills ?? []
  const failed = data.most_failed_questions ?? []

  return (
    <div className="space-y-3 text-sm p-4 bg-white text-slate-900" style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720 }}>
      <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Análisis pedagógico — informe técnico</h1>
      <p style={{ margin: 0, fontSize: 11, color: "#475569" }}>
        Curso: <strong>{courseLabel || data.course || "Curso"}</strong>
        {data.analytics_mode ? ` · Modo instrumento: ${data.analytics_mode}` : null}
      </p>
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: "8px 0 0" }}>Logro por habilidad</h2>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={thtd}>Habilidad</th>
            <th style={thtd}>Logro</th>
            <th style={thtd}>Ítems</th>
          </tr>
        </thead>
        <tbody>
          {skills.length === 0 ? (
            <tr>
              <td colSpan={3} style={thtd}>
                Sin datos por habilidad.
              </td>
            </tr>
          ) : (
            skills.slice(0, 40).map((r, i) => (
              <tr key={i}>
                <td style={thtd}>{formatPedagogicalReadableText(r.dimension_value)}</td>
                <td style={thtd}>{pct(r.logro_pct)}</td>
                <td style={thtd}>{r.question_count}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: "12px 0 0" }}>Logro por eje</h2>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={thtd}>Eje</th>
            <th style={thtd}>Logro</th>
            <th style={thtd}>Ítems</th>
          </tr>
        </thead>
        <tbody>
          {axes.length === 0 ? (
            <tr>
              <td colSpan={3} style={thtd}>
                Sin datos por eje.
              </td>
            </tr>
          ) : (
            axes.slice(0, 40).map((r, i) => (
              <tr key={i}>
                <td style={thtd}>{r.dimension_value}</td>
                <td style={thtd}>{pct(r.logro_pct)}</td>
                <td style={thtd}>{r.question_count}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: "12px 0 0" }}>Habilidades más débiles</h2>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={thtd}>Habilidad</th>
            <th style={thtd}>Logro prom.</th>
          </tr>
        </thead>
        <tbody>
          {weak.length === 0 ? (
            <tr>
              <td colSpan={2} style={thtd}>
                —
              </td>
            </tr>
          ) : (
            weak.slice(0, 20).map((r, i) => (
              <tr key={i}>
                <td style={thtd}>{formatPedagogicalReadableText(r.skill)}</td>
                <td style={thtd}>{pct(r.average_logro_pct)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <h2 style={{ fontSize: 12, fontWeight: 700, margin: "12px 0 0" }}>Ítems con mayor dificultad</h2>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={thtd}>N.º</th>
            <th style={thtd}>Eje</th>
            <th style={thtd}>Habilidad</th>
            <th style={thtd}>Error %</th>
            <th style={thtd}>n</th>
          </tr>
        </thead>
        <tbody>
          {failed.length === 0 ? (
            <tr>
              <td colSpan={5} style={thtd}>
                —
              </td>
            </tr>
          ) : (
            failed.slice(0, 25).map((r, i) => (
              <tr key={i}>
                <td style={thtd}>{r.item_number}</td>
                <td style={thtd}>{formatPedagogicalReadableText(r.axis)}</td>
                <td style={thtd}>{formatPedagogicalReadableText(r.skill)}</td>
                <td style={thtd}>{Math.round(r.error_pct)}%</td>
                <td style={thtd}>{r.student_count}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
