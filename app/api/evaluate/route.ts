// app/api/evaluate/route.ts
// Endpoint principal para evaluar pruebas de estudiantes
// Integra OMR para respuestas cerradas con retroalimentación IA
// Soporta imágenes, PDF y Word: si hay PDF/Word se usa Azure OCR + Mistral texto; si solo imágenes, Mistral Vision.
import { NextRequest, NextResponse } from "next/server"
import { AzureKeyCredential, DocumentAnalysisClient } from "@azure/ai-form-recognizer"
import { getTemplate, getTemplateImage } from "@/app/lib/omrTemplateCache"
import { fileToImageBase64List, isPdfBase64 } from "@/app/lib/pdfToImages"
import { extractTextFromFiles } from "./utils"
import { persistEvaluation } from "@/app/lib/persist-evaluation"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { runAzureLayoutOmrPipeline } from "@/app/lib/omr/experimental/azure-layout-omr-pipeline"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY

/** Reintentos para 502/503/429 (overload/servicio no disponible). */
async function fetchMistralWithRetry(url: string, init: RequestInit): Promise<Response> {
  const maxRetries = 3
  const retryStatuses = [502, 503, 429]
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.ok) return res
      const body = await res.text()
      const errMsg = `Mistral API error: ${res.status} - ${body.slice(0, 300)}`
      if (!retryStatuses.includes(res.status) || attempt === maxRetries) {
        throw new Error(errMsg)
      }
      const delayMs = 2000 * Math.pow(2, attempt - 1)
      console.warn(`[Mistral] ${res.status} (intento ${attempt}/${maxRetries}), reintento en ${delayMs}ms`)
      await new Promise(r => setTimeout(r, delayMs))
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt === maxRetries) throw lastError
      const delayMs = 2000 * Math.pow(2, attempt - 1)
      console.warn(`[Mistral] Error (intento ${attempt}/${maxRetries}):`, lastError.message)
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
  throw lastError || new Error("Mistral API error: servicio no disponible")
}

// Tipos para la pauta estructurada
interface ItemScore {
  id: string
  maxScore: number
  isDevelopment: boolean
}

interface AlternativeResult {
  pregunta: string
  respuesta_estudiante: string
  respuesta_correcta: string
}

// Parsear la pauta estructurada (formato: "SM1:1; SM2:1; P1:5; ...")
function parsePautaEstructurada(pautaStr: string): ItemScore[] {
  const items: ItemScore[] = []
  if (!pautaStr) return items

  const pairs = pautaStr.split(";").map(p => p.trim()).filter(p => p.length > 0)

  for (const pair of pairs) {
    const [id, scoreStr] = pair.split(":").map(s => s.trim())
    const maxScore = parseInt(scoreStr, 10)

    if (id && !isNaN(maxScore) && maxScore > 0) {
      items.push({
        id: id,
        maxScore: maxScore,
        isDevelopment: id.toLowerCase().includes("desarrollo") || id.toLowerCase().match(/^p\d+/) !== null,
      })
    }
  }
  return items
}

/** Extrae solo la opción marcada: A-E, V, F, o número. Evita frases completas. */
function normalizeRespuestaCerrada(texto: string): string {
  if (!texto || typeof texto !== "string") return "BLANK"
  const t = texto.trim().toUpperCase()
  if (t === "" || t === "SIN_RESPUESTA" || t === "SIN RESPUESTA") return "BLANK"
  if (t === "BLANK") return "BLANK"
  if (t === "MULTIPLE") return "MULTIPLE"
  const letraMatch = t.match(/^([A-E])[\s):.(]?/) || t.match(/\b([A-E])\b/)
  if (letraMatch) return letraMatch[1]
  if (t.match(/^([VF])[\s):.(]?/) || t === "V" || t === "F") return t.charAt(0)
  const numMatch = t.match(/(\d+)/)
  if (numMatch) return numMatch[1]
  if (/^[A-EVF]$/.test(t)) return t
  return "BLANK"
}

// Calcular nota en escala chilena (1.0 - 7.0)
// Curva ligeramente generosa: debajo de 4.0 se usa exponente < 1 para que el mismo puntaje rinda una nota un poco mayor.
function calculateGrade(score: number, maxScore: number, porcentajeExigencia: number): number {
  if (maxScore <= 0 || porcentajeExigencia <= 0) return 1.0

  const exigenciaDecimal = Math.min(100, Math.max(1, porcentajeExigencia)) / 100
  const puntosAprobacion = Math.ceil(maxScore * exigenciaDecimal)
  const puntajeEfectivo = Math.max(0, score)

  if (puntajeEfectivo === 0) return 1.0

  let grade: number

  if (puntajeEfectivo <= puntosAprobacion) {
    // Curva menos severa: (x)^0.95 da un pequeño boost a puntajes intermedios
    const ratio = Math.min(1, puntajeEfectivo / puntosAprobacion)
    grade = 1.0 + 3.0 * Math.pow(ratio, 0.95)
    grade = Math.min(4.0, grade)
  } else {
    const remainingPoints = maxScore - puntosAprobacion
    if (remainingPoints === 0) return 7.0
    grade = 4.0 + 3.0 * ((puntajeEfectivo - puntosAprobacion) / remainingPoints)
  }

  return Math.min(7.0, Math.round(grade * 10) / 10)
}

// Convertir imagen a base64 si es URL
async function urlToBase64(url: string): Promise<string> {
  if (url.startsWith("data:")) {
    return url.replace(/^data:.*?;base64,/, "")
  }

  const response = await fetch(url)
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer).toString("base64")
}

/** Mistral solo acepta imágenes (JPEG, PNG, WEBP, etc.). PDF/Word se convierten antes con fileToImageBase64List. */

/**
 * Resuelve fileUrls a una lista plana de imágenes en base64.
 * - Si es imagen: 1 elemento.
 * - Si es PDF: N elementos (una por página).
 * - Si es Word: lanza con mensaje para exportar a PDF.
 */
async function resolveToImageBase64List(
  fileUrls: string[],
  fileMimeTypes?: string[]
): Promise<string[]> {
  const list: string[] = []
  for (let i = 0; i < fileUrls.length; i++) {
    const url = fileUrls[i]
    const mime = fileMimeTypes?.[i]
    const pages = await fileToImageBase64List(url, mime)
    list.push(...pages)
  }
  return list
}

/** Obtiene base64 listo para Mistral. Si es PDF, convierte la primera página a imagen. */
async function getImageBase64ForVision(url: string): Promise<string> {
  const base64 = await urlToBase64(url)
  if (isPdfBase64(base64)) {
    const pages = await fileToImageBase64List(url, "application/pdf")
    if (pages.length === 0) throw new Error("El PDF no pudo convertirse a imágenes.")
    return pages[0]
  }
  return base64
}

/** Devuelve true si algún archivo es PDF o Word/Office (para usar rama Azure OCR en lugar de conversión a imágenes). */
function hasPdfOrWord(fileMimeTypes: string[] | undefined): boolean {
  if (!Array.isArray(fileMimeTypes) || fileMimeTypes.length === 0) return false
  return fileMimeTypes.some(
    (m) =>
      m === "application/pdf" ||
      (typeof m === "string" && (m.includes("officedocument") || m.includes("spreadsheetml")))
  )
}

/** Obtiene buffers desde fileUrls (data URLs o URLs) para enviar a Azure Document Intelligence. */
async function getFileBuffersFromUrls(
  fileUrls: string[],
  fileMimeTypes: string[]
): Promise<{ buffer: Buffer; mimeType: string }[]> {
  const out: { buffer: Buffer; mimeType: string }[] = []
  for (let i = 0; i < fileUrls.length; i++) {
    const url = fileUrls[i]
    const mimeType = fileMimeTypes[i] || "application/octet-stream"
    let buffer: Buffer
    if (url.startsWith("data:")) {
      const base64 = url.replace(/^data:.*?;base64,/, "")
      buffer = Buffer.from(base64, "base64")
    } else {
      const res = await fetch(url)
      const ab = await res.arrayBuffer()
      buffer = Buffer.from(ab)
    }
    out.push({ buffer, mimeType })
  }
  return out
}

