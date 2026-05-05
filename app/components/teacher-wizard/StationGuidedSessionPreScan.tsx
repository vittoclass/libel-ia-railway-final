"use client"

import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
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
  expectedImagesMeta,
  readWizardSession,
  type TeacherWizardSessionDraft,
  WIZARD_SESSION_CHANGED_EVENT,
  writeWizardSession,
} from "./sessionStorage"
import { cn } from "@/lib/utils"

type Props = {
  /** Alinea «Fotos por alumno» del lote con la sesión guiada (1–50). */
  onSyncPagesPerStudent?: (n: number) => void
}

type FormState = {
  course: string
  testName: string
  teacherName: string
  departmentName: string
  studentCount: number
  imagesPerStudent: number
  sessionSourceExamId?: string
  sessionSourceExamTitle?: string | null
}

function emptyForm(): FormState {
  return {
    course: "",
    testName: "",
    teacherName: "",
    departmentName: "",
    studentCount: 0,
    imagesPerStudent: 0,
  }
}

function draftToForm(d: TeacherWizardSessionDraft | null): FormState {
  if (!d?.savedAt) return emptyForm()
  return {
    course: d.course,
    testName: d.testName,
    teacherName: d.teacherName,
    departmentName: d.departmentName ?? "",
    studentCount: d.studentCount,
    imagesPerStudent: d.imagesPerStudent,
    ...(d.sessionSourceExamId
      ? { sessionSourceExamId: d.sessionSourceExamId, sessionSourceExamTitle: d.sessionSourceExamTitle ?? null }
      : {}),
  }
}

function isConfigReady(d: TeacherWizardSessionDraft | null): boolean {
  if (!d?.savedAt) return false
  return (
    d.course.trim() !== "" &&
    d.testName.trim() !== "" &&
    d.teacherName.trim() !== "" &&
    d.studentCount >= 1 &&
    d.imagesPerStudent >= 1
  )
}

/**
 * Configuración guiada antes del escaneo QR en la estación PC.
 * Solo localStorage; no altera BatchMobileSyncPanel ni subida de imágenes.
 */
