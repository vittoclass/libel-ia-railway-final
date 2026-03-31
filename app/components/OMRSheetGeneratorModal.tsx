"use client"

/**
 * Generador de hoja OMR estándar LibelIA.
 * Herramienta nueva: genera PDF imprimible (hoja estudiante o clave) sin tocar OMR ni evaluación existente.
 */
import * as React from "react"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, FileDown } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { generateOMRSheetPDF, getOMRSheetFilename } from "@/app/lib/omr-sheet-pdf"
import {
  OMRTemplate,
  type OMRTemplateVariant,
  saveOMRTemplate,
  getOMRTemplate,
} from "@/app/lib/omr-template-store"
import { LIBELIA_OMR_ASPECT_RATIO } from "@/app/lib/omr-sheet-spec"

type Props = {
  open: boolean
  onClose: () => void
}

const OPTIONS_4 = ["A", "B", "C", "D"]
const OPTIONS_5 = ["A", "B", "C", "D", "E"]

export function OMRSheetGeneratorModal({ open, onClose }: Props) {
  const { toast } = useToast()
  const [numQuestions, setNumQuestions] = useState(20)
  const [numOptions, setNumOptions] = useState<4 | 5>(4)
  const [variant, setVariant] = useState<"student" | "key">("student")
  const [sheetVersion, setSheetVersion] = useState<"v1" | "v2">("v1")
  const [omrTemplateVariant, setOmrTemplateVariant] = useState<OMRTemplateVariant>("odd_even_dual_column")
  const [keyInput, setKeyInput] = useState("")
  const [loading, setLoading] = useState(false)

  const options = numOptions === 5 ? OPTIONS_5 : OPTIONS_4

  const parseKeyAnswers = (): string[] | null => {
    const raw = keyInput
      .replace(/,/g, " ")
      .split(/\s+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    if (raw.length !== numQuestions) return null
    const valid = options.join("")
    if (raw.some((c) => !valid.includes(c))) return null
    return raw
  }

  const handleExport = async () => {
    if (numQuestions < 5 || numQuestions > 60) {
      toast({ title: "Usa entre 5 y 60 preguntas.", variant: "destructive" })
      return
    }
    let keyAnswersForTemplate: string[] | null = null
    if (variant === "key") {
      const answers = parseKeyAnswers()
      if (!answers) {
        toast({
          title: "Clave inválida.",
          description: `Escribe exactamente ${numQuestions} letras (${options.join("/")}), separadas por coma o espacio.`,
          variant: "destructive",
        })
        return
      }
      keyAnswersForTemplate = answers
      // Crear y guardar plantilla OMR estructurada
      const templateId = `omr_${Date.now()}`
      const answerKey: { [question: number]: string } = {}
      answers.forEach((ans, idx) => {
        answerKey[idx + 1] = ans
      })
      const template: OMRTemplate = {
        templateId,
        name: `Hoja OMR ${numQuestions} preguntas`,
        numQuestions,
        numOptions,
        answerKey,
        createdAt: Date.now(),
        sheetSpec: sheetVersion === "v2" ? "libelia_standard_v2" : "libelia_standard_v1",
        omrTemplateVariant,
      }
      saveOMRTemplate(template)
      toast({
        title: "Plantilla OMR guardada.",
        description: "Podrás usarla luego en el flujo robusto de corrección.",
      })
      if (process.env.NODE_ENV === "development") {
        console.log("[OMRSheetGenerator] Plantilla clave guardada", {
          templateId,
          numQuestions,
          numOptions,
          sheetSpec: template.sheetSpec,
        })
      }
      // Generar plantilla Aspose (.omr) y guardarla en la plantilla si Aspose está configurado
      try {
        if (process.env.NODE_ENV === "development") {
          console.log("[OMRSheetGenerator] Llamando a /api/omr/generate-aspose-template", {
            templateId,
            numQuestions,
            numOptions,
          })
        }
        const genRes = await fetch("/api/omr/generate-aspose-template", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            numQuestions,
            numOptions,
            templateId,
            name: template.name,
          }),
        })
        const genData = await genRes.json()
        const genSuccess = !!genData?.success && !!genData?.omrBase64
        const missingCreds =
          typeof genData?.error === "string" &&
          genData.error.toLowerCase().includes("no está configurado")

        if (process.env.NODE_ENV === "development") {
          console.log("[OMRSheetGenerator] Respuesta generate-aspose-template", {
            templateId,
            success: genData?.success,
            hasOmrBase64: !!genData?.omrBase64,
            omrLength: genData?.omrBase64?.length ?? 0,
            error: genData?.error,
          })
        }

        if (genSuccess) {
          try {
            // Actualizar la plantilla que ya está en el store (merge) para no depender de una copia en memoria
            const existing = getOMRTemplate(templateId)
            const toSave: OMRTemplate = existing
              ? { ...existing, asposeOmrBase64: genData.omrBase64 }
              : { ...template, asposeOmrBase64: genData.omrBase64 }
            saveOMRTemplate(toSave)
            toast({
              title: "Plantilla Aspose generada y asociada correctamente.",
              description: "El archivo .omr quedó guardado en la plantilla para el reconocimiento con Aspose.",
            })
            if (process.env.NODE_ENV === "development") {
              console.log("[OMRSheetGenerator] asposeOmrBase64 guardado en plantilla", {
                templateId,
                omrLength: genData.omrBase64.length,
                fromStore: !!existing,
              })
            }
          } catch (e) {
            toast({
              title: "Error al asociar la plantilla Aspose.",
              description:
                "Aspose generó el archivo .omr, pero ocurrió un error al guardarlo dentro de la plantilla.",
              variant: "destructive",
            })
            if (process.env.NODE_ENV === "development") {
              console.error("[OMRSheetGenerator] Error guardando asposeOmrBase64 en plantilla", {
                templateId,
                error: e,
              })
            }
          }
        } else if (missingCreds) {
          toast({
            title: "Faltan credenciales de Aspose.",
            description:
              "La plantilla OMR se guardó, pero Aspose no está configurado. Configure ASPOSE_CLIENT_ID y ASPOSE_CLIENT_SECRET para habilitar la integración.",
            variant: "destructive",
          })
        } else {
          toast({
            title: "La plantilla OMR se guardó, pero Aspose no generó el archivo .omr.",
            description: "Revisa la configuración de Aspose o los logs de desarrollo para más detalles.",
            variant: "destructive",
          })
        }
      } catch (e) {
        // La plantilla ya está guardada; Aspose es opcional pero reportamos el fallo.
        toast({
          title: "La plantilla OMR se guardó, pero Aspose falló al generar el archivo .omr.",
          description:
            e instanceof Error ? e.message : "Revisa la configuración de red o de Aspose en el backend.",
          variant: "destructive",
        })
        if (process.env.NODE_ENV === "development") {
          console.error("[OMRSheetGenerator] Error llamando a generate-aspose-template", {
            templateId,
            error: e,
          })
        }
      }
    }

    setLoading(true)
    try {
      const keyAnswers = variant === "key" ? keyAnswersForTemplate ?? undefined : undefined
      const blob = await generateOMRSheetPDF({
        numQuestions,
        options,
        variant,
        keyAnswers,
        title: variant === "key" ? "LibelIA OMR — Clave correcta" : "LibelIA OMR — Hoja de respuestas",
        sheetSpec: sheetVersion === "v2" ? "libelia_standard_v2" : "libelia_standard_v1",
        omrTemplateVariant,
      })
      const filename = getOMRSheetFilename(variant, numQuestions)
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: "PDF generado.", description: filename })
    } catch (e) {
      toast({
        title: "Error al generar el PDF.",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generar hoja OMR LibelIA</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Hoja estándar del sistema con marcadores para cámara y lectura precisa. Exporta a PDF para imprimir.
        </p>

        <div className="space-y-4">
          <div>
            <Label>Número de preguntas</Label>
            <Input
              type="number"
              min={5}
              max={60}
              value={numQuestions}
              onChange={(e) => setNumQuestions(Math.max(5, Math.min(60, Number(e.target.value) || 20)))}
            />
            <p className="text-xs text-muted-foreground mt-1">Entre 5 y 60. Layout: 2 columnas.</p>
          </div>

          <div>
            <Label>Alternativas por pregunta</Label>
            <div className="flex gap-2 mt-1">
              <Button
                variant={numOptions === 4 ? "default" : "outline"}
                size="sm"
                onClick={() => setNumOptions(4)}
              >
                A – D
              </Button>
              <Button
                variant={numOptions === 5 ? "default" : "outline"}
                size="sm"
                onClick={() => setNumOptions(5)}
              >
                A – E
              </Button>
            </div>
          </div>

          <div>
            <Label>Versión de hoja</Label>
            <div className="flex gap-2 mt-1">
              <Button
                variant={sheetVersion === "v1" ? "default" : "outline"}
                size="sm"
                onClick={() => setSheetVersion("v1")}
              >
                V1 (marcadores simples)
              </Button>
              <Button
                variant={sheetVersion === "v2" ? "default" : "outline"}
                size="sm"
                onClick={() => setSheetVersion("v2")}
              >
                V2 (fiduciales ArUco)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              V2 mejora la detección geométrica con marcadores tipo ArUco.
            </p>
          </div>

          <div>
            <Label>Orden de numeración</Label>
            <div className="flex gap-2 mt-1">
              <Button
                variant={omrTemplateVariant === "odd_even_dual_column" ? "default" : "outline"}
                size="sm"
                onClick={() => setOmrTemplateVariant("odd_even_dual_column")}
              >
                Pares e impares
              </Button>
              <Button
                variant={omrTemplateVariant === "sequential_dual_column" ? "default" : "outline"}
                size="sm"
                onClick={() => setOmrTemplateVariant("sequential_dual_column")}
              >
                Continuo / secuencial
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Pares/impares = 1,3,5... izquierda y 2,4,6... derecha. Secuencial = 1..N izquierda y luego derecha.
            </p>
          </div>

          <div>
            <Label>Tipo de hoja</Label>
            <div className="flex gap-2 mt-1">
              <Button
                variant={variant === "student" ? "default" : "outline"}
                size="sm"
                onClick={() => setVariant("student")}
              >
                Estudiante (vacía)
              </Button>
              <Button
                variant={variant === "key" ? "default" : "outline"}
                size="sm"
                onClick={() => setVariant("key")}
              >
                Clave correcta
              </Button>
            </div>
          </div>

          {variant === "key" && (
            <div>
              <Label>Respuestas correctas</Label>
              <Input
                placeholder={`Ej: A B C D A B C D ... (${numQuestions} letras)`}
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {numQuestions} letras en orden (pregunta 1, 2, 3…). Usa solo {options.join(", ")}. Separar por coma o espacio.
              </p>
            </div>
          )}

          <div className="rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">Vista previa del formato</p>
            <p>Marcadores en las 4 esquinas · 2 columnas · {numQuestions} preguntas · Opciones {options.join(", ")}.</p>
            <p>
              Orden:{" "}
              {omrTemplateVariant === "odd_even_dual_column" ? "pares/impares" : "continuo/secuencial"}.
            </p>
            <p>Aspect ratio interior: {LIBELIA_OMR_ASPECT_RATIO.toFixed(3)} (alineado con cámara y sistema).</p>
          </div>

          <Button
            className="w-full"
            onClick={handleExport}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <FileDown className="h-4 w-4 mr-2" />
            )}
            Exportar PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