/** Evalúa usando solo el texto extraído por Azure (PDF/Word/imagen). Alineado con la API antigua: generosidad calibrada, fortalezas con aspectos positivos, puntaje por ítem. */
async function analyzeWithMistralText(
  textoExtraido: string,
  rubrica: string,
  pauta: string,
  pautaEstructurada: string,
  pautaCorrectaAlternativas: string,
  nivelEducativo: string,
  areaConocimiento: string,
  puntajeTotal: number,
  porcentajeExigencia: number,
  tipoPrueba: "mixta" | "solo_desarrollo" | "solo_alternativas",
  flexibilidad: number = 3,
  nombreEstudiante?: string
): Promise<{
  nombreEstudiante: string | null
  respuestas_cerradas: { pregunta: string; respuesta_detectada: string; confianza: number }[]
  respuestas_desarrollo: Record<string, { texto_estudiante: string; puntaje: string; justificacion: string }>
  retroalimentacion: { fortalezas: string; areas_mejora: string; correccion_detallada: { seccion: string; detalle: string }[] }
}> {
  const itemScores = parsePautaEstructurada(pautaEstructurada)
  const soloDesarrollo = tipoPrueba === "solo_desarrollo"
  const soloAlternativas = tipoPrueba === "solo_alternativas"
  const desarrolloItems = itemScores.filter((i) => i.isDevelopment)
  const desarrolloPuntajes = desarrolloItems.map((item) => `${item.id} (Máx: ${item.maxScore} pts)`).join(", ")
  const alternativasItems = itemScores.filter((i) => !i.isDevelopment)
  const listaIdsAlternativas = alternativasItems.map((i) => i.id).join(", ")
  const nombreInstruccion =
    nombreEstudiante && nombreEstudiante.trim() && nombreEstudiante !== "Estudiante"
      ? `**IMPORTANTE:** El nombre del estudiante es "${nombreEstudiante}". USA este nombre en fortalezas y áreas de mejora (ej: "${nombreEstudiante} demuestra...", "${nombreEstudiante} debe mejorar...").`
      : `**IMPORTANTE:** Si no hay nombre, usa "El estudiante" o "La estudiante" en fortalezas y áreas de mejora. NUNCA dejes frases sin sujeto.`

  const prompt = `Actúa como un profesor universitario riguroso pero justo. El objetivo es la EVALUACIÓN CUALITATIVA y la PUNTUACIÓN DIRECTA.

Puntaje máximo de la evaluación: ${puntajeTotal} puntos. Exigencia para aprobar: ${porcentajeExigencia}%.

${nombreInstruccion}

RÚBRICA DE EVALUACIÓN (criterio para desarrollo - escala 0 a máximo del ítem):
${rubrica}

${pauta ? `PAUTA DE RESPUESTAS (Desarrollo/Abiertas):\n${pauta}\n\n` : ""}

REGLAS DE ORO:

1) ALTERNATIVAS (OBLIGATORIO - EXTRACCIÓN CERRETERA):
   - La prueba tiene exactamente estos ítems de respuestas cerradas: ${listaIdsAlternativas || "ninguno (solo desarrollo)"}.
   - Debes extraer del texto OCR ÚNICAMENTE lo que el estudiante marcó o escribió para cada ítem. En "respuesta_detectada" escribe SOLO la letra o el número (A, B, C, D, E, V, F, o un dígito). NUNCA pongas la afirmación completa.
   - Devuelve en "respuestas_cerradas" UNA entrada por cada ítem de la lista anterior, con "pregunta" igual al ID exacto (ej: SM1, VF2, TP1). Si en la transcripción no aparece la respuesta de un ítem, pon "SIN_RESPUESTA". NO inventes; solo lo que aparece en el texto.
   - La pauta de alternativas correctas es solo para que sepas las opciones válidas; lo que debes extraer es lo que REALMENTE marcó el estudiante según la transcripción.

2) PUNTUACIÓN DE DESARROLLO (generosidad calibrada):
   - Ítems de desarrollo y sus máximos: ${desarrolloPuntajes || "No especificados"}
   - **CRITERIO DE GENEROSIDAD:** Si el concepto principal de la respuesta (según la pauta) es identificable AUNQUE SEA BREVE O MAL ESCRITO, el puntaje debe ser MÍNIMO 1 PUNTO (si el máximo del ítem > 1). Solo asigna 0 cuando la respuesta es totalmente incomprensible o en blanco.
   - **FORMATO:** "puntaje" = "OBTENIDO/MAX_ITEM" (ej. "2/2", "1/3").
   - Considera flexibilidad ${flexibilidad}/5 (1=estricto, 5=flexible) al asignar puntaje.

3) FORTALEZAS: DEBES reconocer aspectos POSITIVOS concretos del trabajo. Cita entre comillas lo que escribió el estudiante y explica por qué es un logro (concepto bien aplicado, buena argumentación, claridad, etc.). No seas genérico; menciona logros específicos que veas en el texto. Tono de educador que valora el avance.

4) ÁREAS DE MEJORA: Orienta el crecimiento citando lo que escribió e indicando qué puede mejorar y cómo. Tono de apoyo, sin desvalorizar.

5) En respuestas_desarrollo: "texto_estudiante" = CITA LITERAL de la respuesta del estudiante. "justificacion" = por qué tiene ese puntaje según la rúbrica (incluye cita).

6) LENGUAJE RESPONSABLE: Nunca escribas frases que afirmen que el estudiante "no respondió", "no contestó" o "no escribió nada". Si en la TRANSCRIPCIÓN OCR no ves respuesta para una pregunta, describe la LIMITACIÓN de la transcripción, por ejemplo: "En la transcripción OCR no se observa una respuesta legible para esta pregunta", sin culpar al estudiante.

---
PAUTA DE PUNTAJES POR ÍTEM:
${pautaEstructurada || "No especificada"}

PAUTA DE ALTERNATIVAS CORRECTAS (para comparar):
${pautaCorrectaAlternativas || "No especificada"}

--- TRANSCRIPCIÓN OCR ---
${textoExtraido}
--- FIN TRANSCRIPCIÓN ---

Tipo de prueba: ${soloDesarrollo ? "SOLO DESARROLLO" : soloAlternativas ? "SOLO ALTERNATIVAS" : "MIXTA"}. Nivel: ${nivelEducativo}. Área: ${areaConocimiento}.

Responde ÚNICAMENTE con este JSON (sin markdown):
{
  "nombreEstudiante": "nombre encontrado en el texto o null",
  "respuestas_cerradas": [${listaIdsAlternativas ? listaIdsAlternativas.split(", ").map(id => `{"pregunta": "${id.trim()}", "respuesta_detectada": "SOLO LETRA O NÚMERO O SIN_RESPUESTA", "confianza": 0.95}`).join(", ") : ""}],
  "respuestas_desarrollo": {
    "P1": {"texto_estudiante": "CITA LITERAL de lo que escribió el estudiante", "puntaje": "2/2", "justificacion": "Explicación que incluye cita y por qué ese puntaje según rúbrica"}
  },
  "retroalimentacion": {
    "fortalezas": "Aspectos POSITIVOS concretos del trabajo, citando al estudiante. Reconocer logros específicos (ej: buena estructura, concepto bien aplicado).",
    "areas_mejora": "Orientaciones de mejora citando lo que escribió, tono de apoyo.",
    "correccion_detallada": [{"seccion": "P1 o nombre ítem", "detalle": "explicación con cita del estudiante"}]
  }
}

Las claves de respuestas_desarrollo pueden ser P1, P2, P3, etc. según los ítems de desarrollo en la pauta. Asigna puntaje de 0 a máximo de cada ítem aplicando generosidad calibrada. Para respuestas_cerradas, usa exactamente los IDs: ${listaIdsAlternativas || "[]"}.`

  const res = await fetchMistralWithRetry("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 8192,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Mistral (texto) error: ${res.status} - ${err}`)
  }
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("Respuesta vacía de Mistral")
  const parsed = JSON.parse(content)
  const rawCerradas = Array.isArray(parsed.respuestas_cerradas) ? parsed.respuestas_cerradas : []
  const byPregunta = new Map<string, { respuesta_detectada: string; confianza: number }>()
  for (const r of rawCerradas) {
    const id = String(r.pregunta || "").trim()
    if (!id) continue
    const detectada = normalizeRespuestaCerrada(String(r.respuesta_detectada ?? ""))
    byPregunta.set(id, { respuesta_detectada: detectada, confianza: Number(r.confianza) || 0.8 })
  }
  const respuestas_cerradas: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
  for (const item of alternativasItems) {
    const existing = byPregunta.get(item.id)
    respuestas_cerradas.push({
      pregunta: item.id,
      respuesta_detectada: existing ? existing.respuesta_detectada : "SIN_RESPUESTA",
      confianza: existing ? existing.confianza : 0,
    })
  }
  return {
    nombreEstudiante: parsed.nombreEstudiante ?? null,
    respuestas_cerradas,
    respuestas_desarrollo: parsed.respuestas_desarrollo && typeof parsed.respuestas_desarrollo === "object" ? parsed.respuestas_desarrollo : {},
    retroalimentacion: {
      fortalezas: parsed.retroalimentacion?.fortalezas ?? "",
      areas_mejora: parsed.retroalimentacion?.areas_mejora ?? "",
      correccion_detallada: Array.isArray(parsed.retroalimentacion?.correccion_detallada) ? parsed.retroalimentacion.correccion_detallada : [],
    },
  }
}

/** Extrae SOLO lo que el estudiante marcó. Si hay imagen de plantilla, se envían AMBAS imágenes:
 *  imagen 1 = plantilla del profesor (mismo layout), imagen 2 = hoja del estudiante.
 *  El modelo usa la plantilla solo como referencia de estructura; extrae únicamente de la imagen 2. */
