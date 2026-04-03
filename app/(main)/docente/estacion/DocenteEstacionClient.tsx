"use client"

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BatchMobileSyncPanel } from "@/app/components/docente/station/BatchMobileSyncPanel"
import { BatchPhotoRealtimeGrid } from "@/app/components/docente/station/BatchPhotoRealtimeGrid"
import { SourceExamQuickPicker, type SourceExamPick } from "@/app/components/docente/station/SourceExamQuickPicker"
import {
  TeacherAssignmentSelector,
  type TeacherAssignmentOption,
} from "@/app/components/docente/station/TeacherAssignmentSelector"
import { Button } from "@/components/ui/button"

export function DocenteEstacionClient() {
  const supabase = useMemo(() => createClientComponentClient(), [])
  /** null en SSR y primer paint del cliente → evita hydration mismatch con crypto.randomUUID(). */
  const [batchId, setBatchId] = useState<string | null>(null)

  const [assignments, setAssignments] = useState<TeacherAssignmentOption[]>([])
  const [assignmentsWarning, setAssignmentsWarning] = useState<string | null>(null)
  const [assignmentId, setAssignmentId] = useState<string | null>(null)
  const [contextRow, setContextRow] = useState<TeacherAssignmentOption | null>(null)
  const [sourceExam, setSourceExam] = useState<SourceExamPick | null>(null)

  const loadAssignments = useCallback(async () => {
    try {
      const res = await fetch("/api/docente/assignments", { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      const raw = Array.isArray(j?.assignments) ? j.assignments : []
      const list: TeacherAssignmentOption[] = raw.map(
        (r: {
          id: string
          subject: string
          course_label: string
          semester: string
          academic_year: number
        }) => ({
          id: r.id,
          subject: r.subject,
          course_label: r.course_label,
          semester: r.semester,
          academic_year: r.academic_year,
        }),
      )
      setAssignments(list)
      setAssignmentsWarning(typeof j?.warning === "string" ? j.warning : null)
      if (list.length === 1) {
        setAssignmentId(list[0].id)
        setContextRow(list[0])
      }
    } catch {
      setAssignments([])
      setAssignmentsWarning("No se pudieron cargar las asignaciones.")
    }
  }, [])

  useEffect(() => {
    void loadAssignments()
  }, [loadAssignments])

  useEffect(() => {
    setBatchId((prev) => prev ?? crypto.randomUUID())
  }, [])

  useEffect(() => {
    if (!batchId) return
    void fetch("/api/docente/batch-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ batch_id: batchId }),
    }).catch(() => {})
  }, [batchId])

  const onRegenerateBatch = useCallback(() => {
    setBatchId(crypto.randomUUID())
    setSourceExam(null)
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-600">Paso B · Estación de control</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Centro de mando docente (PC)</h1>
          <p className="text-sm text-slate-600 mt-2 max-w-2xl">
            Contexto desde carga horaria, recepción de fotos en vivo y elección de pauta para el lote actual. No modifica
            el flujo OMR: use el evaluador clásico cuando corresponda.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/evaluar">Ir a /evaluar</Link>
          </Button>
        </div>
      </header>

      {assignmentsWarning ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{assignmentsWarning}</p>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">1. Selector de carga horaria</h2>
        <TeacherAssignmentSelector
          assignments={assignments}
          value={assignmentId}
          onChange={(id, row) => {
            setAssignmentId(id)
            setContextRow(row)
          }}
        />
        {contextRow ? (
          <p className="text-sm text-slate-700">
            Contexto activo: <strong>{contextRow.subject}</strong> · <strong>{contextRow.course_label}</strong> (
            {contextRow.semester} {contextRow.academic_year})
          </p>
        ) : (
          <p className="text-sm text-slate-500">Sin contexto seleccionado (opcional en este paso).</p>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 px-1">2. Sincronización móvil</h2>
        <BatchMobileSyncPanel batchId={batchId} onRegenerateBatch={onRegenerateBatch} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">3. Pauta para este lote</h2>
        <SourceExamQuickPicker value={sourceExam} onChange={setSourceExam} />
        {sourceExam && batchId ? (
          <p className="text-xs text-slate-500">
            Lote <span className="font-mono">{batchId.slice(0, 8)}…</span> ↔ pauta{" "}
            <span className="font-mono">{sourceExam.id.slice(0, 8)}…</span> (solo UI; persistencia en paso siguiente).
          </p>
        ) : null}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900 px-1">4. Grilla de fotos</h2>
        {batchId ? (
          <BatchPhotoRealtimeGrid key={batchId} batchId={batchId} supabase={supabase} />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-500">
            Preparando identificador de lote en el navegador…
          </div>
        )}
      </section>
    </div>
  )
}
