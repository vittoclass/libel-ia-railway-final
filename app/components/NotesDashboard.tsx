"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { format } from "date-fns"

interface StudentGroup {
  id: string
  studentName: string
  puntaje?: string
  nota?: number | string
  isEvaluated: boolean
  retroalimentacion?: {
    resumen_general?: {
      fortalezas: string
      areas_mejora: string
    }
  }
}

interface Props {
  studentGroups: StudentGroup[]
  curso?: string
  fecha?: Date
}

export default function NotesDashboard({ studentGroups, curso, fecha }: Props) {
  const evaluatedGroups = useMemo(
    () => studentGroups.filter((g) => g.isEvaluated),
    [studentGroups]
  )

  const stats = useMemo(() => {
    if (evaluatedGroups.length === 0) return null

    const notas = evaluatedGroups
      .map((g) => Number(g.nota) || 0)
      .filter((n) => n > 0)

    if (notas.length === 0) return null

    const promedio = notas.reduce((a, b) => a + b, 0) / notas.length
    const aprobados = notas.filter((n) => n >= 4.0).length
    const reprobados = notas.length - aprobados
    const notaMaxima = Math.max(...notas)
    const notaMinima = Math.min(...notas)

    return {
      total: evaluatedGroups.length,
      promedio: promedio.toFixed(1),
      aprobados,
      reprobados,
      porcentajeAprobacion: ((aprobados / notas.length) * 100).toFixed(1),
      notaMaxima: notaMaxima.toFixed(1),
      notaMinima: notaMinima.toFixed(1),
    }
  }, [evaluatedGroups])

  if (evaluatedGroups.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center py-10">
          <p className="text-sm text-muted-foreground">
            No hay evaluaciones completadas para mostrar en el dashboard.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Información del curso */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        {curso && <span>Curso: <strong>{curso}</strong></span>}
        {fecha && <span>Fecha: <strong>{format(fecha, "dd/MM/yyyy")}</strong></span>}
        <span>Total evaluados: <strong>{evaluatedGroups.length}</strong></span>
      </div>

      {/* Estadísticas */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Promedio</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-primary">{stats.promedio}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Aprobados</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{stats.aprobados}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Reprobados</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-red-600">{stats.reprobados}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">% Aprobación</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.porcentajeAprobacion}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Nota Máxima</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{stats.notaMaxima}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Nota Mínima</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-orange-600">{stats.notaMinima}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Evaluados</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{stats.total}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabla de notas */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle de Notas</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Estudiante</TableHead>
                  <TableHead className="text-center">Puntaje</TableHead>
                  <TableHead className="text-center">Nota</TableHead>
                  <TableHead className="hidden md:table-cell">Fortalezas</TableHead>
                  <TableHead className="hidden md:table-cell">Áreas de Mejora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evaluatedGroups.map((group, index) => {
                  const nota = Number(group.nota) || 0
                  const isAprobado = nota >= 4.0

                  return (
                    <TableRow key={group.id}>
                      <TableCell className="font-mono text-xs">{index + 1}</TableCell>
                      <TableCell className="font-medium">{group.studentName}</TableCell>
                      <TableCell className="text-center">{group.puntaje || "-"}</TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`inline-flex items-center justify-center w-12 h-8 rounded font-bold text-sm ${
                            isAprobado
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {nota.toFixed(1)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden md:table-cell max-w-xs truncate text-sm text-muted-foreground">
                        {group.retroalimentacion?.resumen_general?.fortalezas || "-"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell max-w-xs truncate text-sm text-muted-foreground">
                        {group.retroalimentacion?.resumen_general?.areas_mejora || "-"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
