// app/api/omr/closed-answer/route.ts
import { NextRequest, NextResponse } from "next/server"

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

function buildPrompt(total: number, alts: string[], cols: number): string {
  const half = Math.ceil(total / 2)
  
  return `TAREA: Leer hoja de respuestas de un estudiante (prueba tipo SIMCE/PSU chilena).

ESTRUCTURA:
- ${cols} columnas de preguntas
- COLUMNA IZQUIERDA: Preguntas 1 a ${half}
- COLUMNA DERECHA: Preguntas ${half + 1} a ${total}
- Cada fila: NUMERO | ${alts.join(" | ")}
- Respuestas marcadas con X grande

DATOS A EXTRAER:
1. NOMBRE del estudiante (campo "NOMBRE:" en la hoja)
2. CURSO del estudiante (campo "CURSO:" en la hoja)
3. TODAS las ${total} respuestas marcadas

COMO LEER:
- La X sobre una letra = respuesta seleccionada
- Lee columna izquierda (1 a ${half}), luego columna derecha (${half + 1} a ${total})
- NO DUPLIQUES preguntas
- Si no hay marca clara, deja "" vacio

RESPONDE SOLO CON ESTE JSON:
{"nombre":"nombre del estudiante","curso":"curso","r":[{"p":1,"a":"?"},{"p":2,"a":"?"},...,{"p":${total},"a":"?"}]}

Donde:
- "nombre" = nombre escrito en la hoja o null
- "curso" = curso escrito o null
- "p" = numero pregunta (1 a ${total})
- "a" = letra marcada (${alts.join(", ")}) o "" si no hay marca

CRITICO: Exactamente ${total} elementos en "r", uno por pregunta, SIN DUPLICADOS.`
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
      temperature: 0.05,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) throw new Error(`Mistral error: ${res.status}`)
  
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content || ""
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) throw new Error("No JSON en respuesta")
  return JSON.parse(match[0])
}

export async function POST(req: NextRequest) {
  try {
    if (!MISTRAL_API_KEY) {
      return NextResponse.json({ success: false, error: "MISTRAL_API_KEY no configurada" }, { status: 500 })
    }

    const body = await req.json()
    const total = Number(body.totalPreguntas) || 38
    const cols = Number(body.columnas) || 2
    const alts = String(body.opciones || "A,B,C,D").split(",").map(a => a.trim().toUpperCase())

    const { base64, mime } = await inputToBase64(body)
    const prompt = buildPrompt(total, alts, cols)
    const result = await callMistral(base64, prompt, mime)
    
    // Parsear sin duplicados
    const rawResps = Array.isArray(result?.r) ? result.r : []
    const respMap = new Map<number, string>()
    
    for (const r of rawResps) {
      const num = Number(r?.p)
      if (num >= 1 && num <= total && !respMap.has(num)) {
        const ans = String(r?.a || "").toUpperCase()
        respMap.set(num, alts.includes(ans) ? ans : "")
      }
    }
    
    // Array final ordenado
    const respuestas = []
    for (let i = 1; i <= total; i++) {
      const ans = respMap.get(i) || ""
      respuestas.push({
        pregunta: String(i),
        respuesta: ans || "SIN_RESPUESTA",
        confianza: ans ? 0.9 : 0.3,
      })
    }

    return NextResponse.json({
      success: true,
      respuestas,
      totalPreguntas: total,
      alumnoDetectado: result?.nombre || null,
      cursoDetectado: result?.curso || null,
      warnings: [],
    })

  } catch (error: any) {
    console.error("[OMR Closed-Answer] Error:", error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
