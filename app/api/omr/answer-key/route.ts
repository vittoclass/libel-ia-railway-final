// app/api/omr/answer-key/route.ts
// Extracción de plantilla del profesor (respuestas correctas) vía visión por IA (Mistral Pixtral).
// No se usa OpenCV en este endpoint: opencv-ts está en el proyecto pero no integrado aquí.
// Para mayor rigor se podría añadir preprocesamiento OpenCV (alineación, detección de grid/burbujas)
// o un servicio Python (p. ej. OMRChecker) que use OpenCV y devuelva JSON.
import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { setTemplate } from "@/app/lib/omrTemplateCache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY

async function inputToBase64(body: any): Promise<{ base64: string; mime: string }> {
  const { dataUrl, fileUrl, mimeType } = body || {}

  if (typeof dataUrl === "string" && dataUrl.startsWith("data:")) {
    const mime = dataUrl.match(/^data:(.*?);base64,/)?.[1] || mimeType || "image/jpeg"
    const base64 = dataUrl.replace(/^data:.*?;base64,/, "")
    return { base64, mime }
  }

  if (typeof fileUrl === "string" && /^https?:\/\//i.test(fileUrl)) {
    const r = await fetch(fileUrl)
    if (!r.ok) throw new Error(`No pude descargar fileUrl (${r.status})`)
    const buf = Buffer.from(await r.arrayBuffer())
    const mime = r.headers.get("content-type") || mimeType || "image/jpeg"
    return { base64: buf.toString("base64"), mime }
  }

  throw new Error("Debes enviar dataUrl (base64) o fileUrl (http/https)")
}

function buildPrompt(total: number, alts: string[], cols: number, tipoMarca: "X" | "burbuja"): string {
  const half = Math.ceil(total / 2)
  const marcaInstrucciones =
    tipoMarca === "burbuja"
      ? `- Cada respuesta correcta está marcada con un CÍRCULO o BURBUJA rellenado (pintado).
- En cada fila hay varias opciones (${alts.join(", ")}); solo UNA está rellenada. Esa es la respuesta correcta.
- Si hay dos marcadas, elige la más clara o deja vacío.`
      : `- Cada respuesta correcta está marcada con una X o tachado sobre la letra.
- En cada fila hay varias opciones (${alts.join(", ")}); solo UNA tiene la X. Esa letra es la respuesta correcta.
- La X puede ser grande o pequeña; busca qué letra está cruzada o marcada.`

  return `Eres un lector OMR. Tu tarea es leer la PLANTILLA DEL PROFESOR: una hoja donde el profesor marcó las RESPUESTAS CORRECTAS para cada pregunta.

IMPORTANTE: En esta hoja cada FILA es una pregunta. En cada fila el profesor marcó UNA sola letra (la respuesta correcta). Debes decir qué letra está marcada en cada fila.

ESTRUCTURA:
- La hoja tiene ${cols} columnas de preguntas.
- Preguntas 1 a ${half} en la primera columna (o mitad izquierda).
- Preguntas ${half + 1} a ${total} en la segunda columna (o mitad derecha).
- En cada fila verás: número de pregunta y las opciones ${alts.join(", ")}.
- En cada fila SOLO UNA opción está marcada. Esa es la respuesta correcta para esa pregunta.

TIPO DE MARCA: ${tipoMarca === "burbuja" ? "Burbuja/círculo rellenado" : "X o tachado sobre la letra"}
${marcaInstrucciones}

PASOS:
1. Recorre la columna izquierda de arriba a abajo: preguntas 1 a ${half}. Para cada fila, identifica qué letra (${alts.join(", ")}) está marcada. Anota esa letra.
2. Recorre la columna derecha de arriba a abajo: preguntas ${half + 1} a ${total}. Para cada fila, identifica qué letra está marcada.
3. El resultado debe tener EXACTAMENTE ${total} entradas, una por cada número de pregunta del 1 al ${total}.

RESPONDE SOLO CON ESTE JSON (nada más):
{"r":[{"p":1,"a":"A"},{"p":2,"a":"B"},{"p":3,"a":"C"},...,{"p":${total},"a":"?"}]}

Reglas:
- "p" = número de pregunta (1 a ${total}), sin saltar ninguna.
- "a" = la letra que está marcada en esa fila. Debe ser una de: ${alts.join(", ")}. Si no se ve marca clara, usa "".
- El array "r" debe tener exactamente ${total} elementos, en orden desde p=1 hasta p=${total}.`
}

