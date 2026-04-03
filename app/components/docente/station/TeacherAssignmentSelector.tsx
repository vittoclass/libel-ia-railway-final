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
      <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-900">
        No hay filas en <code className="text-xs">teacher_assignments</code> para su usuario. Puede continuar con el lote;
        cuando UTP cargue su carga horaria, el menú mostrará opciones tipo «Lenguaje — 8° L».
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
