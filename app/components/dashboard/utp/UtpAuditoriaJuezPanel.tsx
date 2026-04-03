"use client"

function parseNestedObject(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v)
      if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>
    } catch {
      /* ignore */
    }
  }
  return {}
}

type UtpAuditoriaJuezContent = Record<string, unknown>

function riskBadgeClass(pct: number): string {
  if (pct >= 60) return "bg-red-100 text-red-700 border-red-200"
  if (pct >= 35) return "bg-amber-100 text-amber-700 border-amber-200"
  return "bg-emerald-100 text-emerald-700 border-emerald-200"
}

export function UtpAuditoriaJuezPanel({
  content: contentProp,
}: {
  content?: UtpAuditoriaJuezContent | null
}) {
  const content: UtpAuditoriaJuezContent =
    contentProp != null && typeof contentProp === "object" && !Array.isArray(contentProp) ? contentProp : {}

  const rootCause = parseNestedObject(content.root_cause)
  const analysis_summary = String(content.analysis_summary ?? "")
  const normative_citations = Array.isArray(content.normative_citations) ? content.normative_citations : []
  const observed_questions = Array.isArray(content.observed_questions) ? content.observed_questions : []
  const recommended_actions = Array.isArray(content.recommended_actions) ? content.recommended_actions : []
  const utp_actions = Array.isArray(content.utp_actions) ? content.utp_actions : []
  const pme_linkage = Array.isArray(content.pme_linkage) ? content.pme_linkage : []
  const detected_skills = Array.isArray(content.detected_skills) ? content.detected_skills : []
  const improvement_suggestions = Array.isArray(content.improvement_suggestions) ? content.improvement_suggestions : []

  return (
    <>
      <p className="text-sm text-[var(--text-muted)] mb-4">{analysis_summary}</p>
      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <div className={`rounded-xl border p-3 ${riskBadgeClass(Math.round(Number(rootCause.approval_risk_pct ?? 0)))}`}>
          <h4 className="font-semibold">Riesgo de Aprobación</h4>
          <p className="text-2xl font-bold mt-1">{Math.round(Number(rootCause.approval_risk_pct ?? 0))}%</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 md:col-span-2">
          <h4 className="font-semibold text-slate-700">Citas normativas</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {normative_citations.length === 0 ? (
              <span className="text-xs text-[var(--text-muted)]">Sin citas normativas cargadas.</span>
            ) : (
              (normative_citations as Array<{ source: string; reference: string; url: string }>).map((n, idx) => (
                <a
                  key={idx}
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-slate-100"
                >
                  {n.source}
                </a>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 mb-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <h4 className="font-semibold text-emerald-800">Soluciones concretas por pregunta</h4>
          <div className="mt-2 space-y-2">
            {observed_questions.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">No hay observaciones por pregunta en este reporte.</p>
            ) : (
              (observed_questions as Array<{ question_ref: string; issue: string; recommendation: string }>).map((q, idx) => (
                <div key={idx} className="rounded border bg-white p-2">
                  <p className="text-sm font-medium">
                    {q.question_ref} · {q.issue}
                  </p>
                  <p className="text-xs text-emerald-700 mt-1">{q.recommendation}</p>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <h4 className="font-semibold text-sky-800">Acciones sugeridas para el UTP</h4>
          <div className="mt-2 space-y-2">
            {recommended_actions.length > 0 && (
              <ul className="list-disc pl-5 space-y-1 text-sm">
                {(recommended_actions as string[]).map((a, idx) => (
                  <li key={idx}>{a}</li>
                ))}
              </ul>
            )}
            {(utp_actions as Array<{ priority: string; action: string; owner: string }>).map((a, idx) => (
              <div key={idx} className="rounded border bg-white p-2">
                <p className="text-xs font-semibold text-sky-700">
                  Prioridad {a.priority} · Responsable: {a.owner}
                </p>
                <p className="text-sm mt-1">{a.action}</p>
              </div>
            ))}
            {recommended_actions.length === 0 && utp_actions.length === 0 && (
              <p className="text-xs text-[var(--text-muted)]">Sin acciones sugeridas para este reporte.</p>
            )}
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 mb-4">
        <h4 className="font-semibold text-violet-800">Vínculo PME</h4>
        <div className="mt-2 space-y-2">
          <p className="text-sm bg-white border rounded p-3">
            {(Array.isArray(rootCause.probable_causes) ? rootCause.probable_causes : []).length > 0
              ? (rootCause.probable_causes as string[]).join(" ")
              : "Sin causas probables reportadas."}
          </p>
          {(pme_linkage as Array<{ pme_dimension: string; objective: string; evidence: string }>).map((p, idx) => (
            <div key={idx} className="rounded border bg-white p-2">
              <p className="text-xs font-semibold text-violet-700">{p.pme_dimension}</p>
              <p className="text-sm">{p.objective}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Evidencia: {p.evidence}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border p-3">
          <h4 className="font-medium mb-2">Preguntas observadas</h4>
          {observed_questions.length === 0 ? (
            <pre className="text-xs bg-slate-50 border rounded p-2 overflow-auto max-h-48">
              {JSON.stringify(content, null, 2)}
            </pre>
          ) : (
            <ul className="space-y-2 text-sm">
              {(observed_questions as Array<{ question_ref: string; issue: string; recommendation: string }>).map((q, idx) => (
                <li key={idx} className="border rounded p-2">
                  <p className="font-medium">{q.question_ref}</p>
                  <p className="text-xs">{q.issue}</p>
                  <p className="text-xs text-[var(--text-muted)]">{q.recommendation}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <h4 className="font-medium mb-2">Habilidades detectadas</h4>
          {detected_skills.length === 0 ? (
            <pre className="text-xs bg-slate-50 border rounded p-2 overflow-auto max-h-48">
              {JSON.stringify(content, null, 2)}
            </pre>
          ) : (
            <ul className="space-y-2 text-sm">
              {(detected_skills as Array<{ skill: string; confidence: string; evidence: string }>).map((s, idx) => (
                <li key={idx} className="border rounded p-2">
                  <p className="font-medium">
                    {s.skill} · {s.confidence}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">{s.evidence}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border p-3">
          <h4 className="font-medium mb-2">Sugerencias de mejora</h4>
          {improvement_suggestions.length === 0 ? (
            <pre className="text-xs bg-slate-50 border rounded p-2 overflow-auto max-h-48">
              {JSON.stringify(content, null, 2)}
            </pre>
          ) : (
            <ul className="space-y-2 text-sm">
              {(improvement_suggestions as Array<{ target: string; action: string }>).map((s, idx) => (
                <li key={idx} className="border rounded p-2">
                  <p className="font-medium">{s.target}</p>
                  <p className="text-xs text-[var(--text-muted)]">{s.action}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  )
}
