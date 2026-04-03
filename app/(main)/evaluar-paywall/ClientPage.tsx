"use client";

import { Suspense } from "react";
// Importa aquí tu UI real (PaywallGuard, Evaluator, etc.)
// import PaywallView from "./PaywallView";

function Inner() {
  // Aquí va tu UI que usa useSearchParams, etc.
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Evaluar (Paywall)</h1>
      <p className="opacity-80 text-sm">
        Vista cliente con soporte para useSearchParams dentro de Suspense.
      </p>
      {/* <PaywallView /> */}
    </div>
  );
}

export default function ClientPage() {
  // En cliente también mantenemos Suspense por seguridad
  return (
    <Suspense fallback={<div className="p-6">Cargando…</div>}>
      <Inner />
    </Suspense>
  );
}
