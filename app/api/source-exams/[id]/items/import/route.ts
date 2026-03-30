/**
 * POST /api/source-exams/[id]/items/import
 * Importación masiva de ítems: recibe texto con una línea por ítem y/o bloques de desarrollo.
 * Formato: item_number | item_text | axis_label | skill_label | competence | difficulty
 * También detecta bloques de desarrollo (preguntas abiertas con rúbrica) en el texto.
 * Por defecto reemplaza todos los ítems de la prueba base antes de insertar (evita duplicados al reimportar).
 * Con `replace_items: false` solo añade filas (puede repetir item_number si ya existía). Valida por teacher_id.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { dedupeParsedLinesByItemNumber, parseBulkItemsText, type ParsedLine } from "@/app/lib/parse-bulk-items"
import { parseDevelopmentBlocksFromText } from "@/app/lib/parse-development-blocks"
import {
  normalizeImportedSourceExamItems,
  type CanonicalImportTrace,
} from "@/app/lib/normalize-imported-source-exam-items"

export const dynamic = "force-dynamic"

const MAX_LINES = 500
/** Tipos persistibles; en modo editor no se reinterpretan desde el texto. */
const ALLOWED_QUESTION_TYPES = new Set([
  "multiple_choice",
  "true_false",
  "short_answer",
  "essay",
  "completion",
])