async function extractStudentClosedAnswersOnly(
  studentImageBase64: string,
  totalPreguntas: number,
  alternativas: string[],
  columnas: number = 2,
  templateImageBase64?: string
): Promise<{ pregunta: string; respuesta_detectada: string; confianza: number }[]> {
  const half = Math.ceil(totalPreguntas / 2)
  const alts = alternativas.length ? alternativas : ["A", "B", "C", "D"]

  const conPlantilla = !!templateImageBase64 && templateImageBase64.length > 50
  const prompt = conPlantilla
    ? `Tienes DOS imágenes de la MISMA plantilla de respuestas (mismo formato, mismas posiciones de preguntas).

IMAGEN 1 = PLANTILLA DEL PROFESOR (respuestas correctas). Solo sirve para ver la ESTRUCTURA y posición de las preguntas.
IMAGEN 2 = HOJA DEL ESTUDIANTE. Aquí debes leer QUÉ LETRA está marcada en cada pregunta.

TU TAREA: Extraer ÚNICAMENTE lo que está marcado en la IMAGEN 2 (hoja del estudiante). NO copies las respuestas de la imagen 1. El estudiante puede marcar distinto al profesor.

Estructura: ${columnas} columnas. Preguntas 1 a ${half}, luego ${half + 1} a ${totalPreguntas}. Opciones: ${alts.join(", ")}.

Para cada pregunta (1 a ${totalPreguntas}) indica SOLO la letra que VES MARCADA EN LA IMAGEN 2. Si en la imagen 2 no hay marca, escribe "SIN_RESPUESTA".

Responde SOLO este JSON:
{"r":[{"p":1,"a":"?"},{"p":2,"a":"?"},...,{"p":${totalPreguntas},"a":"?"}]}
"p" = número de pregunta, "a" = letra marcada EN LA IMAGEN 2 (${alts.join("/")}) o "" si no hay marca.
Exactamente ${totalPreguntas} elementos en "r".`
    : `TAREA: Lee ÚNICAMENTE esta imagen de una HOJA DE RESPUESTAS DE UN ESTUDIANTE.

NO tienes acceso a las respuestas correctas. Indica QUÉ LETRA está marcada (con X o relleno) en cada pregunta.

ESTRUCTURA: ${columnas} columnas. Preguntas 1 a ${half}, luego ${half + 1} a ${totalPreguntas}. Opciones: ${alts.join(", ")}.

Para cada pregunta (1 a ${totalPreguntas}) indica SOLO la letra que VES marcada. Si no hay marca, "SIN_RESPUESTA". NO inventes. El estudiante puede marcar mal; refleja exactamente lo marcado.

Responde SOLO este JSON:
{"r":[{"p":1,"a":"?"},{"p":2,"a":"?"},...,{"p":${totalPreguntas},"a":"?"}]}
"p" = número de pregunta, "a" = letra (${alts.join("/")}) o "" si no hay marca. Exactamente ${totalPreguntas} elementos en "r".`

  const content: any[] = []
  if (conPlantilla) {
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${templateImageBase64}` } })
  }
  content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${studentImageBase64}` } })
  content.push({ type: "text", text: prompt })

  const res = await fetchMistralWithRetry("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: "pixtral-12b-2409",
      messages: [{ role: "user", content }],
      temperature: 0,
      max_tokens: 2048,
      response_format: { type: "json_object" },
    }),
  })

  if (!res.ok) throw new Error(`Mistral OMR error: ${res.status}`)
  const data = await res.json()
  const responseText = data.choices?.[0]?.message?.content || ""
  const match = responseText.match(/\{[\s\S]*\}/)
  if (!match) return []

  const parsed = JSON.parse(match[0])
  const rawR = Array.isArray(parsed?.r) ? parsed.r : []
  const respMap = new Map<number, string>()
  for (const r of rawR) {
    const num = Number(r?.p)
    if (num >= 1 && num <= totalPreguntas && !respMap.has(num)) {
      const ans = String(r?.a || "").trim().toUpperCase()
      respMap.set(num, alts.includes(ans) ? ans : ans || "SIN_RESPUESTA")
    }
  }

  const out: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
  for (let i = 1; i <= totalPreguntas; i++) {
    const a = respMap.get(i) || "SIN_RESPUESTA"
    out.push({
      pregunta: `SM${i}`,
      respuesta_detectada: a,
      confianza: a && a !== "SIN_RESPUESTA" ? 0.9 : 0.4,
    })
  }
  return out
}

async function extractStudentClosedAnswersAzureLayoutOfficial(params: {
  studentImageBase64: string
  teacherAnswerKey: Array<{ pregunta: string; respuestaCorrecta: string }>
  /** Si se pasa >0, el pipeline completa huecos con BLANK inferido (completedByExpectation). Omitir para solo lectura sensorial. */
  expectedQuestionCount?: number
  templateKey: string
  templateVariant?: "odd_even_dual_column" | "sequential_dual_column"
}): Promise<{
  detectedAnswers: { pregunta: string; respuesta_detectada: string; confianza: number }[]
  officialOmrPerQuestionRaw: any[]
  officialOmrDetectedAnswersPreview: Array<{ pregunta: string; respuesta_detectada: string; confianza: number }>
  officialOmrQuestionCountFromPipeline: number
  officialOmrDetectedAnswersCount: number
  officialOmrDetectedVsPipelineMismatch: boolean
  officialOmrAdapterMode: "direct_passthrough_from_experimental"
}> {
  console.info("[official_azure_layout_family] invoking runAzureLayoutOmrPipeline")
  const raw = params.studentImageBase64.replace(/^data:image\/\w+;base64,/, "").trim()
  const imageBuffer = Buffer.from(raw, "base64")
  const expectation =
    typeof params.expectedQuestionCount === "number" && params.expectedQuestionCount > 0
      ? params.expectedQuestionCount
      : undefined
  const azure = await runAzureLayoutOmrPipeline({
    imageBuffer,
    templateKey: params.templateKey,
    ...(expectation !== undefined ? { expectedQuestionCount: expectation } : {}),
    canonicalWidth: 1200,
    canonicalHeight: 1700,
    omrTemplateVariant: params.templateVariant ?? "odd_even_dual_column",
  })
  if (!azure || (azure as any).success !== true) {
    if ((azure as any)?.errorCode === "AZURE_LAYOUT_PIPELINE_UNAVAILABLE") {
      throw new Error(
        "[official_azure_layout_family] experimental pipeline unavailable (stub detectado)"
      )
    }
    throw new Error(
      `[official_azure_layout_family] ${String((azure as any)?.errorCode ?? "UNKNOWN")} ${String((azure as any)?.error ?? "falló lectura")}`
    )
  }

  const perQuestion = Array.isArray((azure as any).perQuestion) ? (azure as any).perQuestion : []
  const sorted = [...perQuestion].sort(
    (a, b) => Number(a?.questionNumber ?? 0) - Number(b?.questionNumber ?? 0),
  )

  const out: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
  for (const row of sorted) {
    const qn = Number(row?.questionNumber ?? 0)
    if (qn < 1) continue
    const keyIdRaw = String(params.teacherAnswerKey[qn - 1]?.pregunta ?? `SM${qn}`).trim()
    const keyId = keyIdRaw || `SM${qn}`
    // Passthrough desde el pipeline: vacío / BLANK / SIN_RESPUESTA → BLANK (no confundir "BLANK" con letra B en normalización).
    const ansRaw = String(row?.selectedAnswer ?? "").trim().toUpperCase()
    const ans =
      ansRaw === "" || ansRaw === "SIN_RESPUESTA" || ansRaw === "BLANK" ? "BLANK" : ansRaw
    out.push({
      pregunta: keyId,
      respuesta_detectada: ans,
      confianza: ans !== "BLANK" && ans !== "SIN_RESPUESTA" ? 0.92 : 0.4,
    })
  }
  console.info("[official_azure_layout_family] pipeline_success", {
    pipelineExpectationPassed: expectation ?? null,
    perQuestionCount: perQuestion.length,
    detectedAnswersCount: out.length,
  })
  return {
    detectedAnswers: out,
    officialOmrPerQuestionRaw: perQuestion,
    officialOmrDetectedAnswersPreview: out.slice(0, 12),
    officialOmrQuestionCountFromPipeline: perQuestion.length,
    officialOmrDetectedAnswersCount: out.length,
    officialOmrDetectedVsPipelineMismatch: out.length !== perQuestion.length,
    officialOmrAdapterMode: "direct_passthrough_from_experimental",
  }
}

// Llamar a Mistral Vision para analizar la prueba.
// CRÍTICO: La pauta de respuestas CORRECTAS (pautaCorrectaAlternativas) NUNCA se envía al modelo
// en esta función. Solo se usa en calculateFinalScore para comparar. Así evitamos que la IA
// devuelva las correctas como si fueran lo que marcó el estudiante.
async function analyzeWithMistralVision(
  imageBase64: string,
  rubrica: string,
  pauta: string,
  pautaEstructurada: string,
  pautaCorrectaAlternativas: string, // Solo para construir itemScores; NO se incluye en el prompt de extracción
  nivelEducativo: string,
  areaConocimiento: string,
  puntajeTotal: number,
  porcentajeExigencia: number,
  tipoPrueba: "mixta" | "solo_desarrollo" | "solo_alternativas" = "mixta"
): Promise<any> {
  const itemScores = parsePautaEstructurada(pautaEstructurada)
  const soloDesarrollo = tipoPrueba === "solo_desarrollo"
  const soloAlternativas = tipoPrueba === "solo_alternativas"

  // NO usar pautaCorrectaAlternativas en el prompt: la extracción debe ser fiel a lo que ve en la imagen.
  // La corrección se hace después en calculateFinalScore comparando con la plantilla del profesor.

  const prompt = `Eres un evaluador pedagógico experto chileno. Analiza esta imagen de una prueba de un estudiante y genera una evaluación completa. Esta imagen puede ser de CUALQUIER tipo de prueba (mixta, solo desarrollo, solo alternativas); adapta tu respuesta al contenido visible.

CONTEXTO:
- Nivel educativo: ${nivelEducativo}
- Área de conocimiento: ${areaConocimiento}
- Puntaje total máximo: ${puntajeTotal} puntos
- Porcentaje de exigencia para aprobar: ${porcentajeExigencia}%
- Tipo de prueba: ${soloDesarrollo ? "SOLO DESARROLLO (no hay alternativas)" : soloAlternativas ? "SOLO ALTERNATIVAS (no hay desarrollo)" : "MIXTA (alternativas + desarrollo)"}

RÚBRICA DE EVALUACIÓN:
${rubrica}

${pauta && !soloAlternativas ? `PAUTA DE CORRECCIÓN (Desarrollo):\n${pauta}` : ""}

PAUTA DE PUNTAJES POR ÍTEM:
${pautaEstructurada || "No especificada"}

TAREA:
1. Identifica el nombre del estudiante si está visible.
${soloDesarrollo ? "" : `2. EXTRAE ÚNICAMENTE lo que el estudiante marcó en esta hoja. Para cada pregunta de alternativas (SM, V/F, términos pareados): lee la letra o número que está marcado con X o relleno en la imagen. Responde SOLO con lo que VES marcado (A, B, C, D, E, V, F, o número). Si no hay marca clara, escribe "SIN_RESPUESTA". NO inventes ni uses ninguna lista de respuestas correctas: extrae solo lo que muestra la imagen.`}
${soloAlternativas ? "" : `3. PREGUNTAS DE DESARROLLO (OBLIGATORIO):
   - En "texto_estudiante" DEBES copiar LITERALMENTE lo que el estudiante escribió. Si hay texto manuscrito visible, CÍTALO aquí.
   - En "justificacion" explica POR QUÉ tiene ese puntaje citando partes concretas de su respuesta.
   - PROHIBIDO escribir "no contestó", "sin respuesta" o "no respondió" si en la imagen hay CUALQUIER texto manuscrito en la pregunta. Solo "Sin respuesta" cuando la zona de respuesta está realmente en blanco.
   - El puntaje debe reflejar lo que se ve; si hay texto, debe haber cita en texto_estudiante.`}
4. RETROALIMENTACIÓN (tono de educador, preciso y técnico):
   - "fortalezas": Escribe como un docente que reconoce el avance del estudiante. Cita entre comillas frases exactas de lo que escribió o marcó y explica por qué son un logro (concepto bien aplicado, buena argumentación, etc.). Sé cálido pero preciso; evita generalidades.
   - "areas_mejora": Escribe como un docente que orienta el crecimiento. Cita entre comillas lo que escribió el estudiante y indica qué puede mejorar y cómo (sin desvalorizar). Sé claro y técnico, con clima de apoyo. No digas que no contestó si en la imagen hay respuesta visible.

FORMATO DE RESPUESTA (JSON estricto):
{
  "nombreEstudiante": "nombre detectado o null",
  "respuestas_cerradas": ${soloDesarrollo ? "[]" : `[
    {"pregunta": "SM1", "respuesta_detectada": "LETRA O NUMERO QUE VES MARCADO EN LA HOJA", "confianza": 0.95}
  ]`},
  "respuestas_desarrollo": ${soloAlternativas ? "{}" : `{
    "P39": {
      "texto_estudiante": "CITA TEXTUAL EXACTA de lo que escribió el estudiante",
      "puntaje": "X/Y",
      "justificacion": "explicación que INCLUYE al menos una cita entre comillas del texto del estudiante y por qué tiene ese puntaje"
    }
  }`},
  "retroalimentacion": {
    "fortalezas": "Como docente: reconoce logros CITANDO entre comillas texto exacto del estudiante y explicando por qué es fortaleza (preciso y con clima educativo).",
    "areas_mejora": "Como docente: orienta mejoras CITANDO entre comillas lo que escribió y qué puede mejorar, con tono de apoyo y precisión técnica.",
    "correccion_detallada": [{"seccion": "Seccion", "detalle": "explicación con al menos UNA cita textual entre comillas del estudiante y por qué tuvo ese puntaje"}]
  }
}

REGLA CRÍTICA PARA ALTERNATIVAS: En "respuesta_detectada" debes poner ÚNICAMENTE la letra o número que el estudiante marcó en esta hoja (lo que se ve en la imagen). No uses ninguna pauta de respuestas correctas para rellenar este campo. Si el estudiante marcó mal, debes poner lo que marcó, no la respuesta correcta.

INSTRUCCIONES PARA PREGUNTAS DE DESARROLLO (si la prueba tiene desarrollo):
1. BUSCA en la imagen el número de la pregunta y el texto manuscrito debajo.
2. En "texto_estudiante" COPIA EXACTAMENTE lo que escribió el estudiante (cita literal). Si hay texto visible, DEBE aparecer aquí; no resumas.
3. En "justificacion" explica POR QUÉ tiene ese puntaje e INCLUYE al menos una cita entre comillas de lo que escribió el estudiante.
4. En "correccion_detallada" cada elemento en "detalle" DEBE contener al menos una cita entre comillas del texto del estudiante.
5. PROHIBIDO: No escribas "Sin respuesta", "no contestó", "no respondió" ni "no hay texto escrito por el estudiante" en desarrollo si hay CUALQUIER texto manuscrito en la zona de esa pregunta. Solo usa "Sin respuesta" cuando la zona está realmente en blanco.`

  const response = await fetchMistralWithRetry("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      // IMPORTANTE: Usar pixtral-12b-2409 que SI tiene vision
      model: "pixtral-12b-2409",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            { type: "text", text: prompt },
          ],
        },
      ],
      temperature: 0.1,
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
  if (!content) throw new Error("Respuesta vacía de Mistral Vision")
  
  return JSON.parse(content)
}

