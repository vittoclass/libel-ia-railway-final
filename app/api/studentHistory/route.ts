import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET() {
  const supabase = getSupabase()
  if (!supabase) {
    return NextResponse.json({ error: "SUPABASE ENV MISSING" }, { status: 503 })
  }

  const { data, error } = await supabase.from("student_history").select("*")
  if (error) return NextResponse.json({ error }, { status: 500 })
  return NextResponse.json(data)
}
