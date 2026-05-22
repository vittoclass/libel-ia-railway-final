/**
 * GET /api/evaluations/[id]/pedagogical-graph
 * Snapshot solo lectura del grafo pedagógico de una evaluación.
 * No modifica scoring, OMR, evaluate ni persistencia.
 */
import { NextRequest, NextResponse } from "next/server"
import { canReadEvaluationInAppScope, profileScopeFromRow } from "@/app/lib/evaluation-read-scope"
import { buildGraphSnapshot } from "@/app/lib/pedagogical-graph/buildGraphSnapshot"
import { getOrCreateProfile } from "@/app/lib/profile"
import { getSupabaseServer } from "@/app/lib/supabase-server"

export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: evaluationId } = await params
  if (!evaluationId) {
    return NextResponse.json({ error: "Falta id de evaluación" }, { status: 400 })
  }

  const { user } = await getOrCreateProfile()
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 })

  const supabase = getSupabaseServer()
  if (!supabase) return NextResponse.json({ error: "Supabase no configurado" }, { status: 503 })

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("teacher_id, school_id")
    .eq("user_id", user.id)
    .maybeSingle()
  const { teacher_id_used, school_id_used } = profileScopeFromRow(profileRow)

  const { data: evaluation, error: evErr } = await supabase
    .from("evaluations")
    .select("id, teacher_id, user_id, school_id")
    .eq("id", evaluationId)
    .maybeSingle()

  if (evErr || !evaluation) {
    return NextResponse.json({ error: "Evaluación no encontrada" }, { status: 404 })
  }

  const canRead = canReadEvaluationInAppScope({
    userId: user.id,
    evaluation: evaluation as { teacher_id?: string | null; user_id?: string | null; school_id?: string | null },
    teacher_id_used,
    school_id_used,
  })
  if (!canRead) {
    return NextResponse.json({ error: "No autorizado para esta evaluación" }, { status: 403 })
  }

  const built = await buildGraphSnapshot(supabase, evaluationId)
  if (!built.ok) {
    if (built.reason === "schema_error" && process.env.NODE_ENV === "development") {
      return NextResponse.json(
        { error: "schema_error", message: built.message, hint: "Columna o relación inexistente en PostgREST" },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Evaluación no encontrada" }, { status: 404 })
  }

  return NextResponse.json(built.snapshot)
}
