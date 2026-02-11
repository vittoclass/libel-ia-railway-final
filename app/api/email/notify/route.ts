import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";
import {
  tplBienvenidaGratis,
  tplCompraOK,
  tplResultado,
} from "@/lib/email-templates";

type Body =
  | { type: "bienvenida-gratis"; to: string }
  | {
      type: "compra-ok";
      to: string;
      plan: string;
      creditos: number;
      facturaUrl?: string;
    }
  | {
      type: "resultado";
      to: string;
      titulo: string;
      nota?: string;
      enlacePDF?: string;
    };

export async function POST(req: Request) {
  try {
    // 🔒 BLINDAJE CRÍTICO (EVITA QUE CAIGA TODA LA APP)
    if (typeof sendEmail !== "function") {
      return NextResponse.json(
        { ok: false, error: "EMAIL NO CONFIGURADO" },
        { status: 503 }
      );
    }

    const body = (await req.json()) as Body;

    if (!("to" in body) || !body.to) {
      return NextResponse.json(
        { ok: false, error: "Falta 'to' (correo destino)" },
        { status: 400 }
      );
    }

    let subject = "";
    let html = "";

    if (body.type === "bienvenida-gratis") {
      subject = "Tu plan gratuito de LibelIA está activo";
      html = tplBienvenidaGratis({ email: body.to });
    } else if (body.type === "compra-ok") {
      subject = `Compra confirmada: ${body.plan}`;
      html = tplCompraOK({
        email: body.to,
        plan: body.plan,
        creditos: body.creditos,
        facturaUrl: body.facturaUrl,
      });
    } else if (body.type === "resultado") {
      subject = `Resultado disponible: ${body.titulo}`;
      html = tplResultado({
        email: body.to,
        titulo: body.titulo,
        nota: body.nota,
        enlacePDF: body.enlacePDF,
      });
    } else {
      return NextResponse.json(
        { ok: false, error: "Tipo de correo no soportado" },
        { status: 400 }
      );
    }

    const r = await sendEmail({
      to: body.to,
      subject,
      html,
    });

    return NextResponse.json(r);
  } catch (e: any) {
    console.error("Error en /api/email/notify:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Error inesperado" },
      { status: 500 }
    );
  }
}
