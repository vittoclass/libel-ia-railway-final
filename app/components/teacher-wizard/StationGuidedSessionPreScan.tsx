"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ENABLE_WIZARD } from "./constants"
import {
  buildWizardCourseFromParts,
  expectedImagesMeta,
  isWizardSessionConfigValid,
  readWizardSession,
  type TeacherWizardSessionDraft,
  type WizardSessionTipoPrueba,
  WIZARD_SESSION_CHANGED_EVENT,
  writeWizardSession,
} from "./sessionStorage"

type Props = {
  /** Alinea «Fotos por alumno» del lote con la sesión guiada (1–50). */
  onSyncPagesPerStudent?: (n: number) => void
}

type FormState = {
  courseLevel: string
  courseLetter: string
  testName: string
  teacherName: string
  departmentName: string
  subjectName: string
  tipoPrueba: WizardSessionTipoPrueba
  studentCount: number
  imagesPerStudent: number
  /** Porcentaje 1–100; se mapea a `porcentajeExigencia` en el evaluador. */
  exigencia: number
  /** Puntaje máximo entero ≥ 1; se mapea a `puntajeTotal` en el evaluador. */
  puntajeTotal: number
  sessionSourceExamId?: string
  sessionSourceExamTitle?: string | null
}

function emptyForm(): FormState {
  return {
    courseLevel: "",
    courseLetter: "",
    testName: "",
    teacherName: "",
    departmentName: "",
    subjectName: "",
    tipoPrueba: "mixta",
    studentCount: 0,
    imagesPerStudent: 0,
    exigencia: 60,
    puntajeTotal: 100,
  }
}

function tipoPruebaLabel(t: WizardSessionTipoPrueba): string {
  if (t === "solo_alternativas") return "Solo alternativas"
  if (t === "solo_desarrollo") return "Solo desarrollo"
  return "Mixta"
}

function compactSummaryLine(d: TeacherWizardSessionDraft): string {
  const curso =
    buildWizardCourseFromParts((d.courseLevel ?? d.course ?? "").trim(), d.courseLetter).trim() || d.course.trim() || "—"
  const titulo = d.testName.trim() || "—"
  const tipo = tipoPruebaLabel(d.tipoPrueba ?? "mixta")
  const asig = (d.subjectName ?? "").trim()
  const asigPart = asig ? ` · ${asig}` : ""
  const base =
    (d.sessionSourceExamTitle ?? "").trim() ||
    (d.sessionSourceExamId?.trim() ? d.sessionSourceExamId.trim().slice(0, 8) : "")
  const baseSuffix = base ? ` · ${base}` : ""
  const nota =
    d.exigencia != null && d.puntajeTotal != null
      ? ` · ex. ${d.exigencia}% · ${d.puntajeTotal} pts`
      : ""
  return `${titulo} · ${curso}${asigPart} · ${tipo}${nota} · ${d.studentCount} eval. · ${d.imagesPerStudent} img/alumno · ${expectedImagesMeta(d.studentCount, d.imagesPerStudent)} total${baseSuffix}`
}

function draftToForm(d: TeacherWizardSessionDraft | null): FormState {
  if (!d?.savedAt) return emptyForm()
  const level = (d.courseLevel ?? d.course ?? "").trim()
  const letter = (d.courseLetter ?? "").trim()
  return {
    courseLevel: level,
    courseLetter: letter,
    testName: d.testName,
    teacherName: d.teacherName,
    departmentName: d.departmentName ?? "",
    subjectName: d.subjectName ?? "",
    tipoPrueba: d.tipoPrueba ?? "mixta",
    studentCount: d.studentCount,
    imagesPerStudent: d.imagesPerStudent,
    exigencia: d.exigencia ?? 60,
    puntajeTotal: d.puntajeTotal ?? 100,
    ...(d.sessionSourceExamId
      ? { sessionSourceExamId: d.sessionSourceExamId, sessionSourceExamTitle: d.sessionSourceExamTitle ?? null }
      : {}),
  }
}

