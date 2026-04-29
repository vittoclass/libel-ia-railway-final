"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import EvaluatorClient from "@/app/EvaluatorClient"

type Gate = "loading" | "guest" | "need_onboard" | "need_name" | "ok"

type ProfileApiOk = {
  user?: { id?: string } | null
  onboarded?: boolean
  needs_teacher_display_name?: boolean
}

function applyProfilePayload(data: ProfileApiOk): Gate {
  if (!data?.user?.id) return "guest"
  if (!data.onboarded) return "need_onboard"
  if (data.needs_teacher_display_name) return "need_name"
  return "ok"
}

export default function EvaluarPageWrapper() {
  const [gate, setGate] = useState<Gate>("loading")
  const [displayNameInput, setDisplayNameInput] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveLoading, setSaveLoading] = useState(false)

  const loadProfile = useCallback(() => {
    fetch("/api/profile", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.error && typeof data.error === "string") {
          console.warn("[evaluar] /api/profile respondió error, se permite evaluar (fail-open):", data.error)
          setGate("ok")
          return
        }
        setGate(applyProfilePayload(data as ProfileApiOk))
      })
      .catch(() => {
        console.warn("[evaluar] /api/profile falló de red, se permite evaluar (fail-open)")
        setGate("ok")
      })
  }, [])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaveError(null)
    const trimmed = displayNameInput.trim()
    if (trimmed.length < 2) {
      setSaveError("Escribe al menos 2 caracteres.")
      return
    }
    setSaveLoading(true)
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ display_name: trimmed }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setSaveError(typeof j.error === "string" ? j.error : "No se pudo guardar.")
        return
      }
      const verify = await fetch("/api/profile", { credentials: "include" }).then((r) => r.json())
      if (verify?.needs_teacher_display_name) {
        setSaveError("No se pudo confirmar el nombre. Recarga la página o intenta de nuevo.")
        return
      }
      setDisplayNameInput("")
      setGate(applyProfilePayload(verify as ProfileApiOk))
    } catch {
      setSaveError("Error de conexión.")
    } finally {
      setSaveLoading(false)
    }
  }

  if (gate === "loading") {
    return (
      <main className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Comprobando perfil…</p>
      </main>
    )
  }

  if (gate === "need_onboard") {
    return (
      <main className="mx-auto max-w-lg p-6">
        <div className="flex flex-col gap-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-6 text-amber-900 dark:text-amber-100">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <h2 className="font-semibold">Completa tu perfil antes de evaluar</h2>
              <p className="mt-1 text-sm opacity-90">
                Para guardar evaluaciones y mostrar tu nombre en los paneles institucionales, primero completa tu perfil
                (colegio y datos de docente).
              </p>
            </div>
          </div>
          <p className="text-xs opacity-80">
            No es una evaluación del profesor. Los datos del perfil solo sirven para identificar correctamente tus
            evaluaciones en los paneles docentes e institucionales.
          </p>
          <Link href="/perfil" className="self-start">
            <Button type="button">Ir a perfil</Button>
          </Link>
        </div>
      </main>
    )
  }

  return (
    <>
      <Dialog open={gate === "need_name"}>
        <DialogContent
          className="[&>button]:hidden sm:max-w-md"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <form onSubmit={handleSaveName}>
            <DialogHeader>
              <DialogTitle>Registrar tu nombre</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-3 text-left text-sm text-muted-foreground">
                  <p>
                    Antes de evaluar, necesitamos registrar tu nombre para identificar correctamente tus evaluaciones.
                  </p>
                  <p className="text-foreground">
                    No es una evaluación del profesor. Este nombre solo se usa para identificar correctamente las
                    evaluaciones en los paneles docentes e institucionales.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 py-4">
              <Label htmlFor="eval-display-name">Nombre completo</Label>
              <Input
                id="eval-display-name"
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                placeholder="Ej: Juan Pérez"
                autoComplete="name"
                maxLength={200}
              />
              <p className="text-xs text-muted-foreground">Puedes incluir el apellido en el mismo campo.</p>
              {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saveLoading}>
                {saveLoading ? "Guardando…" : "Guardar y continuar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {gate === "guest" || gate === "ok" ? <EvaluatorClient /> : null}
    </>
  )
}