/** Llamada dedicada SOLO a preguntas de desarrollo: extracción con CITAS textuales obligatorias y retroalimentación profunda. */
async function analyzeDevelopmentOnly(
  imageBase64: string,
  rubrica: string,
  pauta: string,
  pautaEstructurada: string,
  nivelEducativo: string,
  areaConocimiento: string
): Promise<{ respuestas_desarrollo: Record<string, any>; retroalimentacion: any }> {
  const prompt = `Eres un evaluador experto con mirada pedagógica. Esta imagen es de una prueba con PREGUNTAS DE DESARROLLO (respuestas abiertas, escritas a mano).

CITAS OBLIGATORIAS EN DESARROLLO (no omitas ninguna):
- En CADA "texto_estudiante" debes poner la CITA LITERAL de lo que el estudiante escribió. Si hay texto visible, copia el texto exacto; no resumas. Si la zona está en blanco, escribe "Sin respuesta".
- En CADA "justificacion" debes incluir al menos UNA cita entre comillas del texto del estudiante y explicar por qué tiene ese puntaje.
- En "correccion_detallada" CADA ítem en "detalle" debe contener al menos UNA cita entre comillas de lo que escribió el estudiante y por qué tuvo ese puntaje.

FORTALEZAS Y ÁREAS DE MEJORA (tono de educador, preciso y técnico):
- "fortalezas": Escribe como un docente que reconoce el avance. Cita entre comillas frases exactas de lo que escribió el estudiante y explica por qué son un logro (concepto bien aplicado, argumentación, etc.). Tono cálido y preciso.
- "areas_mejora": Escribe como un docente que orienta el crecimiento. Cita entre comillas lo que escribió e indica qué puede mejorar y cómo, con tono de apoyo y precisión técnica. No desvalorices.

PROHIBIDO: No digas "no contestó" ni "no respondió" si hay CUALQUIER texto manuscrito visible en la pregunta. Solo "Sin respuesta" si la zona está realmente en blanco.

RÚBRICA:
${rubrica}

PAUTA DE CORRECCIÓN (Desarrollo):
${pauta || "No especificada"}

PAUTA DE PUNTAJES:
${pautaEstructurada || "No especificada"}

Nivel: ${nivelEducativo}. Área: ${areaConocimiento}.

Responde ÚNICAMENTE con este JSON (cada texto_estudiante y cada detalle con cita literal):
{
  "respuestas_desarrollo": {
    "P1": { "texto_estudiante": "cita literal exacta de lo que escribió el estudiante", "puntaje": "X/Y", "justificacion": "explicación que incluye al menos una cita entre comillas del estudiante" }
  },
  "retroalimentacion": {
    "fortalezas": "Como docente: reconoce logros citando entre comillas texto del estudiante; tono educativo y preciso.",
    "areas_mejora": "Como docente: orienta mejoras citando entre comillas lo que escribió; tono de apoyo y técnico.",
    "correccion_detallada": [{"seccion": "Nombre pregunta", "detalle": "explicación con al menos una cita entre comillas del estudiante y por qué tuvo ese puntaje"}]
  }
}
Las claves de respuestas_desarrollo pueden ser P1, P2, P39, P40, etc. según los números de pregunta que veas. texto_estudiante DEBE ser el texto real escrito por el estudiante, no un resumen.`

  const res = await fetchMistralWithRetry("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: "pixtral-12b-2409",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          { type: "text", text: prompt },
        ],
      }],
      temperature: 0.1,
      response_format: { type: "json_object" },
      max_tokens: 8192,
    }),
  })

  if (!res.ok) throw new Error(`Mistral Development error: ${res.status}`)
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) return { respuestas_desarrollo: {}, retroalimentacion: {} }
  const parsed = JSON.parse(content)
  return {
    respuestas_desarrollo: parsed.respuestas_desarrollo || {},
    retroalimentacion: parsed.retroalimentacion || {},
  }
}

// Calcular puntaje final combinando alternativas y desarrollo
function calculateFinalScore(
  respuestasCerradas: any[],
  respuestasDesarrollo: any,
  pautaEstructurada: string,
  pautaCorrectaAlternativas: string,
  puntajeTotal: number,
  porcentajeExigencia: number
) {
  const itemScores = parsePautaEstructurada(pautaEstructurada)
  
  // Parsear pauta de alternativas correctas
  // Soporta formatos: "SM1:A", "1:A", "pregunta1:A"
  const pautaMap = new Map<string, string>()
  if (pautaCorrectaAlternativas) {
    const pairs = pautaCorrectaAlternativas.split(";").map(p => p.trim()).filter(p => p)
    for (const pair of pairs) {
      const [pregunta, respuesta] = pair.split(":").map(s => s.trim())
      if (pregunta && respuesta) {
        const key = pregunta.toUpperCase()
        const val = respuesta.toUpperCase()
        pautaMap.set(key, val)
        // Tambien guardar variantes
        const numMatch = key.match(/(\d+)/)
        if (numMatch) {
          const num = numMatch[1]
          pautaMap.set(num, val)
          pautaMap.set(`SM${num}`, val)
          pautaMap.set(`PREGUNTA${num}`, val)
        }
      }
    }
  }

  let scoreAlternativas = 0
  let scoreDesarrollo = 0
  const alternativasCorregidas: AlternativeResult[] = []

  // Corregir respuestas cerradas
  for (const resp of respuestasCerradas || []) {
    const preguntaId = String(resp.pregunta).toUpperCase()
    const respuestaDetectada = String(resp.respuesta_detectada || "").toUpperCase()
    
    // Buscar respuesta correcta con variantes
    const numMatch = preguntaId.match(/(\d+)/)
    const num = numMatch ? numMatch[1] : preguntaId
    const respuestaCorrecta = pautaMap.get(preguntaId) 
      || pautaMap.get(num) 
      || pautaMap.get(`SM${num}`) 
      || ""

    alternativasCorregidas.push({
      pregunta: preguntaId,
      respuesta_estudiante: respuestaDetectada,
      respuesta_correcta: respuestaCorrecta,
    })

    if (respuestaCorrecta && respuestaDetectada === respuestaCorrecta) {
      const itemMatch = itemScores.find(i => i.id.toUpperCase() === preguntaId)
      scoreAlternativas += itemMatch?.maxScore || 1
    }
  }

  // Sumar puntajes de desarrollo
  for (const itemId in respuestasDesarrollo || {}) {
    const item = respuestasDesarrollo[itemId]
    if (!item || typeof item !== "object") continue
    let puntajeObtenido = 0
    let puntajeMaximoItem = 1
    if (typeof item.puntaje === "string" && item.puntaje.includes("/")) {
      const parts = item.puntaje.split("/")
      puntajeObtenido = parseInt(parts[0], 10) || 0
      puntajeMaximoItem = parseInt(parts[1], 10) || 1
    } else if (typeof item.puntaje === "number") {
      puntajeObtenido = item.puntaje
      puntajeMaximoItem = item.puntaje
    } else if (item.puntaje && typeof item.puntaje === "object") {
      const p = item.puntaje as Record<string, unknown>
      if (typeof p.total === "number") {
        puntajeObtenido = p.total
        puntajeMaximoItem = p.total
      }
    } else if (typeof (item as any).total === "number") {
      puntajeObtenido = (item as any).total
      puntajeMaximoItem = (item as any).total
    }
    scoreDesarrollo += puntajeObtenido
  }

  const totalScore = scoreAlternativas + scoreDesarrollo
  const nota = calculateGrade(totalScore, puntajeTotal, porcentajeExigencia)
  
  const exigenciaDecimal = Math.min(100, porcentajeExigencia) / 100
  const puntosAprobacion = Math.ceil(puntajeTotal * exigenciaDecimal)

  return {
    puntaje: `${totalScore}/${puntajeTotal}`,
    nota,
    puntosAprobacion,
    puntosMaximos: puntajeTotal,
    alternativas_corregidas: alternativasCorregidas,
    scoreAlternativas,
    scoreDesarrollo,
  }
}