function sanitizeIncomingParsedItems(rows: unknown[]): ParsedLine[] {
  const out: ParsedLine[] = []
  for (const row of rows) {
    const r = row as Record<string, unknown>
    const num = Number(r?.item_number)
    const item_number = Number.isFinite(num) && num >= 1 ? Math.floor(num) : NaN
    const item_text = typeof r?.item_text === "string" ? r.item_text.trim() : ""
    if (!Number.isFinite(item_number) || item_number < 1 || !item_text) continue

    const rawType = typeof r?.question_type === "string" ? r.question_type.trim().toLowerCase() : ""
    const question_type = ALLOWED_QUESTION_TYPES.has(rawType) ? rawType : null
    const rawCorr = typeof r?.correct_answer === "string" ? r.correct_answer.trim().toUpperCase() : ""
    const correct_answer = /^[A-EVF]$/.test(rawCorr) ? rawCorr : null
    const maxN = Number(r?.max_score)
    const max_score = Number.isFinite(maxN) && maxN >= 0 ? Math.floor(maxN) : null

    out.push({
      item_number,
      item_text,
      axis_label: typeof r?.axis_label === "string" ? r.axis_label.trim() || null : null,
      skill_label: typeof r?.skill_label === "string" ? r.skill_label.trim() || null : null,
      competence: typeof r?.competence === "string" ? r.competence.trim() || null : null,
      difficulty: typeof r?.difficulty === "string" ? r.difficulty.trim() || null : null,
      question_type,
      correct_answer,
      max_score,
      rubric_text: typeof r?.rubric_text === "string" ? r.rubric_text.trim() || null : null,
    })
  }
  return out
}

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

  let body: {
    text?: string
    instrument_title?: string
    replace_items?: boolean
    parsed_items?: unknown[]
    /** Si true, el cliente confirma que `parsed_items` es la verdad final (tabla editada). */
    editor_import_source?: boolean
  } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body JSON inválido" }, { status: 400 })
  }
  const replaceItems = body.replace_items !== false
  const text = typeof body.text === "string" ? body.text : ""
  const instrumentTitleRaw = typeof body.instrument_title === "string" ? body.instrument_title.trim() : ""
  const instrumentTitle = instrumentTitleRaw.slice(0, 500)

  let titleUpdated = false
  let titleError: string | null = null
  if (instrumentTitle.length > 0) {
    const { error: titleErr } = await supabase
      .from("source_exams")
      .update({ title: instrumentTitle })
      .eq("id", sourceExamId)
    if (titleErr) titleError = titleErr.message
    else titleUpdated = true
  }

  const bulk = parseBulkItemsText(text)
  const dev = parseDevelopmentBlocksFromText(text)
  // `parsed_items` solo debe enviarse tras Previsualizar en el diálogo: es la lista final del editor.
  // No fusionar con parse del texto ni pasar por normalizeImportedSourceExamItems (ese paso re-infiere
  // tipos desde A/B/C, recorta enunciados, etc. y pisa decisiones manuales).
  const parsedItemsPayload = body.parsed_items
  const hasParsedItemsPayload = Array.isArray(parsedItemsPayload)
  const editedRows = hasParsedItemsPayload ? sanitizeIncomingParsedItems(parsedItemsPayload) : []
  const validRaw = hasParsedItemsPayload
    ? dedupeParsedLinesByItemNumber(editedRows)
    : dedupeParsedLinesByItemNumber([...bulk.valid, ...dev.items])
  const canonicalized = hasParsedItemsPayload
    ? { items: validRaw, trace: [] as CanonicalImportTrace[] }
    : normalizeImportedSourceExamItems(validRaw)
  const valid = canonicalized.items
  const consumedSet = new Set(dev.consumedLines.map((l: string) => l.trim()))
  const invalid = hasParsedItemsPayload
    ? []
    : bulk.invalid.filter((inv) => !consumedSet.has(inv.line.trim()))
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
  if (valid.length > 0 && replaceItems) {
    const { error: delErr } = await supabase.from("source_exam_items").delete().eq("source_exam_id", sourceExamId)
    if (delErr) {
      return NextResponse.json({ error: `No se pudieron eliminar ítems previos: ${delErr.message}` }, { status: 500 })
    }
  }

  if (valid.length === 0) {
    const errs = [
      ...invalid.map((i) => `Línea: "${i.line}" — ${i.reason}`),
      ...(titleError ? [`No se pudo guardar el título: ${titleError}`] : []),
    ]
    return NextResponse.json({
      total: valid.length + invalid.length,
      valid: 0,
      invalid: invalid.length,
      inserted: 0,
      title_updated: titleUpdated,
      errors: errs.length > 0 ? errs : undefined,
      message: titleUpdated
        ? "Se actualizó el título del instrumento. No hay líneas válidas para importar como ítems."
        : titleError && !titleUpdated
          ? "No hay líneas válidas para importar y el título no se pudo guardar."
          : "No hay líneas válidas para importar.",
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
  if (titleError) errors.push(`No se pudo guardar el título: ${titleError}`)
  invalid.forEach((i) => errors.push(`Inválida: "${i.line}" — ${i.reason}`))
  const traceSummary = {
    total_items: canonicalized.trace.length,
    closed_items: canonicalized.trace.filter((t) => t.canonical_question_type === "multiple_choice" || t.canonical_question_type === "true_false").length,
    development_items: canonicalized.trace.filter((t) => t.canonical_question_type === "essay" || t.canonical_question_type === "short_answer").length,
    with_options: canonicalized.trace.filter((t) => t.optionsDetected).length,
    with_correct_answer: canonicalized.trace.filter((t) => !!t.canonical_correct_answer).length,
    with_rubric: canonicalized.trace.filter((t) => t.rubricDetected).length,
  }

  return NextResponse.json({
    total: valid.length + invalid.length,
    valid: valid.length,
    invalid: invalid.length,
    inserted: insertErr ? 0 : insertedCount,
    title_updated: titleUpdated,
    import_translation_trace_summary: traceSummary,
    import_translation_trace_preview: canonicalized.trace.slice(0, 60),
    errors: errors.length > 0 ? errors : undefined,
    message: insertErr
      ? "Error al insertar; revise los errores."
      : `${replaceItems && insertedCount > 0 ? "Se reemplazaron los ítems anteriores. " : ""}Se importaron ${insertedCount} ítem(s).${titleUpdated ? " Título del instrumento actualizado." : ""}${invalid.length > 0 ? ` ${invalid.length} línea(s) inválida(s) no importadas.` : ""}`,
  }, { status: 200 })
}
