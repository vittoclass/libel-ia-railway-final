"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

type DetailJson = {
  error?: string
  evaluation?: Record<string, unknown>
  summary?: Record<string, unknown> | null
  students?: Array<{ student_name?: string | null }>
  items?: unknown[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default function DocenteEvaluacionDetailPage() {
  const params = useParams()
  const idRaw = params?.id
  const id = typeof idRaw === "string" ? idRaw : Array.isArray(idRaw) ? idRaw[0] : ""

  const [data, setData] = useState<DetailJson | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id || !UUID_RE.test(id)) {
      setErr("Identificador de evaluación no válido")
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      setLoading(true)
      setErr(null)
      try {
        const res = await fetch(`/api/evaluations/${encodeURIComponent(id)}`, {
          credentials: "include",
          cache: "no-store",
        })
        const j = (await res.json()) as DetailJson
        if (cancelled) return
        if (!res.ok) {
          setErr(typeof j.error === "string" ? j.error : "No se pudo cargar la evaluación")
          setData(null)
          return
        }
        setData(j)
      } catch {
        if (!cancelled) {
          setErr("Error de red")
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  if (!id || !UUID_RE.test(id)) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        ID inválido.{" "}
        <Link href="/dashboard/docente" className="underline">
          Volver al panel
        </Link>
      </div>
    )
  }

  if (loading) {
    return <div className="text-sm text-slate-600">Cargando evaluación…</div>
  }

  if (err || !data?.evaluation) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {err ?? "Sin datos"}
        <div className="mt-2">
          <Link href="/dashboard/docente" className="underline">
            Volver al panel
          </Link>
        </div>
      </div>
    )
  }

  const ev = data.evaluation
  const title = String(ev.title ?? "Sin título")
  const course = String(ev.course_label ?? ev.course_id ?? "—")
  const subject = String(ev.subject ?? "—")
  const evaluatedAt = ev.evaluated_at != null ? String(ev.evaluated_at) : null
  const grade =
    data.summary && typeof (data.summary as { grade_chile?: unknown }).grade_chile === "number"
      ? (data.summary as { grade_chile: number }).grade_chile
      : null
  const students = Array.isArray(data.students) ? data.students : []
  const items = Array.isArray(data.items) ? data.items : []
  let obtained = 0
  let max = 0
  for (const it of items) {
    if (!it || typeof it !== "object") continue
    const o = it as { score_obtained?: unknown; score_max?: unknown }
    obtained += Number(o.score_obtained) || 0
    max += Number(o.score_max) || 0
  }
  const logroPct = max > 0 ? Math.round((obtained / max) * 10000) / 100 : null

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/docente" className="text-sm text-sky-700 hover:underline">
          ← Volver al panel docente
        </Link>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {course} · {subject}
          {evaluatedAt ? ` · ${new Date(evaluatedAt).toLocaleString("es-CL")}` : ""}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase text-slate-500">Nota (resumen)</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{grade != null ? grade : "—"}</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase text-slate-500">Logro ítems</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">
            {logroPct != null ? `${logroPct}%` : "—"}
            {max > 0 ? (
              <span className="ml-1 text-xs font-normal text-slate-500">
                ({obtained}/{max} pts)
              </span>
            ) : null}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <div className="text-xs uppercase text-slate-500">Ítems</div>
          <div className="mt-1 text-lg font-semibold tabular-nums">{items.length}</div>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-800">Estudiantes</h3>
        {students.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Sin filas en evaluation_students (puede ser una evaluación con un solo resumen).</p>
        ) : (
          <ul className="mt-2 list-inside list-disc text-sm text-slate-800">
            {students.map((s, i) => (
              <li key={i}>{String(s.student_name ?? "—").trim() || "—"}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-700">
        <p>
          Para <strong>PDF</strong> o <strong>ZIP</strong> de informes de corrección, abre el evaluador y usa el historial
          y las acciones de informes allí (misma lógica que ya conoces).
        </p>
        <Link
          href="/evaluar"
          className="mt-3 inline-flex rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800"
        >
          Ir al evaluador
        </Link>
      </section>
    </div>
  )
}