/** Normaliza respuestas_desarrollo para que cada ítem tenga puntaje como string "X/Y" (evita [object Object] y permite calcular nota). */
function normalizeRespuestasDesarrollo(
  respuestasDesarrollo: Record<string, any> | null | undefined
): Record<string, { texto_estudiante?: string; cita_estudiante?: string; puntaje: string; justificacion?: string }> {
  const out: Record<string, { texto_estudiante?: string; cita_estudiante?: string; puntaje: string; justificacion?: string }> = {}
  if (!respuestasDesarrollo || typeof respuestasDesarrollo !== "object") return out
  for (const [key, item] of Object.entries(respuestasDesarrollo)) {
    if (item == null || typeof item !== "object") continue
    let puntajeStr = "0/1"
    if (typeof item.puntaje === "string" && item.puntaje.includes("/")) {
      puntajeStr = item.puntaje
    } else if (typeof item.puntaje === "number") {
      puntajeStr = `${item.puntaje}/${item.puntaje}`
    } else if (item.puntaje && typeof item.puntaje === "object" && typeof (item.puntaje as any).total === "number") {
      const t = (item.puntaje as any).total
      puntajeStr = `${t}/${t}`
    } else if (typeof (item as any).total === "number") {
      const t = (item as any).total
      puntajeStr = `${t}/${t}`
    }
    const texto = item.texto_estudiante ?? item.cita_estudiante ?? ""
    const justif = typeof item.justificacion === "string" ? item.justificacion : (item.justificacion ? JSON.stringify(item.justificacion) : "")
    out[key] = {
      texto_estudiante: texto,
      cita_estudiante: texto,
      puntaje: puntajeStr,
      justificacion: justif,
    }
  }
  return out
}

/** Suaviza mensajes que culpan al estudiante cuando puede ser un problema de lectura/OCR. */
function sanitizeStudentBlameText(text: string | null | undefined): string {
  if (!text || typeof text !== "string") return text || ""
  let out = text
  const patterns = [
    /no hay texto escrito por el estudiante/gi,
    /no hay texto del estudiante/gi,
    /no respondi[oó]/gi,
    /no contest[oó]/gi,
    /no respondi[oó] la pregunta/gi,
    /no contest[oó] la pregunta/gi,
  ]
  for (const p of patterns) {
    out = out.replace(
      p,
      "en la transcripción disponible no se observa una respuesta legible para esta pregunta"
    )
  }
  return out
}

