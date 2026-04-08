"use client"

/**
 * Sección "Pruebas base" / Banco de pruebas base.
 * Capa aditiva: solo lista y crea source_exams. NO mezcla con evaluation, answer_key ni rubric.
 * Instrumento en blanco = prueba base. Evaluación respondida = evaluación del estudiante.
 * Permite abrir el detalle de una prueba base para gestionar sus ítems (source_exam_items).
 */
import * as React from "react"
import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, RefreshCw, BookOpen, Plus, List, Pencil } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import SourceExamItemsPanel from "@/app/components/SourceExamItemsPanel"

type SourceExamItem = {
  id: string
  title: string | null
  subject: string | null
  course_label: string | null
  exam_type: string | null
  pedagogy_mode: string | null
  created_at?: string | null
}

function SourceExamTitleField({
  row,
  onTitleSaved,
}: {
  row: SourceExamItem
  onTitleSaved: (id: string, title: string) => void
}) {
  const [value, setValue] = React.useState(row.title ?? "")
  const [saving, setSaving] = React.useState(false)
  const { toast } = useToast()

  React.useEffect(() => {
    setValue(row.title ?? "")
  }, [row.id, row.title])

  const commit = React.useCallback(async () => {
    const next = value.trim() === "" ? "Sin título" : value.trim()
    const prevNorm = !row.title?.trim() ? "Sin título" : row.title.trim()
    if (next === prevNorm) return

    setSaving(true)
    try {
      const r = await fetch(`/api/source-exams/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: value }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast({
          title: typeof j.error === "string" ? j.error : "No se pudo guardar el título",
          variant: "destructive",
        })
        setValue(row.title ?? "")
        return
      }
      const saved = typeof j.source_exam?.title === "string" ? j.source_exam.title : next
      setValue(saved)
      onTitleSaved(row.id, saved)
    } catch {
      toast({ title: "Error de conexión al guardar el título", variant: "destructive" })
      setValue(row.title ?? "")
    } finally {
      setSaving(false)
    }
  }, [value, row.id, row.title, onTitleSaved, toast])

  return (
    <div className="flex items-center gap-2 min-w-[10rem] max-w-[min(28rem,100%)]">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            ;(e.currentTarget as HTMLInputElement).blur()
          }
          if (e.key === "Escape") {
            setValue(row.title ?? "")
            ;(e.currentTarget as HTMLInputElement).blur()
          }
        }}
        placeholder="Sin título"
        disabled={saving}
        aria-label={`Título de la prueba base ${row.id}`}
        className={cn(
          "h-8 text-sm bg-transparent shadow-none",
          "border border-transparent hover:border-[var(--border-color)]",
          "focus-visible:border-[var(--border-color)] focus-visible:ring-1 focus-visible:ring-[var(--text-accent)]/20",
        )}
      />
      {saving ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--text-muted)]" aria-hidden />
      ) : (
        <Pencil className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-40 pointer-events-none" aria-hidden />
      )}
    </div>
  )
}

export default function SourceExamsSection() {
  const [list, setList] = useState<SourceExamItem[]>([])
  const [loading, setLoading] = useState(true)
  const [createLoading, setCreateLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [formTitle, setFormTitle] = useState("")
  const [formSubject, setFormSubject] = useState("")
  const [formCourseLabel, setFormCourseLabel] = useState("")
  const [formExamType, setFormExamType] = useState("")
  const [formPedagogyMode, setFormPedagogyMode] = useState("")
  const [selectedSourceExamId, setSelectedSourceExamId] = useState<string | null>(null)
  const [selectedSourceExamTitle, setSelectedSourceExamTitle] = useState<string | null>(null)
  const { toast } = useToast()

  const loadList = React.useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const r = await fetch("/api/source-exams", { credentials: "include" })
      const j = await r.json()
      if (r.ok && Array.isArray(j.source_exams)) {
        setList(j.source_exams)
        if (j.message) setMessage(j.message)
      } else {
        setList([])
        setMessage(j.error || "No se pudo cargar la lista.")
      }
    } catch {
      setList([])
      setMessage("Error de conexión.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  const handleTitleSaved = React.useCallback((id: string, title: string) => {
    setList((prev) => prev.map((x) => (x.id === id ? { ...x, title } : x)))
    if (selectedSourceExamId === id) {
      setSelectedSourceExamTitle(title)
    }
  }, [selectedSourceExamId])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreateLoading(true)
    try {
      const r = await fetch("/api/source-exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: formTitle.trim() || "Sin título",
          subject: formSubject.trim() || undefined,
          course_label: formCourseLabel.trim() || undefined,
          exam_type: formExamType.trim() || undefined,
          pedagogy_mode: formPedagogyMode.trim() || undefined,
        }),
      })
      const j = await r.json()
      if (r.ok && j.source_exam) {
        toast({ title: "Prueba base creada." })
        setFormTitle("")
        setFormSubject("")
        setFormCourseLabel("")
        setFormExamType("")
        setFormPedagogyMode("")
        loadList()
      } else {
        toast({ title: j.error || "Error al crear", variant: "destructive" })
      }
    } catch {
      toast({ title: "Error al crear prueba base", variant: "destructive" })
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BookOpen className="h-6 w-6 text-[var(--text-accent)]" />
        <h2 className="text-xl font-bold text-[var(--text-accent)]">Pruebas base</h2>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        Banco de instrumentos en blanco (pruebas base). Aquí se registran y listan; luego puedes asociar una evaluación a una prueba base desde el detalle de la evaluación. En cada prueba base puedes gestionar sus ítems (preguntas del instrumento).
      </p>

      {selectedSourceExamId && selectedSourceExamTitle != null ? (
        <SourceExamItemsPanel
          sourceExamId={selectedSourceExamId}
          sourceExamTitle={selectedSourceExamTitle}
          onBack={() => { setSelectedSourceExamId(null); setSelectedSourceExamTitle(null) }}
        />
      ) : (
        <>
      <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
        <CardHeader>
          <CardTitle className="text-base">Nueva prueba base</CardTitle>
          <CardDescription>Registra un instrumento en blanco (sin subir archivo en esta fase).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 max-w-md">
            <div>
              <Label htmlFor="se-title">Título</Label>
              <Input
                id="se-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Ej. Prueba Lenguaje 4° medio"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="se-subject">Asignatura</Label>
              <Input
                id="se-subject"
                value={formSubject}
                onChange={(e) => setFormSubject(e.target.value)}
                placeholder="Ej. Lenguaje"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="se-course">Curso / Nivel</Label>
              <Input
                id="se-course"
                value={formCourseLabel}
                onChange={(e) => setFormCourseLabel(e.target.value)}
                placeholder="Ej. 4° medio"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Tipo de instrumento</Label>
              <Select value={formExamType || "none"} onValueChange={(v) => setFormExamType(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="simce">SIMCE</SelectItem>
                  <SelectItem value="paes">PAES</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Modo pedagógico</Label>
              <Select value={formPedagogyMode || "none"} onValueChange={(v) => setFormPedagogyMode(v === "none" ? "" : v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="text">Texto</SelectItem>
                  <SelectItem value="structured">Estructurado</SelectItem>
                  <SelectItem value="source_exam">Prueba base</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={createLoading}>
              {createLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Crear prueba base
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Listado de pruebas base</CardTitle>
              <CardDescription>Instrumentos en blanco registrados en tu cuenta.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={loadList} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
              Recargar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {message && <p className="text-sm text-[var(--text-muted)] mb-3">{message}</p>}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
            </p>
          ) : list.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No hay pruebas base. Crea una arriba.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Asignatura</TableHead>
                  <TableHead>Curso</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="w-28">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="align-middle py-2">
                      <SourceExamTitleField row={row} onTitleSaved={handleTitleSaved} />
                    </TableCell>
                    <TableCell>{row.subject ?? "—"}</TableCell>
                    <TableCell>{row.course_label ?? "—"}</TableCell>
                    <TableCell>{row.exam_type ?? "—"}</TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => { setSelectedSourceExamId(row.id); setSelectedSourceExamTitle(row.title ?? "(Sin título)") }}
                      >
                        <List className="h-3 w-3 mr-1" /> Ver ítems
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </>
      )}
    </div>
  )
}
