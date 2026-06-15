"use client"

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { GuidedSessionStationSummary } from "@/app/components/teacher-wizard/GuidedSessionStationSummary"
import { StationGuidedSessionPreScan } from "@/app/components/teacher-wizard/StationGuidedSessionPreScan"
import {
  BatchMobileSyncPanel,
  type BatchSessionStatusPayload,
} from "@/app/components/docente/station/BatchMobileSyncPanel"
import { BatchPhotoRealtimeGrid } from "@/app/components/docente/station/BatchPhotoRealtimeGrid"
import { type SourceExamPick } from "@/app/components/docente/station/SourceExamQuickPicker"
import {
  TeacherAssignmentSelector,
  type TeacherAssignmentOption,
} from "@/app/components/docente/station/TeacherAssignmentSelector"
import { ENABLE_WIZARD } from "@/app/components/teacher-wizard/constants"
import {
  isWizardSessionConfigValid,
  readWizardSession,
  WIZARD_SESSION_CHANGED_EVENT,
  WIZARD_SESSION_STORAGE_KEY,
} from "@/app/components/teacher-wizard/sessionStorage"
import {
  readDocenteActiveBatchId,
  writeDocenteActiveBatchId,
} from "@/app/lib/docente/active-batch-id"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Solo UI estación: no mostrar el aviso de migración PASO A; el fetch y el estado siguen igual. */
function isTeacherAssignmentsTableMigrationUiNoise(w: string | null): boolean {
  if (!w) return false
  const s = w.toLowerCase()
  return s.includes("teacher_assignments") && (s.includes("no aplicada") || s.includes("paso a"))
}

