"use client";

import { useEffect, useMemo, useState } from "react";

// ===== Tipos =====
type Equiv = { cursos3imgs?: string; cursos4imgs?: string; cursos5imgs?: string; };
type Plan = {
  id: string;
  nombre: string;
  precioCLP: number;
  creditos: number;           // 1 crédito = 1 imagen
  vigenciaDias: number;
  equivEvaluaciones?: Equiv;
  bullets?: string[];
  descripcion?: string;
  policy?: string;
};

// ===== Fallback local (idéntico al API) =====
const FALLBACK_PLANS: Plan[] = [
  {
    id: "free",
    nombre: "Plan Gratuito",
    precioCLP: 0,
    creditos: 10,
    vigenciaDias: 30,
    equivEvaluaciones: {
      cursos3imgs: "Prueba: ~0,08 cursos (3 imágenes/est.)",
      cursos4imgs: "Prueba: ~0,06 cursos (4 imágenes/est.)",
      cursos5imgs: "Prueba: ~0,05 cursos (5 imágenes/est.)"
    },
    bullets: [
      "Calidad superior (Mistral Large + Azure Vision)",
      "1 crédito = 1 imagen evaluada",
      "Ideal para probar (sin tarjeta)",
      "⚠️ Si refrescas o cierras el link, no podrás recuperar la información"
    ],
    descripcion:
      "Plan de prueba para validar el flujo de evaluación con IA. Sube pocas imágenes y revisa resultados.",
    policy:
      "Al activar confirmas que aceptas las Condiciones de Uso. Importante: si se refresca o cierras el link, no se podrá recuperar la información."
  },
  {
    id: "basic",
    nombre: "Plan Básico",
    precioCLP: 5000,
    creditos: 90,
    vigenciaDias: 30,
    equivEvaluaciones: {
      cursos3imgs: "≈ 0,75 cursos (3 imágenes/est.)",
      cursos4imgs: "≈ 0,56 cursos (4 imágenes/est.)",
      cursos5imgs: "≈ 0,45 cursos (5 imágenes/est.)"
    },
    bullets: [
      "Calidad superior (Mistral Large + Azure Vision)",
      "1 crédito = 1 imagen evaluada",
      "Ideal 5 imágenes por estudiante para mayor precisión",
      "⚠️ Si refrescas o cierras el link, no podrás recuperar la información"
    ],
    descripcion:
      "Plan de entrada para pruebas pequeñas. Para cursos completos, prefiere Intermedio o Pro.",
    policy:
      "Al comprar confirmas que aceptas las Condiciones de Uso. Créditos no transferibles. Sin almacenamiento permanente tras cerrar o refrescar."
  },
  {
    id: "intermediate",
    nombre: "Plan Intermedio",
    precioCLP: 29900,
    creditos: 640,
    vigenciaDias: 60,
    equivEvaluaciones: {
      cursos3imgs: "≈ 5 cursos (3 imágenes/est.)",
      cursos4imgs: "≈ 4 cursos (4 imágenes/est.)",
      cursos5imgs: "≈ 3,2 cursos (5 imágenes/est.)"
    },
    bullets: [
      "Calidad superior (Mistral Large + Azure Vision)",
      "1 crédito = 1 imagen evaluada",
      "Ideal 5 imágenes por estudiante para mayor precisión",
      "Cobertura garantizada: al menos 4 cursos usando 4 imágenes/est.",
      "⚠️ Si refrescas o cierras el link, no podrás recuperar la información"
    ],
    descripcion:
      "Equilibrio perfecto entre costo y cobertura. Cubre múltiples cursos con holgura incluso a 5 imágenes por estudiante.",
    policy:
      "Al comprar confirmas que aceptas las Condiciones de Uso. Créditos no transferibles. Sin reembolsos parciales. No se garantiza persistencia de datos al cerrar o refrescar el link."
  },
  {
    id: "pro",
    nombre: "Plan Pro",
    precioCLP: 49900,
    creditos: 1280,
    vigenciaDias: 90,
    equivEvaluaciones: {
      cursos3imgs: "≈ 10 cursos (3 imágenes/est.)",
      cursos4imgs: "≈ 8 cursos (4 imágenes/est.)",
      cursos5imgs: "≈ 6 cursos (5 imágenes/est.)"
    },
    bullets: [
      "Calidad superior (Mistral Large + Azure Vision)",
      "1 crédito = 1 imagen evaluada",
      "Ideal 5 imágenes por estudiante para mayor precisión",
      "Cobertura amplia para varios cursos y paralelos",
      "⚠️ Si refrescas o cierras el link, no podrás recuperar la información"
    ],
    descripcion:
      "Pensado para colegios e instituciones. Rinde muy bien incluso con evaluaciones de 5 páginas.",
    policy:
      "Al comprar confirmas que aceptas las Condiciones de Uso. Créditos no transferibles. Sin reembolsos parciales. No se garantiza persistencia de datos al cerrar o refrescar el link."
  }
];

