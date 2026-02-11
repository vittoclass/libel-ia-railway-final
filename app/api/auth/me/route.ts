import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const cookie = cookieStore.get("session")?.value;

    if (!cookie) {
      return NextResponse.json({ ok: true, email: null });
    }

    const payload = await verifySessionToken(cookie);

    return NextResponse.json({ ok: true, email: payload.email });
  } catch {
    return NextResponse.json({ ok: true, email: null });
  }
}
