"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  buildWizardCourseFromParts,
  expectedImagesMeta,
  readWizardSession,
  type TeacherWizardSessionDraft,
  type WizardSessionTipoPrueba,
  writeWizardSession,
} from "./sessionStorage"

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

type SessionFormState = {
  courseLevel: string
  courseLetter: string
  testName: string
  teacherName: string
  departmentName: string
  subjectName: string
  tipoPrueba: WizardSessionTipoPrueba
  studentCount: number
  imagesPerStudent: number
  sessionSourceExamId?: string
  sessionSourceExamTitle?: string | null
}

function emptyForm(): SessionFormState {
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
  }
}

function draftToForm(d: TeacherWizardSessionDraft): SessionFormState {
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
    ...(d.sessionSourceExamId
      ? { sessionSourceExamId: d.sessionSourceExamId, sessionSourceExamTitle: d.sessionSourceExamTitle ?? null }
      : {}),
  }
}

export function SessionConfigPanel({ open, onClose, onSaved }: Props) {
  const [form, setForm] = useState(emptyForm)
  const [saved, setSaved] = useState<TeacherWizardSessionDraft | null>(null)
  const [sourceExamOptions, setSourceExamOptions] = useState<Array<{ id: string; title: string | null }>>([])
  const [sourceExamLoading, setSourceExamLoading] = useState(false)

  const hydrate = useCallback(() => {
    const existing = readWizardSession()
    if (existing?.savedAt) {
      setSaved(existing)
      setForm(draftToForm(existing))
    } else {
      setSaved(null)
      setForm(emptyForm())
    }
  }, [])

  useEffect(() => {
    if (!open) return
    hydrate()
  }, [open, hydrate])

  useEffect(() => {
    if (!open) return
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
  }, [open])

  if (!open) return null

  const handleSave = () => {
    const id = form.sessionSourceExamId?.trim()
    const level = form.courseLevel.trim()
    const letter = form.courseLetter.trim()
    const draft = writeWizardSession({
      course: buildWizardCourseFromParts(level, letter),
      courseLevel: level,
      ...(letter ? { courseLetter: letter } : {}),
      testName: form.testName,
      teacherName: form.teacherName,
      departmentName: form.departmentName.trim() || undefined,
      subjectName: form.subjectName.trim() || undefined,
      tipoPrueba: form.tipoPrueba,
      studentCount: form.studentCount,
      imagesPerStudent: form.imagesPerStudent,
      ...(id
        ? {
            sessionSourceExamId: id,
            sessionSourceExamTitle: form.sessionSourceExamTitle ?? sourceExamOptions.find((o) => o.id === id)?.title ?? null,
          }
        : {}),
    })
    setSaved(draft)
    onSaved()
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-3 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="teacher-wizard-session-title"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--bg-page)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id="teacher-wizard-session-title" className="text-base font-semibold text-[var(--text)]">
            Configurar sesión (guía visual)
          </h2>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-sm text-[var(--text-muted)] hover:bg-[var(--border-color)]/40 hover:text-[var(--text)]"
            onClick={onClose}
          >
            Cerrar
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Misma información que en la estación QR. Solo se guarda en este dispositivo.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Profesor</span>
            <input
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.teacherName}
              onChange={(e) => setForm((f) => ({ ...f, teacherName: e.target.value }))}
              autoComplete="name"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Departamento</span>
            <input
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.departmentName}
              onChange={(e) => setForm((f) => ({ ...f, departmentName: e.target.value }))}
              autoComplete="organization"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Asignatura</span>
            <input
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.subjectName}
              onChange={(e) => setForm((f) => ({ ...f, subjectName: e.target.value }))}
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Nombre de la prueba</span>
            <input
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.testName}
              onChange={(e) => setForm((f) => ({ ...f, testName: e.target.value }))}
              autoComplete="off"
            />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Tipo de prueba</span>
            <Select
              value={form.tipoPrueba}
              onValueChange={(v) => setForm((f) => ({ ...f, tipoPrueba: v as WizardSessionTipoPrueba }))}
            >
              <SelectTrigger className="w-full border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solo_alternativas">Solo alternativas</SelectItem>
                <SelectItem value="solo_desarrollo">Solo desarrollo</SelectItem>
                <SelectItem value="mixta">Mixta</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Curso / nivel</span>
            <input
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.courseLevel}
              onChange={(e) => setForm((f) => ({ ...f, courseLevel: e.target.value }))}
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Letra del curso (opcional)</span>
            <input
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.courseLetter}
              onChange={(e) => setForm((f) => ({ ...f, courseLetter: e.target.value }))}
              autoComplete="off"
              maxLength={8}
            />
            <span className="text-[11px] text-[var(--text-muted)]">
              Curso final: {buildWizardCourseFromParts(form.courseLevel, form.courseLetter).trim() || "—"}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Estudiantes a evaluar</span>
            <input
              type="number"
              min={0}
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.studentCount || ""}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                setForm((f) => ({ ...f, studentCount: Number.isFinite(n) && n >= 0 ? n : 0 }))
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Imágenes / hojas por estudiante</span>
            <input
              type="number"
              min={0}
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.imagesPerStudent || ""}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                setForm((f) => ({ ...f, imagesPerStudent: Number.isFinite(n) && n >= 0 ? n : 0 }))
              }}
            />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Prueba base (opcional)</span>
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
              <SelectTrigger className="w-full border-[var(--border-color)] bg-[var(--bg-page)] text-[var(--text)]">
                <SelectValue placeholder={sourceExamLoading ? "Cargando…" : "Sin prueba base asociada"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No recordar prueba base en la sesión</SelectItem>
                {sourceExamOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.title?.trim() || o.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sourceExamLoading ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Cargando listado…
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700"
            onClick={handleSave}
          >
            Guardar en este dispositivo
          </button>
        </div>

        {saved?.savedAt ? (
          <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-[var(--text)]">
            <p className="font-medium text-emerald-900 dark:text-emerald-100">Resumen</p>
            <ul className="mt-2 list-none space-y-1 text-xs sm:text-sm">
              <li>
                <span className="text-[var(--text-muted)]">Curso:</span> {saved.course || "—"}
              </li>
              <li>
                <span className="text-[var(--text-muted)]">Asignatura:</span> {(saved.subjectName ?? "").trim() || "—"}
              </li>
              <li>
                <span className="text-[var(--text-muted)]">Tipo de prueba:</span>{" "}
                {saved.tipoPrueba === "solo_alternativas"
                  ? "Solo alternativas"
                  : saved.tipoPrueba === "solo_desarrollo"
                    ? "Solo desarrollo"
                    : "Mixta"}
              </li>
              <li>
                <span className="text-[var(--text-muted)]">Prueba:</span> {saved.testName || "—"}
              </li>
              <li>
                <span className="text-[var(--text-muted)]">Profesor:</span> {saved.teacherName || "—"}
              </li>
              {(saved.departmentName ?? "").trim() ? (
                <li>
                  <span className="text-[var(--text-muted)]">Departamento:</span> {(saved.departmentName ?? "").trim()}
                </li>
              ) : null}
              <li>
                <span className="text-[var(--text-muted)]">Prueba base:</span>{" "}
                {(() => {
                  const bid = (saved.sessionSourceExamId ?? "").trim()
                  const bt = (saved.sessionSourceExamTitle ?? "").trim()
                  return bid ? bt || bid.slice(0, 8) : "—"
                })()}
              </li>
              <li className="pt-1 font-medium">
                Meta: {saved.studentCount} estudiantes × {saved.imagesPerStudent} imágenes ={" "}
                {expectedImagesMeta(saved.studentCount, saved.imagesPerStudent)} imágenes esperadas
              </li>
            </ul>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              Meta según configuración del profesor. No modifica el escaneo real.
            </p>
            <Link
              href="/docente/estacion"
              className="mt-3 inline-flex rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              onClick={onClose}
            >
              Ir a estación QR
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  )
}
