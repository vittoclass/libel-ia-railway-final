"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { es } from "date-fns/locale"
import { Loader2, Eye, FileText, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type EvalRow = {
  id: string
  title: string | null
  course_id: string | null
  subject: string | null
  evaluated_at: string | null
  status?: string | null
  grade_chile?: number | null
}

export default function EvaluacionesPage() {
  const [evaluations, setEvaluations] = useState<EvalRow[]>([])
  const [reason, setReason] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [authHealth, setAuthHealth] = useState<Record<string, unknown> | null>(null)

  const fetchList = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (statusFilter) params.set("status", statusFilter)
      const res = await fetch(`/api/evaluations/list?${params.toString()}`, { credentials: "include" })
      const data = await res.json()
      if (res.ok) {
        setEvaluations(data.evaluations ?? [])
        setReason(data.reason ?? null)
        setMessage(data.message ?? null)
      } else {
        setEvaluations([])
        setReason(null)
        setMessage(res.status === 401 ? "Inicia sesión para ver evaluaciones." : "Error al cargar.")
      }
    } catch {
      setEvaluations([])
      setReason(null)
      setMessage("Error de conexión.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
  }, [statusFilter])

  useEffect(() => {
    const t = setTimeout(() => {
      fetchList()
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    fetch("/api/debug/auth-health", { credentials: "include" })
      .then((r) => (r.status === 200 ? r.json() : null))
      .then(setAuthHealth)
      .catch(() => setAuthHealth(null))
  }, [])

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-[var(--text-accent)]">Evaluaciones</h1>
          <Link href="/evaluar">
            <Button>Nueva evaluación</Button>
          </Link>
        </div>

        {reason === "PROFILE_NOT_ONBOARDED" && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>{message ?? "Para guardar y ver historial, completa tu perfil."}</p>
            <Link href="/perfil">
              <Button variant="outline" size="sm">Completar perfil</Button>
            </Link>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          <Input
            placeholder="Buscar por título..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              <SelectItem value="draft">Borrador</SelectItem>
              <SelectItem value="final">Final</SelectItem>
              <SelectItem value="archived">Archivado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Cargando evaluaciones...</span>
          </div>
        ) : evaluations.length === 0 ? (
          <p className="text-[var(--text-muted)]">
            {reason === "PROFILE_NOT_ONBOARDED"
              ? "Completa tu perfil para ver aquí tus evaluaciones guardadas."
              : "No hay evaluaciones que coincidan con los filtros."}
          </p>
        ) : (
          <div className="rounded-md border border-[var(--border-color)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Curso</TableHead>
                  <TableHead>Asignatura</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evaluations.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-[var(--text-muted)]">
                      {e.evaluated_at
                        ? format(new Date(e.evaluated_at), "dd/MM/yyyy HH:mm", { locale: es })
                        : "—"}
                    </TableCell>
                    <TableCell>{e.course_id ?? "—"}</TableCell>
                    <TableCell>{e.subject ?? "—"}</TableCell>
                    <TableCell>{e.title ?? "Sin título"}</TableCell>
                    <TableCell>{e.status ?? "draft"}</TableCell>
                    <TableCell>{e.grade_chile != null ? e.grade_chile.toFixed(1) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/evaluaciones/${e.id}`}>
                        <Button variant="ghost" size="sm" className="gap-1">
                          <Eye className="h-4 w-4" />
                          Ver
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {authHealth != null && (
          <section className="rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] p-4">
            <h2 className="text-sm font-semibold text-[var(--text-muted)] mb-2">Diagnóstico (solo desarrollo)</h2>
            <pre className="text-xs overflow-auto max-h-40 text-[var(--text)]">
              {JSON.stringify(authHealth, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </main>
  )
}
