/**
 * POST /api/source-exams/[id]/items/extract-pdf-text
 * Extrae texto de un PDF subido. No inserta ítems; solo devuelve texto para previsualizar e importar después.
 * Valida teacher_id igual que el resto de rutas de ítems.
 */
import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"
import { extractTextFromPdf } from "@/app/lib/extract-text-from-pdf"

export const dynamic = "force-dynamic"

const MAX_PDF_BYTES = 10 * 1024 * 1024 // 10 MB

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

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: "Formato de petición inválido" }, { status: 400 })
  }
  const file = formData.get("file") ?? formData.get("pdf")
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Envíe un archivo PDF en el campo 'file' o 'pdf'" }, { status: 400 })
  }
  const name = typeof (file as File).name === "string" ? (file as File).name : ""
  const isPdfType = file.type === "application/pdf"
  const isPdfName = name.toLowerCase().endsWith(".pdf")
  if (!isPdfType && !isPdfName) {
    return NextResponse.json(
      { error: "El archivo debe ser PDF (application/pdf o extensión .pdf)" },
      { status: 400 }
    )
  }
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  if (process.env.NODE_ENV !== "production") {
    console.log("[extract-pdf-text] file received:", { name, size: buffer.length, type: file.type })
  }
  if (buffer.length > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `El PDF no puede superar ${MAX_PDF_BYTES / 1024 / 1024} MB` },
      { status: 400 }
    )
  }
  try {
    const result = await extractTextFromPdf(buffer)
    if (process.env.NODE_ENV !== "production") {
      console.log("[extract-pdf-text] extraction ok:", {
        textLength: result.text?.length ?? 0,
        pageCount: result.pageCount,
        hasWarning: !!result.warning,
      })
    }
    return NextResponse.json({
      text: result.text,
      pageCount: result.pageCount,
      warning: result.warning ?? undefined,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error("[extract-pdf-text] extraction failed:", message)
    return NextResponse.json(
      { error: "No se pudo extraer texto del PDF", details: message },
      { status: 422 }
    )
  }
}