// ===== Utils =====
const isEmailValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Fusiona lo del API con fallback, garantizando campos completos
function mergeWithFallback(apiPlans: Plan[] | null | undefined): Plan[] {
  const byId = new Map<string, Plan>();
  FALLBACK_PLANS.forEach(p => byId.set(p.id, { ...p }));
  (apiPlans || []).forEach(srv => {
    const base = byId.get(srv.id) || ({} as Plan);
    byId.set(srv.id, {
      id: srv.id || base.id,
      nombre: srv.nombre || base.nombre,
      precioCLP: (typeof srv.precioCLP === "number" && srv.precioCLP >= 0) ? srv.precioCLP : base.precioCLP,
      creditos: (typeof srv.creditos === "number" && srv.creditos > 0) ? srv.creditos : base.creditos,
      vigenciaDias: (typeof srv.vigenciaDias === "number" && srv.vigenciaDias > 0) ? srv.vigenciaDias : base.vigenciaDias,
      equivEvaluaciones: (srv.equivEvaluaciones && typeof srv.equivEvaluaciones === "object")
        ? srv.equivEvaluaciones : base.equivEvaluaciones,
      bullets: (Array.isArray(srv.bullets) && srv.bullets.length > 0) ? srv.bullets : base.bullets,
      descripcion: srv.descripcion || base.descripcion,
      policy: srv.policy || base.policy
    });
  });
  return Array.from(byId.values()).sort((a, b) => (a.precioCLP ?? 0) - (b.precioCLP ?? 0));
}

