import type { NextApiRequest, NextApiResponse } from "next";

function normBase(raw: string) {
  const trimmed = (raw || "").trim();
  const normalized = trimmed.replace(/\/+$/, ""); // sin slash final
  return { trimmed, normalized };
}

function authHeader(): string {
  const token = Buffer.from(
    `${process.env.KHIPU_COLLECTOR_ID}:${process.env.KHIPU_SECRET}`
  ).toString("base64");
  return `Basic ${token}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { monto, glosa, txid } = req.body || {};
    if (!monto || Number.isNaN(Number(monto))) {
      return res.status(400).json({ error: "Monto invalido" });
    }

    const rawBase = process.env.KHIPU_BASE || "https://khipu.com/api/3.0";
    const { trimmed, normalized } = normBase(rawBase);
    const used_url = `${normalized}/payments`;

    const body = {
      subject: glosa || "Pago LibelIA",
      amount: Number(monto),
      currency: "CLP",
      transaction_id: txid || `orden-${Date.now()}`,
      return_url: process.env.PUBLIC_RETURN_URL,
      cancel_url: process.env.PUBLIC_CANCEL_URL,
      notify_url: process.env.PUBLIC_NOTIFY_URL
    };

    const r = await fetch(used_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Authorization": authHeader()
      },
      body: JSON.stringify(body)
    });

    const preview = await r.text(); // leemos texto SIEMPRE para poder mostrar diagnostico
    if (!r.ok) {
      return res.status(r.status).json({
        error: "Khipu devolvio error",
        status: r.status,
        used_url,
        khipu_base_env_raw: rawBase,
        khipu_base_env_trimmed: trimmed,
        response_preview: preview.slice(0, 500)
      });
    }

    // si fue OK, intentamos parsear el JSON y devolver solo lo util
    try {
      const json = JSON.parse(preview);
      return res.status(200).json({
        payment_url: json?.payment_url,
        payment_id: json?.payment_id,
        used_url
      });
    } catch {
      return res.status(200).json({ ok: true, used_url, raw: preview.slice(0, 500) });
    }
  } catch (e:any) {
    return res.status(500).json({ error: e?.message || "Error creando pago" });
  }
}