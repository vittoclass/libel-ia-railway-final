"use client"

/**
 * Punto de integración para Scanbot Web Document Scanner SDK.
 * Mientras no exista NEXT_PUBLIC_SCANBOT_LICENSE, muestra mensaje y fallback a carga manual.
 * NO toca compare, scoring ni persistencia.
 */

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type Props = {
  open: boolean
  onClose: () => void
  /** Cuando el scanner capture una imagen (data URL), se entrega aquí. Si no está disponible el SDK, no se llama. */
  onImageCaptured?: (dataUrl: string) => void
}

const SCANBOT_AVAILABLE = typeof process !== "undefined" && !!process.env.NEXT_PUBLIC_SCANBOT_LICENSE

export function ScanbotDocumentScanner({ open, onClose, onImageCaptured }: Props) {
  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Captura con scanner mejorado</DialogTitle>
        </DialogHeader>
        {SCANBOT_AVAILABLE ? (
          <p className="text-sm text-muted-foreground">
            Aquí se integrará el SDK de Scanbot para captura guiada, detección de bordes y recorte.
            Por ahora use la carga manual de imagen.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Para usar el scanner mejorado (Scanbot) configure <code className="text-xs bg-muted px-1 rounded">NEXT_PUBLIC_SCANBOT_LICENSE</code>.
              Por ahora use la carga manual de imagen debajo.
            </p>
          </>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Usar carga manual
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
