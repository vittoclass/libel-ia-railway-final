/**
 * POST /api/source-exams/[id]/items/import
 * Importación masiva de ítems: recibe texto con una línea por ítem y/o bloques de desarrollo.
 * Formato: item_number | item_text | axis_label | skill_label | competence | difficulty
 * También detecta bloques de desarrollo (preguntas abiertas con rúbrica) en el texto.
 * Solo añade ítems; no borra ni reemplaza existentes. Valida por teacher_id.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { parseBulkItemsText } from "@/app/lib/parse-bulk-items"
import { parseDevelopmentBlocksFromText } from "@/app/lib/parse-development-blocks"

export const dynamic = "force-dynamic"

const MAX_LINES = 500

async function checkSourceExamAccess(
  supabase: NonNullable<ReturnType<typeof getSupabaseServer>>,
  sourceExamId: string,
  user: { id: string }
) {
  const { data: sourceExam, error: fetchErr } = await supabase
    .from("source_exams")
    .select("id, teacher_id")
    .eq("id", sourceExamId)
    .maybeSingle()
  if (fetchErr || !sourceExam) return { ok: false as const, status: 404, error: "Prueba base no encontrada" }
  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()
  if (!profile?.teacher_id || (sourceExam as { teacher_id: string }).teacher_id !== profile.teacher_id) {
    return { ok: false as const, status: 403, error: "Sin permiso sobre esta prueba base" }
  }
  return { ok: true as const }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  const { id: sourceExamId } = await params
  if (!sourceExamId) return NextResponse.json({ error: "Falta id de prueba base" }, { status: 400 })

  const access = await checkSourceExamAccess(supabase, sourceExamId, user)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { text?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }
  const text = typeof body.text === "string" ? body.text : ""
  const bulk = parseBulkItemsText(text)
  const dev = parseDevelopmentBlocksFromText(text)
  const bulkFiltered = bulk.valid.filter(
    (p) => !dev.items.some((d) => p.item_text === `Pregunta ${d.item_number}`)
  )
  const valid = [...bulkFiltered, ...dev.items]
  const consumedSet = new Set(dev.consumedLines.map((l: string) => l.trim()))
  const invalid = bulk.invalid.filter((inv) => !consumedSet.has(inv.line.trim()))
  if (valid.length > MAX_LINES) {
    return NextResponse.json({
      error: `Máximo ${MAX_LINES} líneas por importación`,
      total: valid.length + invalid.length,
      valid: valid.length,
      invalid: invalid.length,
      inserted: 0,
      errors: [`Se excedió el límite de ${MAX_LINES} líneas válidas.`],
    }, { status: 400 })
  }
  if (valid.length === 0) {
    return NextResponse.json({
      total: valid.length + invalid.length,
      valid: 0,
      invalid: invalid.length,
      inserted: 0,
      errors: invalid.map((i) => `Línea: "${i.line}" — ${i.reason}`),
      message: "No hay líneas válidas para importar.",
    }, { status: 200 })
  }

  const rows = valid.map((p) => ({
    source_exam_id: sourceExamId,
    item_number: p.item_number,
    item_text: p.item_text,
    axis_id: null,
    skill_id: null,
    axis_label: p.axis_label || null,
    skill_label: p.skill_label || null,
    competence: p.competence || null,
    difficulty: p.difficulty || null,
    question_type: p.question_type || null,
    correct_answer: p.correct_answer || null,
    max_score: p.max_score ?? null,
    rubric_text: p.rubric_text || null,
  }))

  const { data: inserted, error: insertErr } = await supabase
    .from("source_exam_items")
    .insert(rows)
    .select("id")

  const insertedCount = inserted?.length ?? 0
  const errors: string[] = insertErr ? [insertErr.message] : []
  invalid.forEach((i) => errors.push(`Inválida: "${i.line}" — ${i.reason}`))

  return NextResponse.json({
    total: valid.length + invalid.length,
    valid: valid.length,
    invalid: invalid.length,
    inserted: insertErr ? 0 : insertedCount,
    errors: errors.length > 0 ? errors : undefined,
    message: insertErr
      ? "Error al insertar; revise los errores."
      : `Se importaron ${insertedCount} ítem(s).${invalid.length > 0 ? ` ${invalid.length} línea(s) inválida(s) no importadas.` : ""}`,
  }, { status: 200 })
}