function sanitizeRetroalimentacion(retro: any): any {
  if (!retro || typeof retro !== "object") return retro
  const cleaned: any = { ...retro }
  if (typeof cleaned.fortalezas === "string") {
    cleaned.fortalezas = sanitizeStudentBlameText(cleaned.fortalezas)
  }
  if (typeof cleaned.areas_mejora === "string") {
    cleaned.areas_mejora = sanitizeStudentBlameText(cleaned.areas_mejora)
  }
  if (Array.isArray(cleaned.correccion_detallada)) {
    cleaned.correccion_detallada = cleaned.correccion_detallada.map((c: any) => {
      if (!c || typeof c !== "object") return c
      return {
        ...c,
        detalle: sanitizeStudentBlameText(c.detalle),
      }
    })
  }
  return cleaned
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
      fileUrls = [],
      fileMimeTypes = [],
      rubrica = "",
      pauta = "",
      puntajeTotal = 100,
      porcentajeExigencia = 55,
      pautaEstructurada = "",
      pautaCorrectaAlternativas = "",
      nivelEducativo = "Educación Media",
      areaConocimiento = "general",
      respuestasAlternativas,
      answerKeyFromTemplate: answerKeyFromBody,
      templateImageUrl,
      templateId,
      tipoPrueba = "mixta", // "mixta" | "solo_desarrollo" | "solo_alternativas"
      flexibilidad = 3,
      nombreEstudiante: nombreEstudianteBody,
      // Persistencia Supabase (opcional; no afecta la respuesta)
      teacher_id: teacherIdBody,
      school_id: schoolIdBody,
      course_id: courseIdBody,
      evaluation_title: evaluationTitleBody,
      evaluation_subject: evaluationSubjectBody,
      officialOmrIntegrationEnabled: officialOmrIntegrationEnabledIn,
      officialOmrEngineSelected: officialOmrEngineSelectedIn,
      omrTemplateVariant: omrTemplateVariantIn,
      officialOmrAllowFallbackToLegacy: officialOmrAllowFallbackToLegacyIn,
    } = body
    const officialOmrIntegrationEnabled = true
    const officialOmrEngineSelected: "legacy" | "azure_layout_family" = "azure_layout_family"
    const omrTemplateVariant: "odd_even_dual_column" | "sequential_dual_column" =
      omrTemplateVariantIn === "sequential_dual_column" ? "sequential_dual_column" : "odd_even_dual_column"
    let officialOmrEngineUsed: "legacy" | "azure_layout_family" = "legacy"
    let officialOmrFallbackUsed = false
    let officialOmrFallbackReason: string | null = null
    const officialOmrAllowFallbackToLegacy = officialOmrAllowFallbackToLegacyIn !== false
    let officialOmrPerQuestionRaw: any[] = []
    let officialOmrDetectedAnswersPreview: Array<{ pregunta: string; respuesta_detectada: string; confianza: number }> = []
    let officialOmrQuestionCountFromPipeline = 0
    let officialOmrDetectedAnswersCount = 0
    let officialOmrDetectedVsPipelineMismatch = false
    let officialOmrAdapterMode: "direct_passthrough_from_experimental" | "legacy_extract_student_only" =
      "legacy_extract_student_only"
    let officialOmrExpectedQuestionCountUsed = 0
    let officialOmrTeacherAnswerKeyLength = 0
    let officialOmrTotalPregResolved = 0
    let officialOmrTemplateKeyUsed = "template_38_4"
    let officialOmrTemplateVariantUsed: "odd_even_dual_column" | "sequential_dual_column" = "odd_even_dual_column"
    const teacherAnswersSource = "teacher_key"
    const studentAnswersSource = "student_omr_read"
    console.info("[trace][omr_official][request_flags]", {
      officialOmrIntegrationEnabledIn,
      officialOmrEngineSelectedIn,
      officialOmrAllowFallbackToLegacyIn,
      omrTemplateVariantIn,
    })

    // Regla de oro: teacher_id/school_id SOLO desde perfil en BD. Ignorar body.
    let effectiveTeacherId: string | null = null
    let effectiveSchoolId: string | null = null
    let authUserId: string | null = null
    const user = await getAuthUser()
    if (user) {
      authUserId = user.id
      const supabase = getSupabaseServer()
      if (supabase) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("teacher_id, school_id")
          .eq("user_id", user.id)
          .maybeSingle()
        if (profile?.teacher_id) {
          effectiveTeacherId = profile.teacher_id
          effectiveSchoolId = profile.school_id ?? null
          if (process.env.NODE_ENV !== "production") console.info("[evaluate] teacher_id desde perfil:", profile.teacher_id)
        }
      }
    }

    // Memoria interna: si se envía templateId, cargar plantilla desde caché (Redis o memoria)
    let answerKeyFromTemplate = answerKeyFromBody
    let cachedTemplateBase64: string | undefined
    if (templateId && typeof templateId === "string") {
      try {
        const cached = await getTemplate(templateId)
        const cachedImg = await getTemplateImage(templateId)
        if (cached) {
          answerKeyFromTemplate = {
            respuestas: cached.respuestas,
            totalPreguntas: cached.totalPreguntas,
          }
          if (cachedImg) cachedTemplateBase64 = cachedImg.base64
        }
      } catch (_) {
        // Si falla la caché, seguir con answerKeyFromBody y templateImageUrl
      }
    }

    if (!fileUrls.length) {
      return NextResponse.json(
        { success: false, error: "No se proporcionaron imágenes para evaluar" },
        { status: 400 }
      )
    }

    const validFileUrls = fileUrls.filter((u: string) => u && String(u).length > 0)
    const fileMimeTypesArray = Array.isArray(fileMimeTypes) ? fileMimeTypes : []

    // Rama PDF/Word: Azure Document Intelligence extrae texto y Mistral evalúa por texto (sin convertir PDF a imágenes).
    const useAzurePath = hasPdfOrWord(fileMimeTypesArray)
    const azureEndpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
    const azureKey = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY

    let combinedAnalysis: any = {
      respuestas_cerradas: [],
      respuestas_desarrollo: {},
      retroalimentacion: { fortalezas: "", areas_mejora: "", correccion_detallada: [] },
      nombreEstudiante: null,
    }

    // Variables comunes para ambos caminos (imágenes o PDF/Word)
    let pautaAlternativasFinal = pautaCorrectaAlternativas
    if (answerKeyFromTemplate?.respuestas && answerKeyFromTemplate.respuestas.length > 0) {
      pautaAlternativasFinal = answerKeyFromTemplate.respuestas
        .map((r: any) => `${r.pregunta}:${(r.respuestaCorrecta || "").toString().trim().toUpperCase()}`)
        .filter((s: string) => s.length > 0)
        .join("; ")
    }
    const tipoPruebaReal = tipoPrueba === "solo_desarrollo" || tipoPrueba === "solo_alternativas" ? tipoPrueba : "mixta"
    const tieneAlternativas = tipoPruebaReal !== "solo_desarrollo"
    let respuestasCerradasDesdeOMR: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []

    if (useAzurePath) {
      if (!azureEndpoint || !azureKey) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Para evaluar PDF o Word debe configurar Azure Document Intelligence (AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT y AZURE_DOCUMENT_INTELLIGENCE_KEY en .env.local).",
          },
          { status: 400 }
        )
      }
      try {
        const fileBuffers = await getFileBuffersFromUrls(validFileUrls, fileMimeTypesArray)
        const docIntelClient = new DocumentAnalysisClient(azureEndpoint, new AzureKeyCredential(azureKey))
        const textoExtraido = await extractTextFromFiles(fileBuffers, docIntelClient)
        if (!textoExtraido || textoExtraido === "NO SE PUDO EXTRAER TEXTO.") {
          return NextResponse.json(
            {
              success: false,
              error: "No se pudo extraer texto del PDF o documento. Verifique que el archivo no esté protegido o dañado.",
            },
            { status: 400 }
          )
        }
        combinedAnalysis = await analyzeWithMistralText(
          textoExtraido,
          rubrica,
          pauta,
          pautaEstructurada,
          pautaAlternativasFinal,
          nivelEducativo,
          areaConocimiento,
          Number(puntajeTotal),
          Number(porcentajeExigencia),
          tipoPruebaReal,
          Number(flexibilidad) || 3,
          typeof nombreEstudianteBody === "string" ? nombreEstudianteBody.trim() || undefined : undefined
        )
      } catch (e: any) {
        console.error("[evaluate] Rama Azure (PDF/Word):", e)
        let errMsg = e?.message || "Error al evaluar el documento (Azure/Mistral)."
        if (/503|502|429|upstream connect error|overflow/.test(errMsg)) {
          errMsg = "El servicio de IA no está disponible en este momento. Espera unos minutos e intenta de nuevo."
        }
        return NextResponse.json(
          { success: false, error: errMsg },
          { status: 500 }
        )
      }
    } else {
    // Rama imágenes: convertir a listado (solo imágenes; sin PDF/Word) y evaluar con Mistral Vision
    let imageBase64List: string[]
    try {
      imageBase64List = await resolveToImageBase64List(validFileUrls, fileMimeTypesArray)
    } catch (e: any) {
      const msg = e?.message || "Error al procesar archivos"
      const isClientError = typeof msg === "string" && (msg.includes("Word") || msg.includes("PDF") || msg.includes("Exporta"))
      return NextResponse.json(
        { success: false, error: msg },
        { status: isClientError ? 400 : 500 }
      )
    }
    if (!imageBase64List.length) {
      return NextResponse.json(
        { success: false, error: "No se obtuvieron imágenes de los archivos subidos" },
        { status: 400 }
      )
    }

    // Extraer respuestas cerradas desde la imagen del estudiante (OMR dedicado), independiente de si hay pauta.
    if (imageBase64List.length > 0) {
      const teacherAnswerKeyBase = Array.isArray(answerKeyFromTemplate?.respuestas)
        ? answerKeyFromTemplate.respuestas
        : []
      const templateKeyUsed = "template_38_4"
      const expectedByTemplateKey = templateKeyUsed === "template_38_4" ? 38 : 0
      const closedQuestionsFromPauta = parsePautaEstructurada(pautaEstructurada).filter(
        (i) => !i.isDevelopment
      ).length
      const totalPreg =
        Number(answerKeyFromTemplate?.totalPreguntas) ||
        teacherAnswerKeyBase.length ||
        closedQuestionsFromPauta ||
        expectedByTemplateKey ||
        1
      officialOmrTotalPregResolved = totalPreg
      officialOmrTeacherAnswerKeyLength = teacherAnswerKeyBase.length
      officialOmrTemplateKeyUsed = templateKeyUsed
      const altsSet = new Set<string>()
      for (const r of teacherAnswerKeyBase) {
        const v = (r.respuestaCorrecta || "").toString().trim().toUpperCase()
        if (v) altsSet.add(v)
      }
      const alternativasArray = altsSet.size > 0 ? Array.from(altsSet) : ["A", "B", "C", "D"]
      const columnas = 2

      for (let i = 0; i < imageBase64List.length; i++) {
        try {
          const studentBase64 = imageBase64List[i]
          let templateBase64: string | undefined = cachedTemplateBase64
          if (!templateBase64 && templateImageUrl && typeof templateImageUrl === "string") {
            try {
              templateBase64 = await urlToBase64(templateImageUrl)
              if (templateBase64 && isPdfBase64(templateBase64)) templateBase64 = undefined
            } catch (_) {}
          }
          let extraidas: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
          const tryOfficialAzure =
            officialOmrIntegrationEnabled === true && officialOmrEngineSelected === "azure_layout_family"
          console.info("[trace][omr_official][engine_selector]", {
            tryOfficialAzure,
            officialOmrIntegrationEnabled,
            officialOmrEngineSelected,
            officialOmrAllowFallbackToLegacy,
            hasTemplateAnswerKey: Boolean(answerKeyFromTemplate?.respuestas?.length),
            totalPreg,
          })
          if (tryOfficialAzure) {
            try {
              const teacherAnswerKey = teacherAnswerKeyBase.map((r: any) => ({
                pregunta: String(r?.pregunta ?? ""),
                respuestaCorrecta: String(r?.respuestaCorrecta ?? ""),
              }))
              const expectedQuestionCountUsed = Math.max(1, totalPreg, expectedByTemplateKey)
              officialOmrExpectedQuestionCountUsed = expectedQuestionCountUsed
              officialOmrTemplateKeyUsed = templateKeyUsed
              officialOmrTemplateVariantUsed = omrTemplateVariant
              const azureOfficial = await extractStudentClosedAnswersAzureLayoutOfficial({
                studentImageBase64: studentBase64,
                teacherAnswerKey,
                // No pasar expectedQuestionCount: evita completedByExpectation masivo en el pipeline cuando hay pocos rows observados.
                templateKey: templateKeyUsed,
                templateVariant: omrTemplateVariant,
              })
              console.info("[official_azure_layout_family] adapter_result", {
                detectedAnswersCount: azureOfficial.detectedAnswers.length,
                questionCountFromPipeline: azureOfficial.officialOmrQuestionCountFromPipeline,
              })
              extraidas = azureOfficial.detectedAnswers
              console.info("[CRITICAL] USING EXPERIMENTAL OMR", extraidas.slice(0,5))
              console.info("[trace][omr_official][extraidas_after_azure]", {
                extraidasFirst10: extraidas.slice(0, 10),
                extraidasCount: extraidas.length,
                officialOmrPerQuestionRawCount: Array.isArray(azureOfficial.officialOmrPerQuestionRaw)
                  ? azureOfficial.officialOmrPerQuestionRaw.length
                  : 0,
              })
              officialOmrPerQuestionRaw = azureOfficial.officialOmrPerQuestionRaw
              officialOmrDetectedAnswersPreview = azureOfficial.officialOmrDetectedAnswersPreview
              officialOmrQuestionCountFromPipeline = azureOfficial.officialOmrQuestionCountFromPipeline
              officialOmrDetectedAnswersCount = azureOfficial.officialOmrDetectedAnswersCount
              officialOmrDetectedVsPipelineMismatch = azureOfficial.officialOmrDetectedVsPipelineMismatch
              officialOmrAdapterMode = azureOfficial.officialOmrAdapterMode
              officialOmrEngineUsed = "azure_layout_family"
            } catch (engineErr) {
              if (!officialOmrAllowFallbackToLegacy) {
                throw engineErr
              }
              officialOmrFallbackUsed = true
              officialOmrFallbackReason =
                engineErr instanceof Error ? engineErr.message : String(engineErr)
              console.warn("[Evaluate] official azure_layout_family falló, fallback legacy:", engineErr)
              extraidas = await extractStudentClosedAnswersOnly(
                studentBase64,
                totalPreg,
                alternativasArray,
                columnas,
                templateBase64
              )
              console.info("[trace][omr_official][extraidas_after_fallback_legacy]", {
                extraidasFirst10: extraidas.slice(0, 10),
                extraidasCount: extraidas.length,
                officialOmrFallbackUsed: true,
                officialOmrFallbackReason:
                  engineErr instanceof Error ? engineErr.message : String(engineErr),
              })
              officialOmrAdapterMode = "legacy_extract_student_only"
              officialOmrEngineUsed = "legacy"
            }
          } else {
            extraidas = await extractStudentClosedAnswersOnly(
              studentBase64,
              totalPreg,
              alternativasArray,
              columnas,
              templateBase64
            )
            console.info("[trace][omr_official][extraidas_after_legacy_direct]", {
              extraidasFirst10: extraidas.slice(0, 10),
              extraidasCount: extraidas.length,
            })
            officialOmrAdapterMode = "legacy_extract_student_only"
            officialOmrEngineUsed = "legacy"
          }
          for (const item of extraidas) {
            const pid = item.pregunta.toUpperCase()
            if (!respuestasCerradasDesdeOMR.some((r: any) => String(r.pregunta).toUpperCase() === pid)) {
              respuestasCerradasDesdeOMR.push(item)
            }
          }
        } catch (e) {
          if (
            officialOmrIntegrationEnabled === true &&
            officialOmrEngineSelected === "azure_layout_family" &&
            officialOmrAllowFallbackToLegacy === false
          ) {
            return NextResponse.json(
              {
                success: false,
                error: e instanceof Error ? e.message : String(e),
                officialOmrIntegrationEnabled,
                officialOmrEngineSelected,
                officialOmrAllowFallbackToLegacy,
                officialOmrEngineUsed,
                officialOmrFallbackUsed,
                officialOmrFallbackReason:
                  (e instanceof Error ? e.message : String(e)) || officialOmrFallbackReason,
                officialOmrPerQuestionRaw,
                officialOmrDetectedAnswersPreview,
                officialOmrQuestionCountFromPipeline,
                officialOmrDetectedAnswersCount,
                officialOmrDetectedVsPipelineMismatch,
                officialOmrAdapterMode,
                teacherAnswersSource,
                studentAnswersSource,
                teacherClosedAnswersCount:
                  typeof answerKeyFromTemplate?.respuestas?.length === "number"
                    ? answerKeyFromTemplate.respuestas.length
                    : 0,
                studentClosedAnswersCount: respuestasCerradasDesdeOMR.length,
              },
              { status: 500 }
            )
          }
          console.warn("[Evaluate] OMR dedicado falló para imagen", i, e)
        }
      }
    }

    // Procesar cada imagen
    combinedAnalysis = {
      respuestas_cerradas: [],
      respuestas_desarrollo: {},
      retroalimentacion: {
        fortalezas: "",
        areas_mejora: "",
        correccion_detallada: [],
      },
      nombreEstudiante: null,
    }

    for (let i = 0; i < imageBase64List.length; i++) {
      const imageBase64 = imageBase64List[i]

      const analysis = await analyzeWithMistralVision(
        imageBase64,
        rubrica,
        pauta,
        pautaEstructurada,
        pautaAlternativasFinal,
        nivelEducativo,
        areaConocimiento,
        Number(puntajeTotal),
        Number(porcentajeExigencia),
        tipoPrueba === "solo_desarrollo" || tipoPrueba === "solo_alternativas" ? tipoPrueba : "mixta"
      )

      // Combinar resultados
      if (analysis.nombreEstudiante && !combinedAnalysis.nombreEstudiante) {
        combinedAnalysis.nombreEstudiante = analysis.nombreEstudiante
      }

      if (analysis.respuestas_cerradas && respuestasCerradasDesdeOMR.length === 0) {
        // Evitar duplicados al combinar respuestas de multiples paginas
        for (const resp of analysis.respuestas_cerradas) {
          const preguntaId = String(resp.pregunta).toUpperCase()
          const exists = combinedAnalysis.respuestas_cerradas.some(
            (r: any) => String(r.pregunta).toUpperCase() === preguntaId
          )
          if (!exists) {
            combinedAnalysis.respuestas_cerradas.push(resp)
          }
        }
      }

      if (analysis.respuestas_desarrollo) {
        combinedAnalysis.respuestas_desarrollo = {
          ...combinedAnalysis.respuestas_desarrollo,
          ...analysis.respuestas_desarrollo,
        }
      }

      if (analysis.retroalimentacion) {
        if (i === 0) {
          combinedAnalysis.retroalimentacion = analysis.retroalimentacion
        } else {
          // Combinar retroalimentación de múltiples páginas
          combinedAnalysis.retroalimentacion.correccion_detallada.push(
            ...(analysis.retroalimentacion.correccion_detallada || [])
          )
        }
      }

      // Llamada dedicada a desarrollo: citas obligatorias y retroalimentación profunda (mixta o solo_desarrollo)
      // Para "solo_desarrollo" siempre se ejecuta; para "mixta" solo si hay pauta o pautaEstructurada
      const tieneDesarrollo = tipoPrueba !== "solo_alternativas"
      const ejecutarDesarrolloDedicado = tieneDesarrollo && (tipoPrueba === "solo_desarrollo" || !!pauta || !!pautaEstructurada)
      if (ejecutarDesarrolloDedicado) {
        try {
          const devResult = await analyzeDevelopmentOnly(
            imageBase64,
            rubrica,
            pauta,
            pautaEstructurada,
            nivelEducativo,
            areaConocimiento
          )
          if (Object.keys(devResult.respuestas_desarrollo || {}).length > 0) {
            combinedAnalysis.respuestas_desarrollo = {
              ...combinedAnalysis.respuestas_desarrollo,
              ...devResult.respuestas_desarrollo,
            }
          }
          if (devResult.retroalimentacion && (devResult.retroalimentacion.fortalezas || devResult.retroalimentacion.areas_mejora || (Array.isArray(devResult.retroalimentacion.correccion_detallada) && devResult.retroalimentacion.correccion_detallada.length > 0))) {
            if (i === 0) {
              combinedAnalysis.retroalimentacion = {
                ...combinedAnalysis.retroalimentacion,
                ...devResult.retroalimentacion,
              }
            } else {
              combinedAnalysis.retroalimentacion.fortalezas = combinedAnalysis.retroalimentacion.fortalezas || devResult.retroalimentacion.fortalezas
              combinedAnalysis.retroalimentacion.areas_mejora = combinedAnalysis.retroalimentacion.areas_mejora || devResult.retroalimentacion.areas_mejora
              combinedAnalysis.retroalimentacion.correccion_detallada.push(
                ...(devResult.retroalimentacion.correccion_detallada || [])
              )
            }
          }
        } catch (e) {
          console.warn("[Evaluate] Análisis desarrollo dedicado falló", e)
        }
      }
    }

    }  // fin else (rama imágenes: Mistral Vision)

    // Conservar siempre las respuestas cerradas detectadas por OMR del estudiante, aun sin pauta cargada.
    if (respuestasCerradasDesdeOMR.length > 0) {
      combinedAnalysis.respuestas_cerradas = respuestasCerradasDesdeOMR.map((r) => ({
        pregunta: r.pregunta,
        respuesta_detectada: r.respuesta_detectada || "",
        confianza: r.confianza ?? 0.9,
      }))
    }

    if (!(tieneAlternativas && answerKeyFromTemplate?.respuestas?.length) || combinedAnalysis.respuestas_cerradas.length === 0) {
      if (respuestasAlternativas && respuestasAlternativas.length > 0 && !answerKeyFromTemplate?.respuestas?.length) {
        const respMap = new Map<string, any>()
      for (const r of respuestasAlternativas) {
        const preguntaRaw = String(r.pregunta).toUpperCase()
        const numMatch = preguntaRaw.match(/(\d+)/)
        const num = numMatch ? numMatch[1] : preguntaRaw
        const preguntaId = `SM${num}`

        // Solo usar campos que son claramente respuesta DEL ESTUDIANTE (lo que marcó). NUNCA usar respuestaCorrecta aquí.
        const respuestaEstudiante = (r.respuesta_estudiante ?? r.respuesta ?? "").toString().trim()
        if (!respMap.has(preguntaId)) {
          respMap.set(preguntaId, {
            pregunta: preguntaId,
            respuesta_detectada: respuestaEstudiante,
            confianza: r.confianza ?? 1.0,
          })
        }
      }
      combinedAnalysis.respuestas_cerradas = Array.from(respMap.values())
    } else {
      // Normalizar respuestas de Mistral (formato consistente)
      const respMap = new Map<string, any>()
      for (const r of combinedAnalysis.respuestas_cerradas) {
        const preguntaRaw = String(r.pregunta).toUpperCase()
        const numMatch = preguntaRaw.match(/(\d+)/)
        const num = numMatch ? numMatch[1] : preguntaRaw
        const preguntaId = `SM${num}`
        
        if (!respMap.has(preguntaId)) {
          respMap.set(preguntaId, {
            pregunta: preguntaId,
            respuesta_detectada: r.respuesta_detectada || "",
            confianza: r.confianza || 1.0,
          })
        }
      }
      combinedAnalysis.respuestas_cerradas = Array.from(respMap.values())
    }
    }

    // Normalización final: una entrada por ítem de alternativas de la pauta, respuesta_detectada solo letra/número
    const itemScoresForNorm = parsePautaEstructurada(pautaEstructurada)
    const expectedAltIds = itemScoresForNorm.filter((i) => !i.isDevelopment).map((i) => i.id)
    const respMapByPregunta = new Map<string, { respuesta_detectada: string; confianza: number }>()
    for (const r of combinedAnalysis.respuestas_cerradas) {
      const rawId = String(r.pregunta ?? "").trim().toUpperCase()
      const num = rawId.replace(/\D/g, "")
      const detectada = normalizeRespuestaCerrada(String(r.respuesta_detectada ?? r.respuesta ?? ""))
      respMapByPregunta.set(rawId, { respuesta_detectada: detectada, confianza: Number(r.confianza) || 0.8 })
      if (num) {
        respMapByPregunta.set(num, { respuesta_detectada: detectada, confianza: Number(r.confianza) || 0.8 })
        respMapByPregunta.set(`SM${num}`, { respuesta_detectada: detectada, confianza: Number(r.confianza) || 0.8 })
      }
    }
    const normalizadas: { pregunta: string; respuesta_detectada: string; confianza: number }[] = []
    for (const expectedId of expectedAltIds) {
      const idUpper = expectedId.toUpperCase()
      const existing = respMapByPregunta.get(idUpper) || respMapByPregunta.get(expectedId) || (idUpper.replace(/\D/g, "") ? respMapByPregunta.get(idUpper.replace(/\D/g, "")) : undefined)
      normalizadas.push({
        pregunta: expectedId,
        respuesta_detectada: existing ? existing.respuesta_detectada : "BLANK",
        confianza: existing ? existing.confianza : 0,
      })
    }
    if (normalizadas.length === 0 && combinedAnalysis.respuestas_cerradas.length > 0) {
      combinedAnalysis.respuestas_cerradas = combinedAnalysis.respuestas_cerradas.map((r: any, idx: number) => ({
        pregunta: String(r.pregunta || "").trim() || `SM${idx + 1}`,
        respuesta_detectada: normalizeRespuestaCerrada(String(r.respuesta_detectada ?? r.respuesta ?? "")),
        confianza: Number(r.confianza) || 0.8,
      }))
    } else {
      combinedAnalysis.respuestas_cerradas = normalizadas
    }
    console.info("[trace][omr_official][combined_before_scoring]", {
      combinedRespuestasCerradasCount: Array.isArray(combinedAnalysis.respuestas_cerradas)
        ? combinedAnalysis.respuestas_cerradas.length
        : 0,
      combinedRespuestasCerradasFirst10: Array.isArray(combinedAnalysis.respuestas_cerradas)
        ? combinedAnalysis.respuestas_cerradas.slice(0, 10)
        : [],
      officialOmrEngineUsed,
      officialOmrFallbackUsed,
      officialOmrFallbackReason,
    })

    // Normalizar respuestas_desarrollo para que puntaje sea siempre string "X/Y" (evita [object Object] y permite calcular nota)
    combinedAnalysis.respuestas_desarrollo = normalizeRespuestasDesarrollo(combinedAnalysis.respuestas_desarrollo)

    // Sanitizar retroalimentación para no culpar al estudiante cuando es problema de lectura/OCR
    combinedAnalysis.retroalimentacion = sanitizeRetroalimentacion(combinedAnalysis.retroalimentacion)

    // Copias defensivas y separación explícita de fuentes (teacher key vs student OMR read).
    const teacherClosedAnswersForScoring = JSON.parse(JSON.stringify(pautaAlternativasFinal))
    const studentClosedAnswersDetected = Array.isArray(combinedAnalysis.respuestas_cerradas)
      ? combinedAnalysis.respuestas_cerradas.map((r: any) => ({ ...r }))
      : []
    console.info("[trace][omr_official][student_before_calculateFinalScore]", {
      teacherAnswersSource,
      studentAnswersSource,
      teacherClosedAnswersLength:
        typeof answerKeyFromTemplate?.respuestas?.length === "number"
          ? answerKeyFromTemplate.respuestas.length
          : 0,
      studentClosedAnswersDetectedCount: studentClosedAnswersDetected.length,
      studentClosedAnswersDetectedFirst10: studentClosedAnswersDetected.slice(0, 10),
    })
    if (Object.is(teacherClosedAnswersForScoring, studentClosedAnswersDetected)) {
      return NextResponse.json(
        {
          success: false,
          error: "Separación de fuentes inválida: teacher key y student answers comparten referencia.",
          teacherAnswersSource,
          studentAnswersSource,
        },
        { status: 500 }
      )
    }

    // Calcular puntaje final
    const scores = calculateFinalScore(
      studentClosedAnswersDetected,
      combinedAnalysis.respuestas_desarrollo,
      pautaEstructurada,
      teacherClosedAnswersForScoring,
      Number(puntajeTotal),
      Number(porcentajeExigencia)
    )

    // Construir respuesta
    const result = {
      success: true,
      retroalimentacion: sanitizeRetroalimentacion({
        ...combinedAnalysis.retroalimentacion,
        resumen_general: {
          fortalezas: combinedAnalysis.retroalimentacion?.fortalezas || "Análisis pendiente",
          areas_mejora: combinedAnalysis.retroalimentacion?.areas_mejora || "Análisis pendiente",
        },
        retroalimentacion_alternativas: scores.alternativas_corregidas,
      }),
      puntaje: scores.puntaje,
      nota: scores.nota,
      puntosAprobacion: scores.puntosAprobacion,
      puntosMaximos: scores.puntosMaximos,
      detalle_desarrollo: combinedAnalysis.respuestas_desarrollo,
      alternativas_corregidas: scores.alternativas_corregidas,
      nombreEstudianteDetectado: combinedAnalysis.nombreEstudiante,
      officialOmrIntegrationEnabled,
      officialOmrEngineSelected,
      officialOmrAllowFallbackToLegacy,
      officialOmrEngineUsed,
      officialOmrFallbackUsed,
      officialOmrFallbackReason,
      officialOmrPerQuestionRaw,
      officialOmrDetectedAnswersPreview,
      officialOmrQuestionCountFromPipeline,
      officialOmrDetectedAnswersCount,
      officialOmrDetectedVsPipelineMismatch,
      officialOmrAdapterMode,
      teacherAnswersSource,
      studentAnswersSource,
      teacherClosedAnswersCount:
        typeof answerKeyFromTemplate?.respuestas?.length === "number"
          ? answerKeyFromTemplate.respuestas.length
          : 0,
      studentClosedAnswersCount: studentClosedAnswersDetected.length,
    }
    console.info("[trace][omr_official][response_summary]", {
      success: true,
      officialOmrIntegrationEnabled,
      officialOmrEngineSelected,
      officialOmrEngineUsed,
      officialOmrFallbackUsed,
      officialOmrFallbackReason,
      officialOmrAdapterMode,
      officialOmrQuestionCountFromPipeline,
      officialOmrDetectedAnswersCount,
      officialOmrDetectedVsPipelineMismatch,
      teacherClosedAnswersCount:
        typeof answerKeyFromTemplate?.respuestas?.length === "number"
          ? answerKeyFromTemplate.respuestas.length
          : 0,
      studentClosedAnswersCount: studentClosedAnswersDetected.length,
    })

    // Persistencia: solo si hay sesión y perfil con teacher_id. Nunca usar IDs del body.
    let saveResult: Awaited<ReturnType<typeof persistEvaluation>>
    const canSave = !!effectiveTeacherId && !!authUserId
    if (!canSave) {
      const reason = !user ? "NO_SESSION" : "PROFILE_NOT_ONBOARDED"
      saveResult = { saved: false, success: false, error: { step: "auth", message: reason === "NO_SESSION" ? "Inicia sesión para guardar" : "Completa tu perfil para guardar" }, reason }
    } else {
      try {
        const nombreFromBody = typeof nombreEstudianteBody === "string" ? nombreEstudianteBody.trim() || null : null
        const nombreFromResult = result.nombreEstudianteDetectado != null && String(result.nombreEstudianteDetectado).trim() !== ""
          ? String(result.nombreEstudianteDetectado).trim()
          : null
        const confirmedStudentName = nombreFromBody ?? nombreFromResult ?? null
        if (process.env.NODE_ENV !== "production") {
          console.info("[student] detected_students_raw =", JSON.stringify([result.nombreEstudianteDetectado].filter(Boolean)))
          console.info("[student] confirmed_students_before_save =", JSON.stringify(confirmedStudentName ? [confirmedStudentName] : []))
        }
        saveResult = await persistEvaluation(result, {
          user_id: authUserId,
          teacher_id: effectiveTeacherId,
          school_id: effectiveSchoolId,
          course_id: typeof courseIdBody === "string" ? courseIdBody.trim() || null : null,
          title: typeof evaluationTitleBody === "string" ? evaluationTitleBody.trim() || null : null,
          subject: typeof evaluationSubjectBody === "string" ? evaluationSubjectBody.trim() || null : null,
          student_name: confirmedStudentName,
        })
      } catch (e) {
        if (process.env.NODE_ENV !== "production") console.error("[Evaluate] persistEvaluation threw:", e)
        saveResult = {
          saved: false,
          success: false,
          error: { step: "persist_throw", message: e instanceof Error ? e.message : String(e) },
        }
      }
    }

    const saved = saveResult.saved
    const evaluationId = saved ? saveResult.evaluation_id : null
    const status = saved ? saveResult.status : null
    const save_error: string | null =
      !saved && saveResult.error ? `${saveResult.error.step}: ${saveResult.error.message}` : null
    const save_reason: string | undefined = !saved && "reason" in saveResult ? (saveResult as { reason?: string }).reason : undefined

    return NextResponse.json(
      {
        ...result,
        omrDebug: {
          engineSelected: officialOmrEngineSelected,
          engineUsed: officialOmrEngineUsed,
          fallbackUsed: officialOmrFallbackUsed,
          integrationEnabled: officialOmrIntegrationEnabled,
          studentAnswersSource,
          teacherAnswersSource,
          expectedQuestionCountUsed: officialOmrExpectedQuestionCountUsed,
          teacherAnswerKeyLength: officialOmrTeacherAnswerKeyLength,
          totalPregResolved: officialOmrTotalPregResolved,
          templateKeyUsed: officialOmrTemplateKeyUsed,
          omrTemplateVariantUsed: officialOmrTemplateVariantUsed,
          officialOmrQuestionCountFromPipeline,
          officialOmrDetectedAnswersCount,
          officialOmrDetectedVsPipelineMismatch,
          officialOmrAdapterMode,
          officialOmrPerQuestionRawPreview: Array.isArray(officialOmrPerQuestionRaw)
            ? officialOmrPerQuestionRaw.slice(0, 10)
            : [],
          detectedAnswersPreview: Array.isArray(studentClosedAnswersDetected)
            ? studentClosedAnswersDetected.slice(0, 10)
            : [],
          totalDetectedAnswers: Array.isArray(studentClosedAnswersDetected)
            ? studentClosedAnswersDetected.length
            : 0,
        },
        saved,
        evaluation_id: evaluationId,
        status,
        save_error,
        ...(save_reason && { reason: save_reason }),
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("[Evaluate] Error:", error)
    let msg = error?.message || "Error procesando la evaluación"
    if (/503|502|429|upstream connect error|overflow/.test(msg)) {
      msg = "El servicio de IA no está disponible en este momento. Espera unos minutos e intenta de nuevo."
    }
    const isPdfError = typeof msg === "string" && msg.includes("PDF") && msg.includes("solo acepta imágenes")
    return NextResponse.json(
      {
        success: false,
        error: msg,
        officialOmrIntegrationEnabled: false,
        officialOmrEngineSelected: "legacy",
        officialOmrEngineUsed: "legacy",
        officialOmrFallbackUsed: false,
        officialOmrFallbackReason: null,
        teacherAnswersSource: "teacher_key",
        studentAnswersSource: "student_omr_read",
        teacherClosedAnswersCount: 0,
        studentClosedAnswersCount: 0,
      },
      { status: isPdfError ? 400 : 500 }
    )
  }
}
