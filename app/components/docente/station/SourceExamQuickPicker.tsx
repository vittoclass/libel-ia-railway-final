"use client"

import { useCallback, useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Search } from "lucide-react"

export type SourceExamPick = {
  id: string
  title: string | null
  subject: string | null
  course_label: string | null
}

type Props = {
  value: SourceExamPick | null
  onChange: (exam: SourceExamPick | null) => void
  disabled?: boolean
}

export function SourceExamQuickPicker({ value, onChange, disabled }: Props) {
  const [q, setQ] = useState("")
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SourceExamPick[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const search = useCallback(async (term: string) => {
    setLoading(true)
    setMessage(null)
    try {
      const p = new URLSearchParams()
      if (term.trim().length >= 2) p.set("q", term.trim())
      const res = await fetch(`/api/docente/source-exams/search?${p.toString()}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setResults([])
        setMessage(String(j?.error ?? "No se pudo buscar"))
        return
      }
      setResults(Array.isArray(j?.exams) ? j.exams : [])
      if (j?.warning) setMessage(String(j.warning))
    } catch {
      setResults([])
      setMessage("Error de red")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void search("")
  }, [search])

  useEffect(() => {
    if (q.trim().length < 2) return
    const t = setTimeout(() => void search(q.trim()), 320)
    return () => clearTimeout(t)
  }, [q, search])

  return (
    <div className="space-y-2">
      <Label htmlFor="source-exam-search">Pauta / instrumento (source_exams)</Label>
      <div className="relative max-w-xl">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
        <Input
          id="source-exam-search"
          disabled={disabled}
          className="pl-9"
          placeholder="Buscar ej. Astoreca…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {loading ? (
          <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-slate-400" aria-hidden />
        ) : null}
      </div>
      {message ? <p className="text-xs text-amber-800">{message}</p> : null}
      {value ? (
        <p className="text-sm text-slate-700">
          Seleccionada: <strong>{value.title ?? "Sin título"}</strong>
          {value.subject ? <span className="text-slate-500"> · {value.subject}</span> : null}
          <button
            type="button"
            className="ml-2 text-xs text-indigo-600 underline"
            onClick={() => onChange(null)}
          >
            Quitar
          </button>
        </p>
      ) : null}
      <ul className="max-h-48 max-w-xl overflow-y-auto rounded-md border border-slate-200 bg-white text-sm">
        {results.map((ex) => (
          <li key={ex.id}>
            <button
              type="button"
              disabled={disabled}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
              onClick={() => onChange(ex)}
            >
              <span className="font-medium text-slate-900">{ex.title ?? "Sin título"}</span>
              <span className="text-xs text-slate-500">
                {[ex.subject, ex.course_label].filter(Boolean).join(" · ") || "—"}
              </span>
            </button>
          </li>
        ))}
        {!loading && results.length === 0 ? (
          <li className="px-3 py-2 text-slate-500">Sin resultados.</li>
        ) : null}
      </ul>
      <p className="text-[11px] text-slate-500 max-w-xl">
        La asociación al lote es solo en esta pantalla (Paso B); el enlace con evaluaciones/OMR se hará en un paso
        posterior explícito.
      </p>
    </div>
  )
}
