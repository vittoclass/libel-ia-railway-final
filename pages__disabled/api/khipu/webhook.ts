import type { NextApiRequest, NextApiResponse } from "next";

function apiBase(): string {
  const raw = (process.env.KHIPU_BASE || "https://payment-api.khipu.com/v3").trim();
  return raw.replace(/\/+$/, "");
}
function apiKey(): string {
  const key = process.env.KHIPU_API_KEY || "";
  if (!key) throw new Error("Falta KHIPU_API_KEY");
  return key;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const paymentId = body?.payment_id || body?.id;
    if (!paymentId) {
      return res.status(400).json({ ok:false, error:"Falta payment_id en webhook" });
    }

    const url = `${apiBase()}/payments/${paymentId}`;
    const r = await fetch(url, { headers: { "x-api-key": apiKey(), "Accept": "application/json" } });
    const text = await r.text();
    if (!r.ok) return res.status(r.status).send(text);

    const pago = JSON.parse(text);
    if (pago?.status === "done") return res.status(200).json({ ok:true, status:"paid" });
    return res.status(200).json({ ok:false, status: pago?.status || "unknown" });
  } catch (e:any) {
    return res.status(500).json({ ok:false, error: e?.message || "Error en webhook" });
  }
}