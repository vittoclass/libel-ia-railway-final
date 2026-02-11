import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createSessionToken } from "@/lib/session";

export async function POST(req: Request) {
  try {
    // 🔒 BLINDAJE CRÍTICO (EVITA CAÍDA DE APP COMPLETA)
    if (!supabaseAdmin) {
      return NextResponse.json(
        { ok: false, error: "SUPABASE NO CONFIGURADO" },
        { status: 503 }
      );
    }

    if (typeof createSessionToken !== "function") {
      return NextResponse.json(
        { ok: false, error: "SESSION NO CONFIGURADA" },
        { status: 503 }
      );
    }

    const { email, code } = await req.json();

    if (!email || !code) {
      return NextResponse.json(
        { ok: false, error: "Faltan email o code" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("auth_codes")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("code", code)
      .eq("used", false)
      .gt("expires_at", now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { ok: false, error: "Código inválido o vencido" },
        { status: 400 }
      );
    }

    await supabaseAdmin
      .from("auth_codes")
      .update({ used: true })
      .eq("id", data.id);

    const token = await createSessionToken({
      email: email.toLowerCase(),
    });

    const res = NextResponse.json({ ok: true });

    res.cookies.set("session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 días
    });

    return res;
  } catch (err: any) {
    console.error("auth/verify error", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Error" },
      { status: 500 }
    );
  }
}