export function DocenteEstacionClient() {
  const supabase = useMemo(() => createClientComponentClient(), [])
  /** null en SSR y primer paint del cliente → evita hydration mismatch con crypto.randomUUID(). */
  const [batchId, setBatchId] = useState<string | null>(null)

  const [assignments, setAssignments] = useState<TeacherAssignmentOption[]>([])
  const [assignmentsWarning, setAssignmentsWarning] = useState<string | null>(null)
  const [assignmentId, setAssignmentId] = useState<string | null>(null)
  const [contextRow, setContextRow] = useState<TeacherAssignmentOption | null>(null)
  const [sourceExam, setSourceExam] = useState<SourceExamPick | null>(null)
  const [batchSessionError, setBatchSessionError] = useState<string | null>(null)
  /** Respuesta cruda de /api/docente/batch-session para depuración en pantalla. */
  const [debugError, setDebugError] = useState<unknown>(null)
  /** Debe coincidir con el móvil (QR /escaneo): ver MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT en mobile-scan-constants. */
  const [pagesPerStudent, setPagesPerStudent] = useState(2)
  /** Con wizard activo, el QR y la grilla solo tras configuración válida guardada. */
  const [scanSectionUnlocked, setScanSectionUnlocked] = useState(!ENABLE_WIZARD)

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
    const activeBatchId = readDocenteActiveBatchId()
    if (activeBatchId) {
      if (process.env.NODE_ENV === "development") {
        console.info("[station] restored active batch_id from localStorage", activeBatchId)
      }
      setBatchId(activeBatchId)
      return
    }
    const newId = crypto.randomUUID()
    if (process.env.NODE_ENV === "development") {
      console.info("[station] created new batch_id", newId)
    }
    setBatchId(newId)
  }, [])

  useEffect(() => {
    if (batchId) writeDocenteActiveBatchId(batchId)
  }, [batchId])

  const batchSessionContext = useMemo(() => {
    const bits: string[] = []
    if (contextRow) bits.push(`${contextRow.subject} · ${contextRow.course_label}`)
    if (sourceExam?.title) bits.push(sourceExam.title)
    return bits.length ? bits.join(" | ") : null
  }, [contextRow, sourceExam])

  const handleBatchSessionStatus = useCallback((s: BatchSessionStatusPayload) => {
    if (s.ok) {
      setBatchSessionError(null)
      setDebugError(null)
    } else {
      setBatchSessionError(s.message)
      setDebugError({
        source: "BatchMobileSyncPanel",
        endpoint: "POST /api/docente/batch-session",
        httpStatus: s.httpStatus,
        message: s.message,
        requestPayload: s.requestPayload,
        responseJson: s.responseJson,
        rawTextSnippet: s.rawTextSnippet,
      })
    }
  }, [])

  useEffect(() => {
    if (!ENABLE_WIZARD) return
    const syncUnlock = () => setScanSectionUnlocked(isWizardSessionConfigValid(readWizardSession()))
    syncUnlock()
    window.addEventListener(WIZARD_SESSION_CHANGED_EVENT, syncUnlock)
    const onStorage = (e: StorageEvent) => {
      if (e.key === WIZARD_SESSION_STORAGE_KEY) syncUnlock()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(WIZARD_SESSION_CHANGED_EVENT, syncUnlock)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  useEffect(() => {
    const syncSourceExamFromGuidedSession = () => {
      const guided = readWizardSession()
      const id = guided?.sessionSourceExamId?.trim() ?? ""
      if (!id) {
        setSourceExam(null)
        return
      }
      setSourceExam((prev) => {
        if (prev?.id === id) return prev
        return {
          id,
          title: (guided?.sessionSourceExamTitle ?? "").trim() || null,
          subject: null,
          course_label: null,
        }
      })
    }
    syncSourceExamFromGuidedSession()
    window.addEventListener(WIZARD_SESSION_CHANGED_EVENT, syncSourceExamFromGuidedSession)
    const onStorage = (e: StorageEvent) => {
      if (e.key === WIZARD_SESSION_STORAGE_KEY) syncSourceExamFromGuidedSession()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(WIZARD_SESSION_CHANGED_EVENT, syncSourceExamFromGuidedSession)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const onRegenerateBatch = useCallback(() => {
    const newId = crypto.randomUUID()
    if (process.env.NODE_ENV === "development") {
      console.info("[station] teacher requested new batch_id", newId)
    }
    setBatchId(newId)
    setSourceExam(null)
    setBatchSessionError(null)
    setDebugError(null)
  }, [])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 space-y-8">
      {debugError != null ? (
        <div
          className="rounded-lg border-4 border-black bg-red-600 p-6 text-white shadow-2xl"
          style={{ fontFamily: "ui-monospace, monospace" }}
        >
          <div className="text-2xl font-black uppercase tracking-wide mb-3">DEBUG batch-session — sin filtros</div>
          <pre className="text-sm md:text-base whitespace-pre-wrap break-all overflow-x-auto max-h-[70vh] overflow-y-auto">
            {JSON.stringify(debugError, null, 2)}
          </pre>
        </div>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-600">Estación QR (PC)</p>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">Estación docente</h1>
          {ENABLE_WIZARD ? (
            <p className="text-sm text-slate-600 mt-2 max-w-xl">
              Primero la configuración; después el QR y las fotos. Luego <strong>/evaluar</strong>.
            </p>
          ) : (
            <p className="text-sm text-slate-600 mt-2 max-w-xl">
              Configura el lote, escanea con el móvil y revisa fotos; en <strong>/evaluar</strong> extrae nombres y evalúa.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/evaluar">Ir a /evaluar</Link>
          </Button>
        </div>
      </header>

      {assignmentsWarning && !isTeacherAssignmentsTableMigrationUiNoise(assignmentsWarning) ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{assignmentsWarning}</p>
      ) : null}

      {assignments.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 shadow-sm space-y-3">
          <TeacherAssignmentSelector
            assignments={assignments}
            value={assignmentId}
            onChange={(id, row) => {
              setAssignmentId(id)
              setContextRow(row)
            }}
          />
          {contextRow ? (
            <p className="text-xs text-slate-600">
              Activo: <strong>{contextRow.subject}</strong> · {contextRow.course_label} ({contextRow.semester}{" "}
              {contextRow.academic_year})
            </p>
          ) : (
            <p className="text-xs text-slate-500">Opcional: etiqueta en la grilla de fotos.</p>
          )}
        </section>
      ) : null}

      <StationGuidedSessionPreScan
        onSyncPagesPerStudent={(n) => {
          const v = Math.max(1, Math.min(50, Math.floor(Number(n)) || 1))
          setPagesPerStudent(v)
        }}
      />

      {scanSectionUnlocked ? (
        <>
          <section id="docente-estacion-sync-mobile" className="space-y-4 scroll-mt-24">
            <h2 className="text-lg font-semibold text-slate-900 px-1">Paso 2: QR y escaneo</h2>

            <div className="rounded-lg border border-sky-200 bg-sky-50/90 px-3 py-2.5 text-sm text-slate-800 leading-snug">
              Las fotos permanecen en el servidor hasta que se eliminen manualmente o se cree una evaluación vinculada. Si no
              aparecen en Evaluador, en <strong className="font-semibold">/evaluar</strong> usa{" "}
              <strong className="font-semibold">Recuperar fotos del lote</strong>.
            </div>

            <GuidedSessionStationSummary />
            {batchSessionError ? (
              <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                <strong>QR no válido en el celular hasta corregir esto:</strong> {batchSessionError}
              </p>
            ) : null}
            {!ENABLE_WIZARD ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 max-w-md">
                <Label htmlFor="pages-per-student" className="text-sm font-medium text-slate-800">
                  Fotos por alumno (páginas distintas)
                </Label>
                <Input
                  id="pages-per-student"
                  type="number"
                  min={1}
                  max={50}
                  value={pagesPerStudent}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(50, Math.floor(Number(e.target.value)) || 1))
                    setPagesPerStudent(n)
                  }}
                  className="w-24"
                />
                <p className="text-[11px] text-slate-500">Debe coincidir con el celular al escanear.</p>
              </div>
            ) : null}
            <BatchMobileSyncPanel
              batchId={batchId}
              onRegenerateBatch={onRegenerateBatch}
              onBatchSessionStatus={handleBatchSessionStatus}
              expectedPagesPerStudent={pagesPerStudent}
              sourceExamId={sourceExam?.id ?? null}
              sessionContext={batchSessionContext}
            />
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900 px-1">Grilla de fotos</h2>
            {batchId ? (
              <BatchPhotoRealtimeGrid
                key={batchId}
                batchId={batchId}
                supabase={supabase}
                expectedPagesPerStudent={pagesPerStudent}
                courseLabel={contextRow?.course_label ?? null}
                subject={contextRow?.subject ?? sourceExam?.subject ?? null}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center text-sm text-slate-500">
                Preparando identificador de lote en el navegador…
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
