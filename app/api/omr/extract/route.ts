// app/api/omr/compare/route.ts
// Endpoint para COMPARAR respuestas del estudiante con la plantilla del profesor
// y calcular el puntaje automaticamente
import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface AnswerKeyItem {
  pregunta: number
  respuestaCorrecta: string
  confianza: number
  metodo: "sharp" | "mistral" | "manual"
}

interface StudentAnswer {
  pregunta: string | number
  respuesta: string
  confianza: number
}

interface ComparisonResult {
  success: boolean
  // Resultados por pregunta
  resultados: {
    pregunta: number
    respuestaCorrecta: string
    respuestaEstudiante: string
    esCorrecta: boolean
    confianzaLectura: number
  }[]
  // Resumen
  totalPreguntas: number
  correctas: number
  incorrectas: number
  sinResponder: number
  porcentaje: number
  // Nota calculada (escala 1.0 - 7.0 chilena)
  nota: number
  // Preguntas que necesitan revision manual
  requierenRevision: number[]
  warnings: string[]
}

// Calcular nota en escala chilena (1.0 a 7.0)
// Con 60% de exigencia por defecto
function calcularNota(correctas: number, total: number, exigencia: number = 0.6): number {
  if (total === 0) return 1.0
  
  const porcentaje = correctas / total
  const puntajeMinimo = total * exigencia // 60% para nota 4.0
  
  if (correctas >= puntajeMinimo) {
    // Sobre el minimo: escalar de 4.0 a 7.0
    const rango = total - puntajeMinimo
    const puntosExtras = correctas - puntajeMinimo
    const nota = 4.0 + (puntosExtras / rango) * 3.0
    return Math.min(7.0, Math.round(nota * 10) / 10)
  } else {
    // Bajo el minimo: escalar de 1.0 a 4.0
    const nota = 1.0 + (correctas / puntajeMinimo) * 3.0
    return Math.max(1.0, Math.round(nota * 10) / 10)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      answerKey,           // Plantilla del profesor: AnswerKeyItem[]
      studentAnswers,      // Respuestas del estudiante: StudentAnswer[]
      exigencia = 0.6,     // Porcentaje de exigencia para nota 4.0
    } = body

    if (!answerKey || !Array.isArray(answerKey) || answerKey.length === 0) {
      return NextResponse.json(
        { success: false, error: "Debes proporcionar la plantilla del profesor (answerKey)" },
        { status: 400 }
      )
    }

    if (!studentAnswers || !Array.isArray(studentAnswers) || studentAnswers.length === 0) {
      return NextResponse.json(
        { success: false, error: "Debes proporcionar las respuestas del estudiante (studentAnswers)" },
        { status: 400 }
      )
    }

    const warnings: string[] = []
    const requierenRevision: number[] = []

    // Crear mapa de respuestas del profesor
    const profesorMap = new Map<number, string>()
    for (const item of answerKey) {
      const num = Number(item.pregunta)
      if (Number.isFinite(num)) {
        profesorMap.set(num, String(item.respuestaCorrecta).toUpperCase())
      }
    }

    // Crear mapa de respuestas del estudiante
    const estudianteMap = new Map<number, { respuesta: string; confianza: number }>()
    for (const item of studentAnswers) {
      const num = Number(item.pregunta)
      if (Number.isFinite(num)) {
        estudianteMap.set(num, {
          respuesta: String(item.respuesta).toUpperCase(),
          confianza: Number(item.confianza) || 0
        })
      }
    }

    // Comparar
    const resultados: ComparisonResult["resultados"] = []
    let correctas = 0
    let incorrectas = 0
    let sinResponder = 0

    const totalPreguntas = profesorMap.size

    for (let i = 1; i <= totalPreguntas; i++) {
      const respuestaCorrecta = profesorMap.get(i) || "SIN_PAUTA"
      const estudianteData = estudianteMap.get(i)
      const respuestaEstudiante = estudianteData?.respuesta || "SIN_RESPUESTA"
      const confianzaLectura = estudianteData?.confianza || 0

      // Determinar si es correcta
      let esCorrecta = false
      
      if (respuestaEstudiante === "SIN_RESPUESTA" || respuestaEstudiante === "") {
        sinResponder++
      } else if (respuestaEstudiante === "DOBLE_MARCA") {
        incorrectas++
        requierenRevision.push(i)
      } else if (respuestaCorrecta === "SIN_PAUTA") {
        // No tenemos la respuesta correcta - marcar para revision
        requierenRevision.push(i)
        warnings.push(`Pregunta ${i}: No hay respuesta correcta en la pauta.`)
      } else if (respuestaEstudiante === respuestaCorrecta) {
        esCorrecta = true
        correctas++
      } else {
        incorrectas++
      }

      // Si la confianza es baja, marcar para revision
      if (confianzaLectura < 0.85 && !requierenRevision.includes(i)) {
        requierenRevision.push(i)
      }

      resultados.push({
        pregunta: i,
        respuestaCorrecta,
        respuestaEstudiante,
        esCorrecta,
        confianzaLectura
      })
    }

    // Calcular porcentaje y nota
    const porcentaje = totalPreguntas > 0 ? Math.round((correctas / totalPreguntas) * 100) : 0
    const nota = calcularNota(correctas, totalPreguntas, exigencia)

    if (requierenRevision.length > 0) {
      warnings.push(`${requierenRevision.length} pregunta(s) requieren revision manual por baja confianza en la lectura.`)
    }

    const result: ComparisonResult = {
      success: true,
      resultados,
      totalPreguntas,
      correctas,
      incorrectas,
      sinResponder,
      porcentaje,
      nota,
      requierenRevision: requierenRevision.sort((a, b) => a - b),
      warnings
    }

    return NextResponse.json(result, { status: 200 })
  } catch (error: any) {
    console.error("[OMR Compare] Error:", error)
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Error comparando respuestas",
        resultados: [],
        totalPreguntas: 0,
        correctas: 0,
        incorrectas: 0,
        sinResponder: 0,
        porcentaje: 0,
        nota: 1.0,
        requierenRevision: [],
        warnings: []
      },
      { status: 500 }
    )
  }
}
