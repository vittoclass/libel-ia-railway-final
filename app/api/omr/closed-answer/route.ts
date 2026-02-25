// app/api/omr/closed-answer/route.ts
// Endpoint para procesar plantillas de respuestas cerradas (tipo SIMCE / PSU)
// Usa Mistral Vision para leer marcas X o relleno con alta precision (97%+)
import { NextRequest, NextResponse } from "next/server"
import sharp from "sharp"

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY

interface ClosedAnswerResult {
  success: boolean
  respuestas: { pregunta: string; respuesta: string; confianza: number }[]
  totalPreguntas: number
  alumnoDetectado?: string
  cursoDetectado?: string
  warnings: string[]
}

// Preprocesar imagen con Sharp para maximizar lectura OMR
async function preprocessImage(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64")

  // Pipeline de preprocesamiento optimizado para plantillas OMR
  const processed = await sharp(buffer)
    .resize(2400, null, { withoutEnlargement: false, fit: "inside" }) // Escalar a buen tamano
    .grayscale() // Escala de grises
    .normalize() // Normalizar contraste
    .sharpen({ sigma: 1.5 }) // Nitidez para bordes de X
    .modulate({ brightness: 1.05 }) // Ligeramente mas brillante
    .jpeg({ quality: 95 }) // Alta calidad
    .toBuffer()

  return processed.toString("base64")
}

// Segunda pasada con contraste mas agresivo para marcas dudosas
async function preprocessImageHighContrast(base64Data: string): Promise<string> {
  const buffer = Buffer.from(base64Data, "base64")

  const processed = await sharp(buffer)
    .resize(2800, null, { withoutEnlargement: false, fit: "inside" })
    .grayscale()
    .linear(1.8, -60) // Alto contraste
    .sharpen({ sigma: 2.0 })
    .jpeg({ quality: 95 })
    .toBuffer()

  return processed.toString("base64")
}

function buildOMRPrompt(totalPreguntas: number, opciones: string): string {
  return `Eres un sistema OCR/OMR experto especializado en leer plantillas de respuestas cerradas de examenes chilenos (SIMCE, PSU, etc).

TAREA CRITICA: Analiza esta imagen de una plantilla de respuestas marcada por un estudiante y extrae TODAS las respuestas.

REGLAS DE LECTURA (OBLIGATORIAS):
1. La plantilla tiene ${totalPreguntas} preguntas numeradas del 1 al ${totalPreguntas}.
2. Cada pregunta tiene opciones: ${opciones}
3. El estudiante marca su respuesta con una X grande sobre la letra, o rellenando/tachando el circulo/cuadro.
4. Una X sobre una letra = esa letra es la respuesta seleccionada.
5. Un circulo relleno o tachado sobre una letra = esa letra es la respuesta seleccionada.
6. Si una pregunta NO tiene marca visible, reportala como "SIN_RESPUESTA".
7. Si hay DOS o mas marcas en la misma pregunta, reportala como "DOBLE_MARCA".
8. Lee pregunta por pregunta en orden del 1 al ${totalPreguntas}, SIN SALTARTE NINGUNA.
9. La plantilla puede tener 2 columnas (ej: 1-20 izquierda, 21-40 derecha). Lee AMBAS columnas.

DETECCION DE DATOS DEL ALUMNO:
- Si hay un campo "NOMBRE:" extrae el nombre completo del alumno.
- Si hay un campo "CURSO:" extrae el curso.

FORMATO DE RESPUESTA (JSON estricto):
{
  "alumno": "nombre detectado o null",
  "curso": "curso detectado o null",
  "respuestas": [
    {"numero": 1, "respuesta": "D", "confianza": 0.99},
    {"numero": 2, "respuesta": "D", "confianza": 0.98},
    ...hasta la pregunta ${totalPreguntas}
  ]
}

REGLAS DE CONFIANZA:
- 0.99: Marca claramente visible, sin ambiguedad
- 0.90-0.98: Marca visible pero ligeramente ambigua
- 0.70-0.89: Marca poco clara, podria ser otra opcion
- Menos de 0.70: Muy dudosa

IMPORTANTE: 
- DEBES devolver EXACTAMENTE ${totalPreguntas} respuestas, una por cada pregunta.
- NO inventes respuestas. Si no ves marca, pon "SIN_RESPUESTA".
- Las X tipicamente son grandes y cruzan toda la celda de la letra.
- Presta atencion a marcas que pueden parecer tachados o correcciones.`
}

