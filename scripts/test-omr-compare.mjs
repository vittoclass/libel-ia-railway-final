/**
 * Prueba controlada de /api/omr/compare.
 * Ejecutar con: node scripts/test-omr-compare.mjs
 * Requiere LibelIA corriendo (ej. npm run dev) en BASE_URL (por defecto http://localhost:3000).
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"

const answerKey5 = [
  { pregunta: 1, respuestaCorrecta: "A", confianza: 0.95, metodo: "manual" },
  { pregunta: 2, respuestaCorrecta: "B", confianza: 0.95, metodo: "manual" },
  { pregunta: 3, respuestaCorrecta: "C", confianza: 0.95, metodo: "manual" },
  { pregunta: 4, respuestaCorrecta: "D", confianza: 0.95, metodo: "manual" },
  { pregunta: 5, respuestaCorrecta: "A", confianza: 0.95, metodo: "manual" },
]

async function callCompare(answerKey, studentAnswers) {
  const res = await fetch(`${BASE_URL}/api/omr/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answerKey, studentAnswers, exigencia: 0.6 }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || res.statusText)
  return data
}

async function run() {
  console.log("=== Prueba controlada /api/omr/compare ===\n")
  console.log("BASE_URL:", BASE_URL)

  // Caso 1: estudiante igual a plantilla → 5 correctas, 0 incorrectas, 100%
  const studentAnswersCase1 = [
    { pregunta: 1, respuesta: "A", confianza: 0.95 },
    { pregunta: 2, respuesta: "B", confianza: 0.95 },
    { pregunta: 3, respuesta: "C", confianza: 0.95 },
    { pregunta: 4, respuesta: "D", confianza: 0.95 },
    { pregunta: 5, respuesta: "A", confianza: 0.95 },
  ]
  console.log("\n--- Caso 1: plantilla 1:A 2:B 3:C 4:D 5:A, estudiante igual ---")
  try {
    const result1 = await callCompare(answerKey5, studentAnswersCase1)
    const ok1 = result1.correctas === 5 && result1.incorrectas === 0 && result1.porcentaje === 100
    console.log("Resultado:", JSON.stringify({ correctas: result1.correctas, incorrectas: result1.incorrectas, porcentaje: result1.porcentaje, totalPreguntas: result1.totalPreguntas }))
    console.log("Esperado: correctas=5, incorrectas=0, porcentaje=100")
    console.log(ok1 ? "Caso 1: PASÓ" : "Caso 1: FALLÓ")
    if (!ok1) console.log("Resultados por pregunta:", result1.resultados)
  } catch (e) {
    console.log("Caso 1: Error", e.message)
  }

  // Caso 2: estudiante 1:A 2:C 3:C 4:D 5:B → 3 correctas, 2 incorrectas
  const studentAnswersCase2 = [
    { pregunta: 1, respuesta: "A", confianza: 0.95 },
    { pregunta: 2, respuesta: "C", confianza: 0.95 },
    { pregunta: 3, respuesta: "C", confianza: 0.95 },
    { pregunta: 4, respuesta: "D", confianza: 0.95 },
    { pregunta: 5, respuesta: "B", confianza: 0.95 },
  ]
  console.log("\n--- Caso 2: plantilla 1:A 2:B 3:C 4:D 5:A, estudiante 1:A 2:C 3:C 4:D 5:B ---")
  try {
    const result2 = await callCompare(answerKey5, studentAnswersCase2)
    const ok2 = result2.correctas === 3 && result2.incorrectas === 2
    console.log("Resultado:", JSON.stringify({ correctas: result2.correctas, incorrectas: result2.incorrectas, porcentaje: result2.porcentaje }))
    console.log("Esperado: correctas=3, incorrectas=2 (correctas: 1,3,4; incorrectas: 2,5)")
    console.log(ok2 ? "Caso 2: PASÓ" : "Caso 2: FALLÓ")
    if (!ok2) console.log("Resultados por pregunta:", result2.resultados)
  } catch (e) {
    console.log("Caso 2: Error", e.message)
  }

  console.log("\n=== Fin prueba ===")
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
