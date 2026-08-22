"use client"

/**
 * UI mínima S3: selector de hasta 4 contextos, 1 activo.
 * Solo se monta si el feature flag está ON (el padre no lo renderiza si OFF).
 */

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MAX_COURSE_CONTEXTS, type CourseContextDisplayStatus } from "@/app/lib/course-contexts/types"

export type CourseContextSwitcherItem = {
  contextId: string
  courseValue: string
  classSize: number
  displayStatus: CourseContextDisplayStatus
  batchId: string
}

export function CourseContextSwitcher(props: {
  items: CourseContextSwitcherItem[]
  activeContextId: string | null
  switchBlocked: boolean
  switchBlockedReason?: string | null
  rosterLocked: boolean
  instrumentLocked: boolean
  canCreate: boolean
  onCreate: () => void
  onSwitch: (contextId: string) => void
  onConfirm: (contextId: string) => void
  onUnconfirm: (contextId: string) => void
  onDelete: (contextId: string) => void
  onCourseLabelChange?: (value: string) => void
  courseLabel?: string
}) {
  const remaining = MAX_COURSE_CONTEXTS - props.items.length
  const active = props.items.find((i) => i.contextId === props.activeContextId)

  return (
    <div className="rounded-lg border border-dashed border-[var(--border-color)] bg-[var(--bg-card)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-accent)]">Cursos de esta sesión</h3>
          <p className="text-[11px] text-[var(--text-secondary)] m-0">
            Hasta {MAX_COURSE_CONTEXTS} cursos con la misma prueba. Solo 1 activo. Los estacionados de escritorio
            viven en esta sesión: F5 no recupera fotos de escritorio parked.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!props.canCreate || props.switchBlocked}
          title={!props.canCreate ? `Máximo ${MAX_COURSE_CONTEXTS} contextos` : undefined}
          onClick={props.onCreate}
        >
          + Curso
        </Button>
      </div>

      {props.items.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          Aún no hay contextos. «+ Curso» guarda el workspace actual como curso A.
        </p>
      ) : (
        <ul className="flex flex-wrap items-stretch gap-2" role="tablist" aria-label="Cursos de esta sesión">
          {props.items.map((item) => {
            const isActive = item.contextId === props.activeContextId
            const label = item.courseValue.trim() || "(sin etiqueta)"
            return (
              <li
                key={item.contextId}
                className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                  isActive
                    ? "border-[var(--text-accent)] bg-[var(--bg-muted-subtle)]"
                    : "border-[var(--border-color)]"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-context-id={item.contextId}
                  className="font-semibold min-w-[4.5rem] text-left"
                  disabled={!isActive && props.switchBlocked}
                  title={
                    isActive
                      ? `${label} · activo · ${item.classSize} est.`
                      : props.switchBlocked
                        ? props.switchBlockedReason ?? "Cambio bloqueado"
                        : `Activar ${label}`
                  }
                  onClick={isActive ? undefined : () => props.onSwitch(item.contextId)}
                >
                  {label}
                </button>
                {isActive && item.displayStatus === "ACTIVE" && !props.rosterLocked ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 text-xs"
                    onClick={() => props.onConfirm(item.contextId)}
                  >
                    Confirmar
                  </Button>
                ) : null}
                {isActive && props.rosterLocked ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => props.onUnconfirm(item.contextId)}
                  >
                    Desconfirmar
                  </Button>
                ) : null}
                {!isActive ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-red-700"
                    onClick={() => props.onDelete(item.contextId)}
                  >
                    Eliminar
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}

      {active && props.onCourseLabelChange ? (
        <div className="flex items-center gap-2">
          <Label htmlFor="course-context-label" className="text-xs">
            Etiqueta activa
          </Label>
          <Input
            id="course-context-label"
            className="h-8 w-48 text-xs"
            value={props.courseLabel ?? active.courseValue}
            onChange={(e) => props.onCourseLabelChange?.(e.target.value)}
            placeholder="Ej: 8° A"
          />
        </div>
      ) : null}

      {remaining <= 0 ? (
        <p className="text-[11px] text-amber-800 m-0">Máximo 4 contextos. No se puede crear un 5º.</p>
      ) : null}
      {props.instrumentLocked ? (
        <p className="text-[11px] text-[var(--text-secondary)] m-0">
          Hay cursos confirmados: la prueba/rúbrica global queda bloqueada. Desconfirme para cambiar el instrumento.
        </p>
      ) : null}
    </div>
  )
}