export default function PlanesPage() {
  // correo / saldo / mensajes
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const emailOk = useMemo(() => isEmailValid(normalizedEmail), [normalizedEmail]);

  const [saldo, setSaldo] = useState<number | null>(null);
  const [loadingSaldo, setLoadingSaldo] = useState(false);

  const [msg, setMsg] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(null);

  // planes
  const [planes, setPlanes] = useState<Plan[]>(FALLBACK_PLANS); // arranca con fallback visible (así SIEMPRE se ve Intermedio)
  const [loadingPlanes, setLoadingPlanes] = useState(true);

  // acciones loading
  const [loadingFree, setLoadingFree] = useState(false);
  const [loadingBuy, setLoadingBuy] = useState<string | null>(null);

  // leer correo guardado
  useEffect(() => {
    try {
      const stored = localStorage.getItem("userEmail");
      if (stored) setSavedEmail(stored);
    } catch {}
  }, []);

  // persistir correo válido
  useEffect(() => {
    if (emailOk) { try { localStorage.setItem("userEmail", normalizedEmail); } catch {} }
  }, [emailOk, normalizedEmail]);

  // cargar planes (y fusionar con fallback)
  useEffect(() => {
    const run = async () => {
      try {
        const r = await fetch("/api/planes", { cache: "no-store" });
        let data: any = null; let raw = "[]";
        try { data = await r.clone().json(); } catch { raw = await r.text(); }
        const fromApi: Plan[] = Array.isArray(data) ? data : [];
        setPlanes(mergeWithFallback(fromApi));
      } catch {
        // si falla, mantenemos el fallback ya pintado
      } finally {
        setLoadingPlanes(false);
      }
    };
    run();
  }, []);

  // saldo
  const fetchSaldo = async () => {
    if (!emailOk) { setSaldo(null); return; }
    try {
      setLoadingSaldo(true);
      const r = await fetch("/api/credits/saldo?userEmail=" + encodeURIComponent(normalizedEmail), { cache: "no-store" });
      const data = await r.json();
      setSaldo(Number(data?.saldo ?? 0));
    } catch {
      setSaldo(null);
    } finally {
      setLoadingSaldo(false);
    }
  };
  useEffect(() => { fetchSaldo(); /* eslint-disable-next-line */ }, [emailOk, normalizedEmail]);

  const useSavedEmail = () => { if (savedEmail) { setEmail(savedEmail); setMsg(null); } };
  const clearSavedEmail = () => {
    try { localStorage.removeItem("userEmail"); } catch {}
    setSavedEmail(null);
    setEmail((prev) => (prev === savedEmail ? "" : prev));
    setSaldo(null);
    setMsg({ type: "info", text: "Correo borrado. Ingresa uno nuevo." });
  };

  // activar gratis
  const activarGratis = async () => {
    if (!emailOk) { setMsg({ type: "error", text: "Escribe un correo válido." }); return; }
    try {
      setLoadingFree(true);
      setMsg(null);
      const r = await fetch("/api/credits/gratis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userEmail: normalizedEmail }),
      });
      const data = await r.json();
      if (!r.ok || !data?.ok) {
        setMsg({ type: "error", text: data?.error || "No se pudo activar el plan gratuito." });
        return;
      }
      setMsg({
        type: "ok",
        text: data.creditsGranted > 0
          ? `¡Listo! Se activaron ${data.creditsGranted} créditos en ${normalizedEmail}.`
          : `Este correo ya había activado el plan gratuito.`,
      });
      setTimeout(() => { window.location.href = "/evaluar"; }, 600);
    } catch (e: any) {
      setMsg({ type: "error", text: e?.message || "Error inesperado." });
    } finally {
      setLoadingFree(false);
      fetchSaldo();
    }
  };

  // comprar (Khipu ≤ 5000 / Flow > 5000)
  const comprarPlan = async (plan: Plan) => {
    if (!emailOk) { setMsg({ type: "error", text: "Escribe un correo válido para comprar." }); return; }

    if (plan.precioCLP > 0) {
      const accepted = (() => { try { return localStorage.getItem(`accept_${plan.id}`) === "1"; } catch { return false; } })();
      if (!accepted) { setMsg({ type: "error", text: "Debes aceptar las políticas antes de comprar." }); return; }
    }

    try {
      setLoadingBuy(plan.id);
      setMsg(null);
      try { localStorage.setItem("userEmail", normalizedEmail); } catch {}

      const endpoint = plan.precioCLP <= 5000 ? "/api/pagos/create" : "/api/flow/create";
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userEmail: normalizedEmail, planId: plan.id, precioCLP: plan.precioCLP }),
      });

      let data: any = null, raw = "";
      try { data = await resp.clone().json(); } catch { try { raw = await resp.text(); } catch {} }

      if (!resp.ok) {
        console.error("Pago falló:", data || raw || { status: resp.status });
        const message = (data && (data.error || data.message)) || raw || `No se pudo iniciar el pago (HTTP ${resp.status}).`;
        setMsg({ type: "error", text: message });
        return;
      }

      const url = (data && (data.url || data.payment_url)) || null;
      if (!url) { setMsg({ type: "error", text: "La pasarela no devolvió URL de pago." }); return; }

      window.location.href = url;
    } catch (e: any) {
      setMsg({ type: "error", text: e?.message || "Error inesperado al iniciar el pago." });
    } finally {
      setLoadingBuy(null);
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-5 py-10 space-y-8">
      {/* barra correo guardado */}
      {savedEmail && !email && (
        <div className="rounded-xl border px-5 py-4 bg-gray-50 flex items-center justify-between gap-3">
          <div className="text-sm">Se encontró un correo guardado: <b>{savedEmail}</b></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={useSavedEmail} className="px-3 py-1.5 rounded bg-black text-white text-sm">Usar este correo</button>
            <button type="button" onClick={clearSavedEmail} className="px-3 py-1.5 rounded border text-sm">Cambiar</button>
          </div>
        </div>
      )}

      {/* encabezado */}
      <header className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-bold">Elige tu plan</h1>
        <p className="text-base md:text-lg opacity-80">
          1 crédito = 1 imagen evaluada. Activa 10 créditos de prueba. Luego compra el plan que necesites.
        </p>
      </header>

      {/* correo + saldo */}
      <section className="max-w-xl mx-auto w-full space-y-3">
        <label className="block text-sm font-medium">Tu correo</label>
        <input
          type="email"
          placeholder="ej: profesor@colegio.cl"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-black/30"
          autoComplete="email"
        />

        <div className="flex items-center justify-between text-sm">
          <span className="opacity-80">
            {emailOk
              ? (loadingSaldo ? "Consultando saldo…" : (saldo === null ? "Saldo: —" : <>Saldo: <b>{saldo}</b> crédito(s)</>))
              : "Escribe un correo válido para ver tu saldo"}
          </span>

          {emailOk && (saldo ?? 0) > 0 && (
            <a href="/evaluar" className="px-4 py-2 rounded-xl bg-black text-white" title="Usar tus créditos ahora">
              Ir a Evaluar
            </a>
          )}
        </div>
      </section>

      {/* mensajes */}
      {msg && (
        <div className={`max-w-xl mx-auto rounded-xl px-4 py-3 text-sm ${
          msg.type === "ok" ? "bg-green-50 text-green-700"
          : msg.type === "error" ? "bg-red-50 text-red-700"
          : "bg-yellow-50 text-yellow-800"
        }`}>
          {msg.text}
        </div>
      )}

      {/* cards */}
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {planes.map((p) => {
          const loading = loadingBuy === p.id || (p.precioCLP === 0 && loadingFree);
          const price = p.precioCLP > 0 ? `$ ${(p.precioCLP ?? 0).toLocaleString("es-CL")}` : "0 CLP";
          const subtitle = `${p.creditos} imágenes • ${p.vigenciaDias} días`;

          return (
            <div key={p.id} className={`rounded-2xl border p-6 flex flex-col gap-4 ${p.id === "basic" ? "shadow-sm border-black/20" : ""}`}>
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{p.nombre}</h3>
                <div className="text-3xl font-bold">{price}</div>
                <div className="text-sm opacity-70">{subtitle}</div>
              </div>

              {Array.isArray(p.bullets) && p.bullets.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {p.bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full bg-black/70" />
                      <span className="opacity-90">{b}</span>
                    </li>
                  ))}
                </ul>
              )}

              {(p.descripcion || p.policy || p.equivEvaluaciones) && (
                <details className="text-sm border rounded-lg p-3 bg-gray-50">
                  <summary className="cursor-pointer select-none">Detalles y políticas</summary>
                  {p.descripcion && <p className="mt-2 opacity-90">{p.descripcion}</p>}
                  {p.equivEvaluaciones && (
                    <ul className="mt-2 text-xs opacity-80 space-y-1">
                      {p.equivEvaluaciones.cursos3imgs && <li>• {p.equivEvaluaciones.cursos3imgs}</li>}
                      {p.equivEvaluaciones.cursos4imgs && <li>• {p.equivEvaluaciones.cursos4imgs}</li>}
                      {p.equivEvaluaciones.cursos5imgs && <li>• {p.equivEvaluaciones.cursos5imgs}</li>}
                    </ul>
                  )}
                  {p.policy && <p className="mt-2 text-xs font-medium text-red-700">⚠ {p.policy}</p>}
                </details>
              )}

              {/* aceptación obligatoria (pagados) */}
              {p.precioCLP > 0 && (
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    onChange={(e) => {
                      const k = `accept_${p.id}`;
                      try { localStorage.setItem(k, e.target.checked ? "1" : "0"); } catch {}
                    }}
                  />
                  <span>
                    Confirmo que leí y acepto las condiciones de uso y la advertencia de pérdida de información al refrescar/cerrar.
                  </span>
                </label>
              )}

              <button
                type="button"
                disabled={loading}
                onClick={() => (p.precioCLP === 0 ? activarGratis() : comprarPlan(p))}
                className={`mt-2 px-4 py-3 rounded-xl text-sm font-medium ${
                  p.id === "basic" ? "bg-black text-white" : "border hover:bg-black/5"
                }`}
              >
                {loading ? (p.precioCLP === 0 ? "Activando…" : "Procesando…") : (p.precioCLP === 0 ? "Probar gratis" : "Comprar")}
              </button>
            </div>
          );
        })}
      </section>

      {/* cómo funciona */}
      <section className="rounded-xl border px-5 py-4 text-sm bg-gray-50">
        <p className="font-medium mb-1">¿Cómo funciona?</p>
        <ul className="list-disc pl-5 space-y-1 opacity-80">
          <li>1 crédito = 1 imagen evaluada.</li>
          <li>Activa el plan gratuito (10 créditos) o compra un pack.</li>
          <li>Sube tus pruebas en <a className="underline" href="/evaluar">Evaluar</a>.</li>
          <li className="font-medium text-red-700">⚠ Si refrescas o cierras el link de la evaluación, la información no podrá recuperarse.</li>
        </ul>
      </section>
    </main>
  );
}
