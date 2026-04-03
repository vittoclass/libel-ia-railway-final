"use client"

import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type TeacherAssignmentOption = {
  id: string
  subject: string
  course_label: string
  semester: string
  academic_year: number
}

type Props = {
  assignments: TeacherAssignmentOption[]
  value: string | null
  onChange: (id: string | null, row: TeacherAssignmentOption | null) => void
  disabled?: boolean
}

export function TeacherAssignmentSelector({ assignments, value, onChange, disabled }: Props) {
  if (assignments.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-3 text-sm text-amber-950 space-y-2">
        <p className="font-medium">No tienes cursos asignados hoy. ¡Dile a UTP que te los cargue!</p>
        <p className="text-amber-900/90 text-xs leading-relaxed">
          Mientras tanto puedes seguir con el lote y el QR; cuando existan filas en{" "}
          <code className="rounded bg-amber-100/80 px-1">teacher_assignments</code> vinculadas a tu perfil, aquí verás
          opciones como «Lenguaje — 8° Básico A».
        </p>
      </div>
    )
  }

  const byId = new Map(assignments.map((a) => [a.id, a]))

  return (
    <div className="space-y-2">
      <Label htmlFor="teacher-assignment-select">Carga horaria (contexto)</Label>
      <Select
        disabled={disabled}
        value={value ?? ""}
        onValueChange={(v) => {
          if (!v) {
            onChange(null, null)
            return
          }
          const row = byId.get(v) ?? null
          onChange(v, row)
        }}
      >
        <SelectTrigger id="teacher-assignment-select" className="max-w-xl">
          <SelectValue placeholder="Elija curso y asignatura…" />
        </SelectTrigger>
        <SelectContent>
          {assignments.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.subject} — {a.course_label}{" "}
              <span className="text-muted-foreground text-xs">({a.semester} · {a.academic_year})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