export function StationGuidedSessionPreScan({ onSyncPagesPerStudent }: Props) {
  const [hydrated, setHydrated] = useState(false)
  const [liveDraft, setLiveDraft] = useState<TeacherWizardSessionDraft | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editorOpen, setEditorOpen] = useState(true)
  const [sourceExamOptions, setSourceExamOptions] = useState<Array<{ id: string; title: string | null }>>([])
  const [sourceExamLoading, setSourceExamLoading] = useState(false)

  const refreshFromStorage = useCallback(() => {
    const d = readWizardSession()
    setLiveDraft(d)
    return d
  }, [])

  useEffect(() => {
    if (!ENABLE_WIZARD) return
    const d = refreshFromStorage()
    setForm(draftToForm(d))
    setEditorOpen(!d?.savedAt)
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

  const ready = useMemo(() => isConfigReady(liveDraft), [liveDraft])

  const handleSave = () => {
    const id = form.sessionSourceExamId?.trim()
    const payload: FormState = {
      course: form.course,
      testName: form.testName,
      teacherName: form.teacherName,
      departmentName: form.departmentName,
      studentCount: form.studentCount,
      imagesPerStudent: form.imagesPerStudent,
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
    setEditorOpen(false)
    const ipp = saved.imagesPerStudent
    if (ipp >= 1 && ipp <= 50) onSyncPagesPerStudent?.(ipp)
  }

  if (!ENABLE_WIZARD) return null
  if (!hydrated) {
    return (
      <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 text-sm text-slate-500">
        Cargando configuración guiada…
      </section>
    )
  }

  const hasStored = Boolean(liveDraft?.savedAt)
  const summaryDraft = liveDraft

  return (
    <section className="rounded-xl border border-indigo-200/80 bg-indigo-50/40 p-5 shadow-sm space-y-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        <span
          className={cn(
            "rounded-full border px-3 py-1",
            "border-indigo-400 bg-white text-indigo-900 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-100",
          )}
        >
          Paso 1 · Configuración
        </span>
        <span
          className={cn(
            "rounded-full border px-3 py-1",
            ready
              ? "border-emerald-500/60 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100"
              : "border-slate-200 bg-white/80 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300",
          )}
        >
          Paso 2 · Escaneo
        </span>
      </div>

      <div className="space-y-1">
        {ready ? (
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">Configuración lista</p>
        ) : (
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Puedes configurar la sesión antes de escanear
          </p>
        )}
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Recomendado: completa esta configuración antes de escanear para que luego en Evaluador solo extraigas nombres y evalúes.
        </p>
      </div>

      {hasStored && !editorOpen && summaryDraft?.savedAt ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40 space-y-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Ya tienes una sesión configurada</p>
          <ul className="list-none space-y-1 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
            <li>
              <span className="text-slate-500">Curso:</span> {summaryDraft.course.trim() || "—"}
            </li>
            <li>
              <span className="text-slate-500">Prueba:</span> {summaryDraft.testName.trim() || "—"}
            </li>
            <li>
              <span className="text-slate-500">Profesor:</span> {summaryDraft.teacherName.trim() || "—"}
            </li>
            {(summaryDraft.departmentName ?? "").trim() ? (
              <li>
                <span className="text-slate-500">Departamento:</span> {(summaryDraft.departmentName ?? "").trim()}
              </li>
            ) : null}
            <li className="pt-1 font-medium text-slate-900 dark:text-slate-100">
              {summaryDraft.studentCount} evaluaciones / estudiantes · {summaryDraft.imagesPerStudent} imágenes c/u ·{" "}
              {expectedImagesMeta(summaryDraft.studentCount, summaryDraft.imagesPerStudent)} imágenes esperadas en meta
            </li>
            {summaryDraft.sessionSourceExamId?.trim() ? (
              <li className="text-slate-600 dark:text-slate-400">
                <span className="text-slate-500">Prueba base (referencia local):</span>{" "}
                {(summaryDraft.sessionSourceExamTitle ?? "").trim() || summaryDraft.sessionSourceExamId.slice(0, 8)}
              </li>
            ) : null}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => {
                document.getElementById("docente-estacion-sync-mobile")?.scrollIntoView({ behavior: "smooth", block: "start" })
              }}
            >
              Usar configuración
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setForm(draftToForm(readWizardSession()))
                setEditorOpen(true)
              }}
            >
              Editar configuración
            </Button>
          </div>
        </div>
      ) : null}

      {hasStored && !editorOpen ? (
        <div className="rounded-md border border-dashed border-slate-200 bg-white/60 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
          Revisa los datos arriba y continúa al bloque «Sincronización móvil» cuando quieras. No se borran fotos ni el QR al
          editar la configuración.
        </div>
      ) : null}

      {editorOpen ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40 space-y-4">
          {hasStored ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Editar sesión guiada</p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-slate-600"
                onClick={() => {
                  setForm(draftToForm(readWizardSession()))
                  setEditorOpen(false)
                }}
              >
                Cerrar sin guardar
              </Button>
            </div>
          ) : (
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Completa lo que puedas; todo se guarda solo en este dispositivo.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="station-wiz-course">Curso</Label>
              <Input
                id="station-wiz-course"
                value={form.course}
                onChange={(e) => setForm((f) => ({ ...f, course: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="station-wiz-test">Nombre de la prueba</Label>
              <Input
                id="station-wiz-test"
                value={form.testName}
                onChange={(e) => setForm((f) => ({ ...f, testName: e.target.value }))}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-teacher">Profesor</Label>
              <Input
                id="station-wiz-teacher"
                value={form.teacherName}
                onChange={(e) => setForm((f) => ({ ...f, teacherName: e.target.value }))}
                autoComplete="name"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-dept">Departamento (opcional)</Label>
              <Input
                id="station-wiz-dept"
                value={form.departmentName}
                onChange={(e) => setForm((f) => ({ ...f, departmentName: e.target.value }))}
                autoComplete="organization"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="station-wiz-students">Estudiantes / evaluaciones a cubrir</Label>
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
              <p className="text-[11px] text-slate-500">
                Si indicas 1–50 y guardas, se copia a «Fotos por alumno» del lote (mismo valor que el flujo actual).
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Prueba base (opcional)</Label>
            <p className="text-[11px] text-slate-500">
              Referencia local; en /evaluar confirma con un clic si quieres usar la misma prueba base.
            </p>
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
                <SelectItem value="__none__">No recordar prueba base</SelectItem>
                {sourceExamOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.title?.trim() || o.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sourceExamLoading ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleSave}>
              Guardar configuración en este dispositivo
            </Button>
            {hasStored ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setForm(draftToForm(readWizardSession()))
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


