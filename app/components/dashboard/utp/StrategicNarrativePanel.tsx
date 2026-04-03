"use client"

type Strategic = {
  course_narrative: string
  gap_alerts: string[]
  pme_actions: string[]
  interdisciplinary_note: string | null
  student_narratives: Array<{ evaluation_id: string; student_display_name: string; note: string }>
}

export function StrategicNarrativePanel({ strategic }: { strategic: Strategic | null }) {
  if (!strategic) return null
  return (
    <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4 space-y-3">
      <h4 className="text-sm font-semibold text-violet-900">Motor de Análisis Estratégico</h4>
      <ul className="list-disc pl-5 text-sm text-violet-950">
        {String(strategic.course_narrative)
          .split(".")
          .map((x) => x.trim())
          .filter(Boolean)
          .map((line, idx) => (
            <li key={idx}>{line}.</li>
          ))}
      </ul>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-800 mb-1">Dónde está el problema (Eje vs Habilidad)</p>
          {strategic.gap_alerts.length === 0 ? (
            <p className="text-xs text-amber-900">No se ve un quiebre fuerte entre eje y habilidad.</p>
          ) : (
            <ul className="list-disc pl-5 space-y-1 text-xs text-amber-900">
              {strategic.gap_alerts.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-800 mb-1">Qué hacer mañana (PME)</p>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-emerald-900">
            {(strategic.pme_actions ?? []).slice(0, 3).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </div>
      </div>

      {strategic.interdisciplinary_note ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
          <p className="text-xs font-semibold text-sky-800 mb-1">Cruce interdisciplinar</p>
          <p className="text-xs text-sky-900">{strategic.interdisciplinary_note}</p>
        </div>
      ) : null}

      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold text-slate-700 mb-1">Detalle por estudiante (foco de intervención)</p>
        {(strategic.student_narratives ?? []).length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Sin estudiantes focalizados para narrativa individual.</p>
        ) : (
          <ul className="space-y-2">
            {strategic.student_narratives.map((s) => (
              <li key={s.evaluation_id} className="text-xs">
                <span className="font-medium">{s.student_display_name}: </span>
                <span>{s.note}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