/**
 * Configuración en la estación QR antes del bloque de escaneo.
 * Solo localStorage; no altera BatchMobileSyncPanel ni subida de imágenes.
 */
export function StationGuidedSessionPreScan({ onSyncPagesPerStudent }: Props) {
  const [hydrated, setHydrated] = useState(false)
  const [liveDraft, setLiveDraft] = useState<TeacherWizardSessionDraft | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editorOpen, setEditorOpen] = useState(true)
  const [saveHint, setSaveHint] = useState<string | null>(null)
  const [sourceExamOptions, setSourceExamOptions] = useState<Array<{ id: string; title: string | null }>>([])
  const [sourceExamLoading, setSourceExamLoading] = useState(false)
  const didHydrateScrollToQr = useRef(false)

  const scrollToQrSection = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.getElementById("docente-estacion-sync-mobile")?.scrollIntoView({ behavior: "smooth", block: "start" })
      })
    })
  }, [])

  const refreshFromStorage = useCallback(() => {
    const d = readWizardSession()
    setLiveDraft(d)
    return d
  }, [])

  useEffect(() => {
    if (!ENABLE_WIZARD) return
    const d = refreshFromStorage()
    setForm(draftToForm(d))
    // Misma regla que DocenteEstacionClient / origin/main: el QR solo se desbloquea si
    // isWizardSessionConfigValid. No marcar "lista" ni cerrar el editor con savedAt incompleto.
    setEditorOpen(!isWizardSessionConfigValid(d))
    setHydrated(true)
  }, [refreshFromStorage])

  useEffect(() => {
    if (!ENABLE_WIZARD) return
    const bump = () => {
      const d = refreshFromStorage()
      setForm(draftToForm(d))
    }
    window.addEventListener(WIZARD_SESSION_CHANGED_EVENT, bump)
    return () => window.removeEventListener(WIZARD_SESSION_CHANGED_EVENT, bump)
  }, [refreshFromStorage])

  useEffect(() => {
    if (!ENABLE_WIZARD || !editorOpen) return
    setSourceExamLoading(true)
    fetch("/api/source-exams", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.source_exams)) {
          setSourceExamOptions(
            j.source_exams.map((e: { id: string; title?: string | null }) => ({ id: e.id, title: e.title ?? null })),
          )
        }
      })
      .catch(() => setSourceExamOptions([]))
      .finally(() => setSourceExamLoading(false))
  }, [editorOpen])

  useEffect(() => {
    if (!hydrated || didHydrateScrollToQr.current) return
    if (!isWizardSessionConfigValid(readWizardSession())) return
    didHydrateScrollToQr.current = true
    scrollToQrSection()
  }, [hydrated, scrollToQrSection])

  const handleSave = () => {
    const id = form.sessionSourceExamId?.trim()
    const level = form.courseLevel.trim()
    const letter = form.courseLetter.trim()
    const courseFinal = buildWizardCourseFromParts(level, letter)
    const payload = {
      course: courseFinal,
      courseLevel: level,
      ...(letter ? { courseLetter: letter } : {}),
      testName: form.testName,
      teacherName: form.teacherName,
      departmentName: form.departmentName.trim() || undefined,
      subjectName: form.subjectName.trim() || undefined,
      tipoPrueba: form.tipoPrueba,
      studentCount: form.studentCount,
      imagesPerStudent: form.imagesPerStudent,
      exigencia: form.exigencia,
      puntajeTotal: form.puntajeTotal,
      ...(id
        ? {
            sessionSourceExamId: id,
            sessionSourceExamTitle:
              form.sessionSourceExamTitle ?? sourceExamOptions.find((o) => o.id === id)?.title ?? null,
          }
        : {}),
    }
    const saved = writeWizardSession(payload)
    setLiveDraft(saved)
    setForm(draftToForm(saved))
    // Conserva la condición exacta de origin/main (curso + prueba + profesor + metas).
    if (!isWizardSessionConfigValid(saved)) {
      setEditorOpen(true)
      setSaveHint(
        "Para mostrar el QR complete: nombre profesor, nombre de la prueba, curso/nivel, y metas (≥1 evaluación e imágenes).",
      )
      return
    }
    setSaveHint(null)
    setEditorOpen(false)
    const ipp = saved.imagesPerStudent
    if (ipp >= 1 && ipp <= 50) onSyncPagesPerStudent?.(ipp)
    queueMicrotask(() => scrollToQrSection())
  }

  if (!ENABLE_WIZARD) return null
  if (!hydrated) {
    return (
      <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-sm text-slate-500">
        Cargando configuración…
      </section>
    )
  }

  const configReady = isWizardSessionConfigValid(liveDraft)
  const summaryDraft = liveDraft

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4 dark:border-slate-700 dark:bg-slate-950/30">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Paso 1: Configura la evaluación</h2>

      {configReady && !editorOpen && summaryDraft?.savedAt ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Configuración lista</p>
          <ul className="list-none space-y-1 text-sm text-slate-700 dark:text-slate-300">
            <li>
              <span className="text-slate-500 dark:text-slate-400">Curso:</span>{" "}
              {buildWizardCourseFromParts(
                (summaryDraft.courseLevel ?? summaryDraft.course ?? "").trim(),
                summaryDraft.courseLetter,
              ).trim() ||
                summaryDraft.course.trim() ||
                "—"}
            </li>
            <li>
              <span className="text-slate-500 dark:text-slate-400">Asignatura:</span>{" "}
              {(summaryDraft.subjectName ?? "").trim() || "—"}
            </li>
            <li>
              <span className="text-slate-500 dark:text-slate-400">Tipo de prueba:</span>{" "}
              {tipoPruebaLabel(summaryDraft.tipoPrueba ?? "mixta")}
            </li>
            <li>
              <span className="text-slate-500 dark:text-slate-400">Configuración de nota:</span>{" "}
              exigencia {summaryDraft.exigencia ?? "—"}% · puntaje total {summaryDraft.puntajeTotal ?? "—"} pts
            </li>
            {(() => {
              const baseId = (summaryDraft.sessionSourceExamId ?? "").trim()
              const baseTitle = (summaryDraft.sessionSourceExamTitle ?? "").trim()
              return (
                <li>
                  <span className="text-slate-500 dark:text-slate-400">Prueba base:</span>{" "}
                  {baseId ? baseTitle || baseId.slice(0, 8) : "—"}
                </li>
              )
            })()}
            <li className="pt-1 text-xs text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
              Meta: {summaryDraft.studentCount} eval. × {summaryDraft.imagesPerStudent} img/alumno ={" "}
              {expectedImagesMeta(summaryDraft.studentCount, summaryDraft.imagesPerStudent)} imágenes
            </li>
          </ul>
          <p
            className="text-xs text-slate-500 dark:text-slate-400 truncate"
            title={compactSummaryLine(summaryDraft)}
          >
            {compactSummaryLine(summaryDraft)}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setForm(draftToForm(readWizardSession()))
              setEditorOpen(true)
            }}
          >
            Editar
          </Button>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="space-y-4">
          {configReady ? (
            <div className="flex flex-wrap justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-slate-600"
                onClick={() => {
                  setForm(draftToForm(readWizardSession()))
                  setSaveHint(null)
                  setEditorOpen(false)
                }}
              >
                Cerrar sin guardar
              </Button>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="station-wiz-teacher">Nombre profesor</Label>
              <Input
                id="station-wiz-teacher"
                value={form.teacherName}
                onChange={(e) => setForm((f) => ({ ...f, teacherName: e.target.value }))}
                autoComplete="name"
                placeholder="Nombre del profesor"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="station-wiz-test">Nombre prueba / evaluación</Label>
              <Input
                id="station-wiz-test"
                value={form.testName}
                onChange={(e) => setForm((f) => ({ ...f, testName: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-dept">Departamento</Label>
              <Input
                id="station-wiz-dept"
                value={form.departmentName}
                onChange={(e) => setForm((f) => ({ ...f, departmentName: e.target.value }))}
                autoComplete="organization"
                placeholder="Ej: Ciencias"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-subject">Asignatura</Label>
              <Input
                id="station-wiz-subject"
                value={form.subjectName}
                onChange={(e) => setForm((f) => ({ ...f, subjectName: e.target.value }))}
                autoComplete="off"
                placeholder="Ej: Física"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-level">Curso / nivel</Label>
              <Input
                id="station-wiz-level"
                value={form.courseLevel}
                onChange={(e) => setForm((f) => ({ ...f, courseLevel: e.target.value }))}
                autoComplete="off"
                placeholder='Ej: 2, 8° Básico…'
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-letter">Letra del curso</Label>
              <Input
                id="station-wiz-letter"
                value={form.courseLetter}
                onChange={(e) => setForm((f) => ({ ...f, courseLetter: e.target.value }))}
                autoComplete="off"
                placeholder="Ej: A"
                maxLength={8}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="station-wiz-tipo">Tipo de prueba</Label>
              <Select
                value={form.tipoPrueba}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, tipoPrueba: v as WizardSessionTipoPrueba }))
                }
              >
                <SelectTrigger id="station-wiz-tipo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mixta">Mixta</SelectItem>
                  <SelectItem value="solo_desarrollo">Solo desarrollo</SelectItem>
                  <SelectItem value="solo_alternativas">Solo alternativas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/40">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 mb-2">
                Configuración de nota
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="station-wiz-exigencia">Exigencia (%)</Label>
                  <Input
                    id="station-wiz-exigencia"
                    type="number"
                    min={1}
                    max={100}
                    value={form.exigencia || ""}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10)
                      const v = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 60
                      setForm((f) => ({ ...f, exigencia: v }))
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="station-wiz-puntaje-total">Puntaje total</Label>
                  <Input
                    id="station-wiz-puntaje-total"
                    type="number"
                    min={1}
                    value={form.puntajeTotal || ""}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10)
                      const v = Number.isFinite(n) ? Math.max(1, n) : 100
                      setForm((f) => ({ ...f, puntajeTotal: v }))
                    }}
                  />
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-students">Cantidad de evaluaciones / estudiantes</Label>
              <Input
                id="station-wiz-students"
                type="number"
                min={1}
                value={form.studentCount || ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  setForm((f) => ({ ...f, studentCount: Number.isFinite(n) ? Math.max(1, n) : 1 }))
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-ipp">Imágenes por estudiante</Label>
              <Input
                id="station-wiz-ipp"
                type="number"
                min={1}
                max={50}
                value={form.imagesPerStudent || ""}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10)
                  const v = Number.isFinite(n) ? Math.max(1, Math.min(50, n)) : 1
                  setForm((f) => ({ ...f, imagesPerStudent: v }))
                }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Prueba base</Label>
            <Select
              disabled={sourceExamLoading}
              value={form.sessionSourceExamId?.trim() ? form.sessionSourceExamId : "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  setForm((f) => ({
                    ...f,
                    sessionSourceExamId: undefined,
                    sessionSourceExamTitle: undefined,
                  }))
                  return
                }
                const opt = sourceExamOptions.find((o) => o.id === v)
                setForm((f) => ({ ...f, sessionSourceExamId: v, sessionSourceExamTitle: opt?.title ?? null }))
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={sourceExamLoading ? "Cargando…" : "Sin prueba base"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Sin prueba base</SelectItem>
                {sourceExamOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.title?.trim() || o.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {saveHint ? (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">{saveHint}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSave}>
              Guardar
            </Button>
            {configReady ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setForm(draftToForm(readWizardSession()))
                  setSaveHint(null)
                  setEditorOpen(false)
                }}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
