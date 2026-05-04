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
  expectedImagesMeta,
  readWizardSession,
  type TeacherWizardSessionDraft,
  writeWizardSession,
} from "./sessionStorage"

type Props = {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

type SessionFormState = Omit<TeacherWizardSessionDraft, "savedAt">

function emptyForm(): SessionFormState {
  return {
    course: "",
    testName: "",
    teacherName: "",
    studentCount: 0,
    imagesPerStudent: 0,
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
      setForm({
        course: existing.course,
        testName: existing.testName,
        teacherName: existing.teacherName,
        studentCount: existing.studentCount,
        imagesPerStudent: existing.imagesPerStudent,
        ...(existing.sessionSourceExamId
          ? {
              sessionSourceExamId: existing.sessionSourceExamId,
              sessionSourceExamTitle: existing.sessionSourceExamTitle ?? null,
            }
          : {}),
      })
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
    const payload: SessionFormState = {
      course: form.course,
      testName: form.testName,
      teacherName: form.teacherName,
      studentCount: form.studentCount,
      imagesPerStudent: form.imagesPerStudent,
      ...(id
        ? {
            sessionSourceExamId: id,
            sessionSourceExamTitle: form.sessionSourceExamTitle ?? sourceExamOptions.find((o) => o.id === id)?.title ?? null,
          }
        : {}),
    }
    const draft = writeWizardSession(payload)
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
          Esto no envía datos al servidor ni modifica evaluaciones. Solo ayuda a orientarte durante el flujo.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-[var(--text-muted)]">Curso</span>
            <input
              className="rounded-md border border-[var(--border-color)] bg-[var(--bg-page)] px-2 py-1.5 text-[var(--text)]"
              value={form.course}
              onChange={(e) => setForm((f) => ({ ...f, course: e.target.value }))}
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
            <span className="text-[var(--text-muted)]">Prueba base (opcional, referencia en este dispositivo)</span>
            <p className="text-[11px] text-[var(--text-muted)] leading-snug">
              Solo se guarda si eliges una opción; no sustituye seleccionar la prueba en el Evaluador hasta que confirmes allí.
            </p>
            <Select
              disabled={sourceExamLoading}
              value={form.sessionSourceExamId?.trim() ? form.sessionSourceExamId : "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  setForm((f) => ({
                    course: f.course,
                    testName: f.testName,
                    teacherName: f.teacherName,
                    studentCount: f.studentCount,
                    imagesPerStudent: f.imagesPerStudent,
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
                <span className="text-[var(--text-muted)]">Prueba:</span> {saved.testName || "—"}
              </li>
              <li>
                <span className="text-[var(--text-muted)]">Profesor:</span> {saved.teacherName || "—"}
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