async function callMistral(base64: string, prompt: string, mime: string): Promise<any> {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
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
          { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
          { type: "text", text: prompt },
        ],
      }],
      temperature: 0,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
  })

  if (!res.ok) throw new Error(`Mistral error: ${res.status}`)
  
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ""
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("No JSON en respuesta")
  return JSON.parse(match[0])
}

/** Parsea y normaliza la respuesta del modelo: p puede ser número o string, a se normaliza a una letra válida. */
function parseAndNormalizeResponses(
  rawResps: any[],
  total: number,
  alts: string[]
): Map<number, string> {
  const respMap = new Map<number, string>()
  for (const r of rawResps) {
    const num = typeof r?.p === "number" ? r.p : parseInt(String(r?.p || "0"), 10)
    if (num < 1 || num > total || respMap.has(num)) continue
    let ans = String(r?.a ?? "").trim().toUpperCase()
    if (ans.length > 1) ans = ans[0] // tomar solo primera letra si viene "A." o "A "
    if (alts.includes(ans)) {
      respMap.set(num, ans)
    } else if (ans) {
      // intentar mapear caracteres parecidos
      const normalized = alts.find((a) => a === ans || a === ans[0])
      respMap.set(num, normalized || "")
    } else {
      respMap.set(num, "")
    }
  }
  return respMap
}

export async function POST(req: NextRequest) {
  try {
    if (!MISTRAL_API_KEY) {
      return NextResponse.json({ success: false, error: "MISTRAL_API_KEY no configurada" }, { status: 500 })
    }

    const body = await req.json()
    const total = Number(body.totalPreguntas) || 38
    const cols = Number(body.columnas) || 2
    const tipoMarca = body.tipoMarca === "burbuja" ? "burbuja" : "X" // X o burbuja
    const alts = Array.isArray(body.alternativas)
      ? body.alternativas.map((a: string) => String(a).trim().toUpperCase())
      : String(body.alternativas || "A,B,C,D").split(",").map(a => a.trim().toUpperCase())

    const { base64, mime } = await inputToBase64(body)
    const prompt = buildPrompt(total, alts, cols, tipoMarca)

    // Primera llamada
    let result = await callMistral(base64, prompt, mime)
    let respMap = parseAndNormalizeResponses(Array.isArray(result?.r) ? result.r : [], total, alts)
    let filledFirst = 0
    respMap.forEach((v) => { if (v) filledFirst++ })

    // Segunda llamada para verificar: si la primera tiene muchas vacías, una segunda lectura puede mejorar
    try {
      const result2 = await callMistral(base64, prompt, mime)
      const respMap2 = parseAndNormalizeResponses(Array.isArray(result2?.r) ? result2.r : [], total, alts)
      let filledSecond = 0
      respMap2.forEach((v) => { if (v) filledSecond++ })
      // Usar el resultado que tenga más respuestas rellenadas; si empatan, usar el primero
      if (filledSecond > filledFirst) {
        respMap = respMap2
        result = result2
      }
    } catch (_) {
      // Si falla la segunda llamada, seguir con la primera
    }
    
    // Crear array final ordenado (1 a total)
    const respuestas = []
    for (let i = 1; i <= total; i++) {
      respuestas.push({
        pregunta: i,
        respuestaCorrecta: respMap.get(i) || "",
        confianza: respMap.has(i) && respMap.get(i) ? 0.9 : 0.3,
        metodo: "auto"
      })
    }

    // Memoria interna: guardar plantilla para contrastar con hojas de estudiantes
    const templateId = createHash("sha256").update(base64).digest("hex").slice(0, 24)
    await setTemplate(templateId, {
      respuestas,
      totalPreguntas: total,
      alternativas: alts,
      columnas: cols,
      tipoMarca,
      imageBase64: base64,
      mime,
      createdAt: Date.now(),
    })

    return NextResponse.json({
      success: true,
      respuestas,
      totalPreguntas: total,
      preguntasDudosas: respuestas.filter(r => !r.respuestaCorrecta).map(r => r.pregunta),
      tipoMarca,
      templateId,
      mensaje: "Plantilla del profesor escaneada. Estas respuestas son la referencia oficial (ley) para contrastar con las hojas de los estudiantes.",
    })

  } catch (error: any) {
    console.error("[OMR Answer-Key] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
