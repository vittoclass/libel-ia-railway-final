/**
 * Microservicio LEADTOOLS OMR para LibelIA.
 * POST /read-omr — contrato: imageBase64, templateId, numQuestions, optionLabels.
 * Con LEADTOOLS_MOCK=true devuelve respuestas válidas para probar LibelIA end-to-end.
 */
import express from "express"
import type { ReadOmrRequest } from "./contract"
import { handleReadOmr } from "./read-omr"

const app = express()
const PORT = Number(process.env.PORT) || 5000

app.use(express.json({ limit: "20mb" }))

app.post("/read-omr", (req, res) => {
  console.log("[LEADTOOLS_SERVICE] request recibida")
  const body = req.body as ReadOmrRequest
  const numQuestions = Math.max(1, Math.min(200, Number(body?.numQuestions) || 40))
  const optionLabels = Array.isArray(body?.optionLabels) ? body.optionLabels : ["A", "B", "C", "D"]

  if (!body?.imageBase64 || typeof body.imageBase64 !== "string") {
    console.error("[LEADTOOLS_SERVICE] error: falta imageBase64")
    res.status(400).json({ success: false, error: "Falta imageBase64 en el cuerpo de la petición." })
    return
  }

  const payload: ReadOmrRequest = {
    imageBase64: body.imageBase64,
    templateId: typeof body.templateId === "string" ? body.templateId : "default",
    numQuestions,
    optionLabels,
  }

  try {
    const result = handleReadOmr(payload)
    if (result.success) {
      console.log("[LEADTOOLS_SERVICE] resultados generados", { count: result.results.length })
      res.status(200).json(result)
    } else {
      console.error("[LEADTOOLS_SERVICE] error", result.error)
      res.status(502).json(result)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[LEADTOOLS_SERVICE] error", message)
    res.status(500).json({ success: false, error: message })
  }
})

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "leadtools-omr", mock: process.env.LEADTOOLS_MOCK === "true" })
})

app.listen(PORT, () => {
  console.log(`[LEADTOOLS_SERVICE] escuchando en http://localhost:${PORT} (LEADTOOLS_MOCK=${process.env.LEADTOOLS_MOCK ?? "false"})`)
})