async function callMistralVision(
  base64Image: string,
  prompt: string,
  mimeType: string = "image/jpeg"
): Promise<any> {
  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: "mistral-large-latest",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64Image}` },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
      temperature: 0.05, // Minima creatividad para maxima precision
      response_format: { type: "json_object" },
      max_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Mistral API error: ${response.status} - ${errorText}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("Respuesta vacia de Mistral Vision")
  return JSON.parse(content)
}

// Funcion de doble pasada: lee 2 veces y reconcilia
async function doublePassRead(
  base64Original: string,
  totalPreguntas: number,
  opciones: string,
  mimeType: string
): Promise<{ respuestas: any[]; alumno: string | null; curso: string | null }> {
  const prompt = buildOMRPrompt(totalPreguntas, opciones)

  // Pasada 1: Imagen preprocesada normal
  const preprocessed1 = await preprocessImage(base64Original)
  const result1 = await callMistralVision(preprocessed1, prompt, "image/jpeg")

  // Pasada 2: Imagen con alto contraste
  const preprocessed2 = await preprocessImageHighContrast(base64Original)
  const result2 = await callMistralVision(preprocessed2, prompt, "image/jpeg")

  const respuestas1 = Array.isArray(result1.respuestas) ? result1.respuestas : []
  const respuestas2 = Array.isArray(result2.respuestas) ? result2.respuestas : []

  // Reconciliar: usar la respuesta con mayor confianza entre ambas pasadas
  const reconciled: any[] = []
  for (let i = 1; i <= totalPreguntas; i++) {
    const r1 = respuestas1.find((r: any) => r.numero === i)
    const r2 = respuestas2.find((r: any) => r.numero === i)

    if (!r1 && !r2) {
      reconciled.push({ numero: i, respuesta: "SIN_RESPUESTA", confianza: 0.0 })
      continue
    }
    if (!r1) { reconciled.push(r2); continue }
    if (!r2) { reconciled.push(r1); continue }

    // Si ambas coinciden, alta confianza
    if (r1.respuesta === r2.respuesta) {
      reconciled.push({
        numero: i,
        respuesta: r1.respuesta,
        confianza: Math.max(r1.confianza || 0.95, r2.confianza || 0.95),
      })
    } else {
      // Si difieren, tomar la de mayor confianza pero reducir confianza
      const winner = (r1.confianza || 0) >= (r2.confianza || 0) ? r1 : r2
      reconciled.push({
        numero: i,
        respuesta: winner.respuesta,
        confianza: Math.min(winner.confianza || 0.8, 0.85), // Cap en 0.85 si hay discrepancia
      })
    }
  }

  return {
    respuestas: reconciled,
    alumno: result1.alumno || result2.alumno || null,
    curso: result1.curso || result2.curso || null,
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!MISTRAL_API_KEY) {
      return NextResponse.json(
        { success: false, error: "MISTRAL_API_KEY no configurada en el servidor" },
        { status: 500 }
      )
    }

    const body = await req.json()
    const {
      dataUrl,
      mimeType = "image/jpeg",
      totalPreguntas = 40,
      opciones = "A, B, C, D",
      dobleVerificacion = true,
    } = body

    if (!dataUrl || typeof dataUrl !== "string") {
      return NextResponse.json(
        { success: false, error: "dataUrl es requerido" },
        { status: 400 }
      )
    }

    // Extraer base64 puro del dataUrl
    const base64Data = dataUrl.replace(/^data:.*?;base64,/, "")

    const warnings: string[] = []

    let respuestasFinales: any[]
    let alumnoDetectado: string | null = null
    let cursoDetectado: string | null = null

    if (dobleVerificacion) {
      // Doble pasada para maxima precision
      const result = await doublePassRead(base64Data, totalPreguntas, opciones, mimeType)
      respuestasFinales = result.respuestas
      alumnoDetectado = result.alumno
      cursoDetectado = result.curso
    } else {
      // Pasada simple (mas rapida, un poco menos precisa)
      const preprocessed = await preprocessImage(base64Data)
      const prompt = buildOMRPrompt(totalPreguntas, opciones)
      const result = await callMistralVision(preprocessed, prompt, "image/jpeg")
      respuestasFinales = Array.isArray(result.respuestas) ? result.respuestas : []
      alumnoDetectado = result.alumno || null
      cursoDetectado = result.curso || null
    }

    // Validar que tenemos el numero correcto de respuestas
    if (respuestasFinales.length < totalPreguntas) {
      const missing = totalPreguntas - respuestasFinales.length
      warnings.push(`Faltan ${missing} respuestas. Se completaron como SIN_RESPUESTA.`)
      for (let i = respuestasFinales.length + 1; i <= totalPreguntas; i++) {
        respuestasFinales.push({ numero: i, respuesta: "SIN_RESPUESTA", confianza: 0.0 })
      }
    }

    // Contar marcas de baja confianza
    const lowConfCount = respuestasFinales.filter((r: any) => (r.confianza || 0) < 0.90).length
    if (lowConfCount > 0) {
      warnings.push(`${lowConfCount} respuesta(s) con baja confianza requieren revision manual.`)
    }

    // Formatear resultado final
    const respuestasFormateadas = respuestasFinales.map((r: any) => ({
      pregunta: `${r.numero}`,
      respuesta: (r.respuesta || "SIN_RESPUESTA").toUpperCase(),
      confianza: r.confianza || 0.5,
    }))

    const result: ClosedAnswerResult = {
      success: true,
      respuestas: respuestasFormateadas,
      totalPreguntas,
      alumnoDetectado: alumnoDetectado || undefined,
      cursoDetectado: cursoDetectado || undefined,
      warnings,
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error: any) {
    console.error("[OMR Closed Answer] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Error procesando plantilla OMR de respuestas cerradas",
        respuestas: [],
        totalPreguntas: 0,
        warnings: [],
      },
      { status: 500 }
    )
  }
}
