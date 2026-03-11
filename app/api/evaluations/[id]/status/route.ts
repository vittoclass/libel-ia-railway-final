import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/app/lib/supabase-route"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

const ALLOWED_STATUSES = ["draft", "published", "archived"] as const

/** PATCH /api/evaluations/[id]/status — Actualiza solo status. Solo el profesor dueño. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser()
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  const supabase = getSupabaseServer()
  if (!supabase) {
    return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })
  }

  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const statusBody = body.status
  if (!statusBody || !ALLOWED_STATUSES.includes(statusBody)) {
    return NextResponse.json(
      { error: "status debe ser draft, published o archived" },
      { status: 400 }
    )
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("user_id", user.id)
    .maybeSingle()

  const profileTeacherId = profile?.teacher_id ?? null

  const { data: evaluation, error: fetchErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, user_id")
    .eq("id", id)
    .single()

  if (fetchErr || !evaluation) {
    return NextResponse.json({ error: "No encontrada o sin permiso" }, { status: 404 })
  }

  const isOwnerByTeacher = profileTeacherId && (evaluation as { teacher_id?: string | null }).teacher_id === profileTeacherId
  const isOwnerByUser = (evaluation as { user_id?: string | null }).user_id === user.id
  if (!isOwnerByTeacher && !isOwnerByUser) {
    return NextResponse.json({ error: "No encontrada o sin permiso" }, { status: 404 })
  }

  // API usa "published", BD usa "final"
  const status = statusBody === "published" ? "final" : statusBody

  if (process.env.NODE_ENV !== "production") {
    console.log("[ARCHIVE] updating evaluation", id, "to status", status)
  }

  const { data: updated, error: updateErr } = await supabase
    .from("evaluations")
    .update({ status })
    .eq("id", id)
    .select()
    .single()

  if (updateErr) {
    return NextResponse.json(
      { step: "update_status", message: updateErr.message, details: updateErr.details ?? null },
      { status: 500 }
    )
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[ARCHIVE] result", updated?.id)
  }

  return NextResponse.json({ success: true, evaluation: updated })
}
