// SIN "use client": este archivo es SERVER

import { Suspense } from "react";
import ClientPage from "./ClientPage";

// ✅ Configs válidas (solo aquí, en server)
export const dynamic = "force-dynamic";
export const revalidate = 0; // número (no función)

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <ClientPage />
    </Suspense>
  );
}
