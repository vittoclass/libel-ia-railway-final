"use client"

/**
 * Panel de ítems de una prueba base (source_exam_items).
 * Solo lista, agrega, edita y elimina ítems de la prueba base. NO mezcla con evaluation ni respuestas del estudiante.
 */
import * as React from "react"
import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Loader2, RefreshCw, Plus, Pencil, Trash2, ArrowLeft, FileUp } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import SourceExamItemsImportDialog from "@/app/components/SourceExamItemsImportDialog"
import type { PedagogicalMetadata } from "@/app/lib/analyze-pedagogical-structure"

export type SourceExamItemRow = {
  id: string
  item_number: number | null
  item_text: string | null
  axis_id: string | null
  skill_id: string | null
  axis_label?: string | null
  skill_label?: string | null
  cognitive_level?: string | null
  competence: string | null
  difficulty: string | null
  question_type: string | null
  correct_answer: string | null
  max_score: number | null
  rubric_text: string | null
  created_at?: string | null
  /** Metadata pedagógica (generada al listar; solo visual). */
  pedagogical?: PedagogicalMetadata
}

type Props = {
  sourceExamId: string
  sourceExamTitle: string
  onBack: () => void
}

export default function SourceExamItemsPanel({ sourceExamId, sourceExamTitle, onBack }: Props) {
  const [items, setItems] = useState<SourceExamItemRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<SourceExamItemRow | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [formItemNumber, setFormItemNumber] = useState("")
  const [formItemText, setFormItemText] = useState("")
  const [formAxisId, setFormAxisId] = useState("")
  const [formSkillId, setFormSkillId] = useState("")
  const [formAxisLabel, setFormAxisLabel] = useState("")
  const [formSkillLabel, setFormSkillLabel] = useState("")
  const [formCognitiveLevel, setFormCognitiveLevel] = useState("")
  const [formCompetence, setFormCompetence] = useState("")
  const [formDifficulty, setFormDifficulty] = useState("")
  const [formQuestionType, setFormQuestionType] = useState("")
  const [formCorrectAnswer, setFormCorrectAnswer] = useState("")
  const [formMaxScore, setFormMaxScore] = useState("")
  const [formRubricText, setFormRubricText] = useState("")
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false)
  const [deleteAllLoading, setDeleteAllLoading] = useState(false)
  const { toast } = useToast()

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/source-exams/${sourceExamId}/items`, {
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      })
      const j = await r.json()
      if (r.ok && Array.isArray(j.items)) setItems(j.items)
      else setItems([])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [sourceExamId])

  useEffect(() => { loadItems() }, [loadItems])

  const openAddForm = () => {
    setEditingItem(null)
    setFormItemNumber(String((items.length + 1) || 1))
    setFormItemText("")
    setFormAxisId("")
    setFormSkillId("")
    setFormAxisLabel("")
    setFormSkillLabel("")
    setFormCognitiveLevel("")
    setFormCompetence("")
    setFormDifficulty("")
    setFormQuestionType("")
    setFormCorrectAnswer("")
    setFormMaxScore("")
    setFormRubricText("")
    setEditModalOpen(true)
  }

  const openEditForm = (item: SourceExamItemRow) => {
    setEditingItem(item)
    setFormItemNumber(item.item_number != null ? String(item.item_number) : "")
    setFormItemText(item.item_text ?? "")
    setFormAxisId(item.axis_id ?? "")
    setFormSkillId(item.skill_id ?? "")
    setFormAxisLabel(item.axis_label ?? "")
    setFormSkillLabel(item.skill_label ?? "")
    setFormCognitiveLevel(item.cognitive_level ?? "")
    setFormCompetence(item.competence ?? "")
    setFormDifficulty(item.difficulty ?? "")
    setFormQuestionType(item.question_type ?? "")
    setFormCorrectAnswer(item.correct_answer ?? "")
    setFormMaxScore(item.max_score != null ? String(item.max_score) : "")
    setFormRubricText(item.rubric_text ?? "")
    setEditModalOpen(true)
  }

  const handleSaveItem = async () => {
    setSaving(true)
    try {
      const itemNumber = formItemNumber.trim() ? parseInt(formItemNumber, 10) : null
      const payload = {
        item_number: Number.isNaN(itemNumber as number) ? null : itemNumber,
        item_text: formItemText.trim() || null,
        axis_id: formAxisId.trim() || null,
        skill_id: formSkillId.trim() || null,
        axis_label: formAxisLabel.trim() || null,
        skill_label: formSkillLabel.trim() || null,
        cognitive_level: formCognitiveLevel.trim() || null,
        competence: formCompetence.trim() || null,
        difficulty: formDifficulty.trim() || null,
        question_type: formQuestionType.trim() || null,
        correct_answer: formCorrectAnswer.trim() || null,
        max_score: formMaxScore.trim() ? (() => { const n = parseInt(formMaxScore, 10); return Number.isNaN(n) ? null : n; })() : null,
        rubric_text: formRubricText.trim() || null,
      }
      const fetchOpts = {
        cache: "no-store" as const,
        credentials: "include" as const,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      }
      if (editingItem) {
        const r = await fetch(`/api/source-exams/${sourceExamId}/items/${editingItem.id}`, {
          method: "PATCH",
          ...fetchOpts,
          body: JSON.stringify(payload),
        })
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
        if (r.ok && j.item) {
          toast({ title: "Ítem actualizado." })
          setEditModalOpen(false)
          loadItems()
        } else {
          alert(JSON.stringify({ httpStatus: r.status, ...j }, null, 2))
          toast({ title: (j.error as string) || "Error al actualizar", variant: "destructive" })
        }
      } else {
        const r = await fetch(`/api/source-exams/${sourceExamId}/items`, {
          method: "POST",
          ...fetchOpts,
          body: JSON.stringify({ items: [payload] }),
        })
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
        if (r.ok && ((Array.isArray(j.items) ? j.items.length : 0) > 0 || Number(j.inserted_count ?? 0) > 0)) {
          toast({ title: "Ítem agregado." })
          setEditModalOpen(false)
          loadItems()
        } else {
          alert(JSON.stringify({ httpStatus: r.status, ...j }, null, 2))
          toast({ title: (j.error as string) || "Error al agregar", variant: "destructive" })
        }
      }
    } catch (e) {
      alert(JSON.stringify({ error: "fetch_failed", message: e instanceof Error ? e.message : String(e) }, null, 2))
      toast({ title: "Error de conexión", variant: "destructive" })
    } finally {
      setSaving(false)
      queueMicrotask(() => setSaving(false))
    }
  }

  const handleDelete = async (itemId: string) => {
    setSaving(true)
    try {
      const r = await fetch(`/api/source-exams/${sourceExamId}/items/${itemId}`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      })
      if (r.ok) {
        toast({ title: "Ítem eliminado." })
        setDeleteConfirmId(null)
        loadItems()
      } else {
        const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
        alert(JSON.stringify({ httpStatus: r.status, ...j }, null, 2))
        toast({ title: (j.error as string) || "Error al eliminar", variant: "destructive" })
      }
    } catch (e) {
      alert(JSON.stringify({ error: "fetch_failed", message: e instanceof Error ? e.message : String(e) }, null, 2))
      toast({ title: "Error de conexión", variant: "destructive" })
    } finally {
      setSaving(false)
      queueMicrotask(() => setSaving(false))
    }
  }

  const handleDeleteAllItems = async () => {
    setDeleteAllLoading(true)
    try {
      const r = await fetch(`/api/source-exams/${sourceExamId}/items`, {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      })
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
      if (r.ok && j.ok) {
        toast({ title: `Se borraron ${j.deleted_count ?? 0} ítems.` })
        setDeleteAllConfirmOpen(false)
        loadItems()
      } else {
        alert(JSON.stringify({ httpStatus: r.status, ...j }, null, 2))
        toast({ title: (j.error as string) || "Error al borrar ítems", variant: "destructive" })
      }
    } catch (e) {
      alert(JSON.stringify({ error: "fetch_failed", message: e instanceof Error ? e.message : String(e) }, null, 2))
      toast({ title: "Error de conexión", variant: "destructive" })
    } finally {
      setDeleteAllLoading(false)
      queueMicrotask(() => setDeleteAllLoading(false))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver al listado
        </Button>
      </div>
      <Card className="bg-[var(--bg-card)] border-[var(--border-color)]">
        <CardHeader>
          <CardTitle className="text-base">Ítems de la prueba base</CardTitle>
          <CardDescription>
            {sourceExamTitle || "(Sin título)"} — Aquí se gestionan los ítems (preguntas) del instrumento en blanco. No son respuestas del estudiante.
          </CardDescription>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={loadItems} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} /> Recargar
            </Button>
            <Button size="sm" onClick={openAddForm}>
              <Plus className="h-4 w-4 mr-1" /> Agregar ítem
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(true)}>
              <FileUp className="h-4 w-4 mr-1" /> Importar ítems
            </Button>
            {items.length > 0 && (
              <Button variant="outline" size="sm" className="text-amber-600 hover:text-amber-700" onClick={() => setDeleteAllConfirmOpen(true)}>
                <Trash2 className="h-4 w-4 mr-1" /> Borrar todos los ítems
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando ítems...
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No hay ítems. Agrega uno con el botón de arriba.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Enunciado / texto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Resp. correcta</TableHead>
                  <TableHead>Puntaje</TableHead>
                  <TableHead>Eje (axis_id)</TableHead>
                  <TableHead>Habilidad</TableHead>
                  <TableHead className="w-24">Nivel cognitivo</TableHead>
                  <TableHead className="w-20">Dific. est.</TableHead>
                  <TableHead>Competencia</TableHead>
                  <TableHead>Dificultad</TableHead>
                  <TableHead className="w-24">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.item_number ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate" title={item.item_text ?? ""}>{item.item_text ?? "—"}</TableCell>
                    <TableCell className="text-xs">{item.question_type ?? "multiple_choice"}</TableCell>
                    <TableCell className="text-xs">{item.correct_answer ?? "—"}</TableCell>
                    <TableCell>{item.max_score ?? "—"}</TableCell>
                    <TableCell className="max-w-[80px] truncate" title={(item.axis_label ?? item.axis_id) ?? ""}>
                      {(item.axis_label ?? "").trim() || (item.axis_id ? "…" : "—")}
                    </TableCell>
                    <TableCell className="max-w-[80px] truncate" title={(item.skill_label ?? item.pedagogical?.skill ?? item.skill_id) ?? ""}>
                      {(item.skill_label ?? "").trim() || item.pedagogical?.skill || item.skill_id || "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground" title={(item.cognitive_level ?? item.pedagogical?.cognitive_level) ?? ""}>
                      {(item.cognitive_level ?? "").trim() || item.pedagogical?.cognitive_level || "—"}
                    </TableCell>
                    <TableCell className="text-xs">{item.pedagogical?.difficulty ?? "—"}</TableCell>
                    <TableCell>{item.competence ?? "—"}</TableCell>
                    <TableCell>{item.difficulty ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEditForm(item)} title="Editar">
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                        onClick={() => setDeleteConfirmId(item.id)}
                        title="Eliminar"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Editar ítem" : "Nuevo ítem"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Número de ítem</Label>
              <Input type="number" value={formItemNumber} onChange={(e) => setFormItemNumber(e.target.value)} placeholder="1" />
            </div>
            <div>
              <Label>Enunciado / texto</Label>
              <Input value={formItemText} onChange={(e) => setFormItemText(e.target.value)} placeholder="Texto del ítem" />
            </div>
            <div>
              <Label>Eje (axis_id)</Label>
              <Input value={formAxisId} onChange={(e) => setFormAxisId(e.target.value)} placeholder="UUID del diccionario (opcional)" />
            </div>
            <div>
              <Label>Eje (texto / etiqueta)</Label>
              <Input value={formAxisLabel} onChange={(e) => setFormAxisLabel(e.target.value)} placeholder="Ej. Números, Lectura" />
            </div>
            <div>
              <Label>Habilidad (skill_id)</Label>
              <Input value={formSkillId} onChange={(e) => setFormSkillId(e.target.value)} placeholder="UUID del diccionario (opcional)" />
            </div>
            <div>
              <Label>Habilidad (texto)</Label>
              <Input value={formSkillLabel} onChange={(e) => setFormSkillLabel(e.target.value)} placeholder="Ej. Relacionar, Localizar información" />
            </div>
            <div>
              <Label>Nivel cognitivo</Label>
              <Input value={formCognitiveLevel} onChange={(e) => setFormCognitiveLevel(e.target.value)} placeholder="Ej. aplicar, analizar, Relacionar" />
            </div>
            <div>
              <Label>Competencia</Label>
              <Input value={formCompetence} onChange={(e) => setFormCompetence(e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <Label>Dificultad</Label>
              <Input value={formDifficulty} onChange={(e) => setFormDifficulty(e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <Label>Tipo de pregunta</Label>
              <Input value={formQuestionType} onChange={(e) => setFormQuestionType(e.target.value)} placeholder="multiple_choice, true_false, short_answer, essay" />
            </div>
            <div>
              <Label>Respuesta correcta (alternativas)</Label>
              <Input value={formCorrectAnswer} onChange={(e) => setFormCorrectAnswer(e.target.value)} placeholder="Ej. A, B, D, V, F" />
            </div>
            <div>
              <Label>Puntaje máximo</Label>
              <Input type="number" min={0} value={formMaxScore} onChange={(e) => setFormMaxScore(e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <Label>Rúbrica / criterio (desarrollo)</Label>
              <Input value={formRubricText} onChange={(e) => setFormRubricText(e.target.value)} placeholder="Opcional" className="min-h-[60px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveItem} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingItem ? "Guardar" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar ítem</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">¿Eliminar este ítem? Esta acción no afecta evaluaciones ya guardadas.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteAllConfirmOpen} onOpenChange={setDeleteAllConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Borrar todos los ítems</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-[var(--text-muted)]">
            ¿Seguro que deseas borrar los {items.length} ítems de esta prueba base? Esta acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllConfirmOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteAllItems} disabled={deleteAllLoading}>
              {deleteAllLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Borrar todos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SourceExamItemsImportDialog
        sourceExamId={sourceExamId}
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImported={loadItems}
      />
    </div>
  )
}
