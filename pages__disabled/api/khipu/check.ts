import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const base = (process.env.KHIPU_BASE || "").trim();
  const notify = (process.env.PUBLIC_NOTIFY_URL || "").trim();
  const ret = (process.env.PUBLIC_RETURN_URL || "").trim();
  const cancel = (process.env.PUBLIC_CANCEL_URL || "").trim();

  const okScheme = notify.startsWith("https://");
  const okPath = /\/api\/khipu\/webhook$/.test(notify);

  res.status(200).json({
    KHIPU_BASE: base,
    PUBLIC_NOTIFY_URL: notify,
    PUBLIC_RETURN_URL: ret,
    PUBLIC_CANCEL_URL: cancel,
    checks: {
      notify_has_https: okScheme,
      notify_path_is_correct: okPath
    },
    tip: "PUBLIC_NOTIFY_URL debe ser https://mi-proyecto-railway-production.up.railway.app/api/khipu/webhook"
  });
}