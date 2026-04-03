"use client";

import { useEffect, useMemo, useState } from "react";

// ===== Tipos =====
type Equiv = { cursos3imgs?: string; cursos4imgs?: string; cursos5imgs?: string };
type Plan = {
  id: string;
  nombre: string;
  precioCLP: number;     // decide pasarela: Khipu si id === "basic", Flow si es "intermediate" | "pro" | "flow400"
  creditos: number;      // 1 crédito = 1 imagen
  vigenciaDias: number;
  equivEvaluaciones?: Equiv;
  bullets?: string[];
  descripcion?: string;
  policy?: string;
};

// ===== PLANES FIJOS EN CLIENTE (no dependen del backend) =====
const CLIENT_PLANS: Plan[] = [
  {
    id: "free",
    nombre: "Plan Gratuito",
    precioCLP: 0,
    creditos: 10,          // <- aquí es 10 SIEMPRE (la UI)
    vigenciaDias: 30,
    equivEvaluaciones: {
      cursos3imgs: "Prueba: ~0,08 cursos (3 imágenes/est.)",
      cursos4imgs: "Prueba: ~0,06 cursos (4 imágenes/est.)",
      cursos5imgs: "Prueba: ~0,05 cursos (5 imágenes/est.)",
    },
    bullets: [
      "Calidad superior (Mistral Large + Azure Vision)",
      "1 crédito = 1 imagen evaluada",
      "Ideal para probar (sin tarjeta)",
      "⚠️ Si refrescas o cierras el link, no podrás recuperar la información",
    ],
    descripcion:
      "Plan de prueba para validar el flujo de evaluación con IA. Sube pocas imágenes y revisa resultados.",
    policy:
      "Al activar confirmas que aceptas las Condiciones de Uso. Importante: si se refresca o cierras el link, no se podrá recuperar la información.",
  },
  {
    id: "basic",           // Khipu
    nombre: "Plan Básico",
    precioCLP: 5000,
    creditos: 90,
    vigenciaDias: 30,
    equivEvaluaciones: {
      cursos3imgs: "≈ 0,75 cursos (3 imágenes/est.)",
      cursos4imgs: "≈ 0,56 cursos (4 imágenes/est.)",
      cursos5imgs: "≈ 0,45 cursos (5 imágenes/est.)",
    },
    bullets: [
      "Calidad superior (Mistral Large + Azure Vision)",
      "1 crédito = 1 imagen evaluada",
      "Ideal 5 imágenes por estudiante para mayor precisión",
      "⚠️ Si refrescas o cierras el link, no podrás recuperar la información",
    ],
    descripcion:
      "Plan de entrada para pruebas pequeñas. Para cursos completos, prefiere Intermedio o Pro.",
    policy:
      "Al comprar confirmas que aceptas las Condiciones de Uso. Créditos no transferibles. Sin almacenamiento permanente tras cerrar o refrescar.",
  },

  // === NUEVO PLAN DESTACADO (FLOW) ===
  {
    id: "flow400",         // Flow (link fijo)
    nombre: "Plan 400 créditos",
    precioCLP: 12990,      // IVA incluido
    creditos: 400,
    vigenciaDias: 60,
    equivEvaluaciones: {
      cursos3imgs: "≈ 3 cursos (3 imágenes/est.)",     // 400 / 120 ≈ 3,3
      cursos4imgs: "≈ 2 cursos (4 imágenes/est.)",     // 400 / 160 = 2,5 (2 completos + resto)
      cursos5imgs: "≈ 2 cursos (5 imágenes/est.)",     // 400 / 200 = 2
    },
    bullets: [
      "Mejor rendimiento precio/volumen",
      "1 crédito = 1 imagen evaluada",
      "Cubre 2–3 cursos reales según 3–5 imágenes/est.",
      "Ideal para colegios que parten",
    ],
    descripcion:
      "La opción recomendada por relación costo/beneficio. Permite evaluar varios cursos manteniendo calidad.",
    policy:
      "Al comprar confirmas que aceptas las Condiciones de Uso. Créditos no transferibles. Sin reembolsos parciales.",
  },

  {
    id: "intermediate",    // Flow
    nombre: "Plan Intermedio",
    precioCLP: 29990,      // <<< ACTUALIZADO
    creditos: 640,
    vigenciaDias: 60,
    equivEvaluaciones: {
      cursos3imgs: "≈ 5 cursos (3 imágenes/est.)",
      cursos4imgs: "≈ 4 cursos (4 imágenes/est.)",
      cursos5imgs: "≈ 3,2 cursos (5 imágenes/est.)",
    },
    bullets: [
      "Calidad superior (Mistral Large + Azure Vision)",
      "1 crédito = 1 imagen evaluada",
      "Ideal 5 imágenes por estudiante para mayor precisión",
      "Cobertura garantizada: ≥4 cursos usando 4 imágenes/est.",
      "⚠️ Si refrescas o cierras el link, no podrás recuperar la información",
    ],
    descripcion:
      "Equilibrio perfecto entre costo y cobertura. Cubre múltiples cursos con holgura incluso a 5 imágenes por estudiante.",
    policy:
      "Al comprar confirmas que aceptas las Condiciones de Uso. Créditos no transferibles. Sin reembolsos parciales. No se garantiza persistencia de datos al cerrar o refrescar el link.",
  },
  {
    id: "pro",             // Flow
    nombre: "Plan Pro",
    precioCLP: 49990,      // <<< ACTUALIZADO
    creditos: 1280,
    vigenciaDias: 90,
    equivEvaluaciones: {
      cursos3imgs: "≈ 10 cursos (3 imágenes/est.)",
      cursos4imgs: "≈ 8 cursos (4 imágenes/est.)",
      cursos5imgs: "≈ 6 cursos (5 imágenes/est.)",
    },
    bullets: [
      "Calidad superior (Mistral Large + Azure Vision)",
      "1 crédito = 1 imagen evaluada",
      "Ideal 5 imágenes por estudiante para mayor precisión",
      "Cobertura amplia para varios cursos y paralelos",
      "⚠️ Si refrescas o cierras el link, no podrás recuperar la información",
    ],
    descripcion:
      "Pensado para colegios e instituciones. Rinde muy bien incluso con evaluaciones de 5 páginas.",
    policy:
      "Al comprar confirmas que aceptas las Condiciones de Uso. Créditos no transferibles. Sin reembolsos parciales. No se garantiza persistencia de datos al cerrar o refrescar el link.",
  },
];

// ===== Utils =====
const isEmailValid = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default function PlanesPage() {
  // Estado correo/saldo/UI
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const emailOk = useMemo(() => isEmailValid(normalizedEmail), [normalizedEmail]);

  const [saldo, setSaldo] = useState<number | null>(null);
  const [loadingSaldo, setLoadingSaldo] = useState(false);

  const [msg, setMsg] = useState<{ type: "ok" | "error" | "info"; text: string } | null>(null);
  const [loadingFree, setLoadingFree] = useState(false);
  const [loadingBuy, setLoadingBuy] = useState<string | null>(null); // planId

  // Leer correo guardado
  useEffect(() => {
    try { const v = localStorage.getItem("userEmail"); if (v) setSavedEmail(v); } catch {}
  }, []);

  // Persistir correo válido
  useEffect(() => {
    if (emailOk) { try { localStorage.setItem("userEmail", normalizedEmail); } catch {} }
  }, [emailOk, normalizedEmail]);

  // Traer saldo
  const fetchSaldo = async () => {
    if (!emailOk) { setSaldo(null); return; }
    try {
      setLoadingSaldo(true);
      const r = await fetch("/api/credits/saldo?userEmail=" + encodeURIComponent(normalizedEmail), { cache: "no-store" });
      const data = await r.json();
      setSaldo(Number(data?.saldo ?? 0));
    } catch { setSaldo(null); }
    finally { setLoadingSaldo(false); }
  };
  useEffect(() => { fetchSaldo(); /* eslint-disable-next-line */ }, [emailOk, normalizedEmail]);

  // Acciones correo guardado
  const useSavedEmail = () => { if (savedEmail) { setEmail(savedEmail); setMsg(null); } };
  const clearSavedEmail = () => {
    try { localStorage.removeItem("userEmail"); } catch {}
    setSavedEmail(null);
    setEmail((prev) => (prev === savedEmail ? "" : prev));
    setSaldo(null);
    setMsg({ type: "info", text: "Correo borrado. Ingresa uno nuevo." });
  };

  // Activar plan gratuito (10)
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

  // Comprar: Khipu (basic) / Flow (intermediate, pro, flow400)
  const comprarPlan = async (plan: Plan) => {
    if (!emailOk) { setMsg({ type: "error", text: "Escribe un correo válido para comprar." }); return; }

    // aceptación obligatoria (pagados)
    if (plan.precioCLP > 0) {
      const accepted = (() => { try { return localStorage.getItem(`accept_${plan.id}`) === "1"; } catch { return false; } })();
      if (!accepted) { setMsg({ type: "error", text: "Debes aceptar las políticas antes de comprar." }); return; }
    }

    try {
      setLoadingBuy(plan.id);
      setMsg(null);
      try { localStorage.setItem("userEmail", normalizedEmail); } catch {}

      if (plan.id === "basic") {
        // KHIPU (YA FUNCIONA): deja tu flujo existente
        const resp = await fetch("/api/pagos/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userEmail: normalizedEmail, planId: plan.id, precioCLP: plan.precioCLP }),
        });

        let data: any = null, raw = "";
        try { data = await resp.clone().json(); } catch { try { raw = await resp.text(); } catch {} }

        if (!resp.ok) {
          const message = (data && (data.error || data.message)) || raw || `No se pudo iniciar el pago (HTTP ${resp.status}).`;
          setMsg({ type: "error", text: message });
          return;
        }

        const url = (data && (data.url || data.payment_url)) || null;
        if (!url) { setMsg({ type: "error", text: "La pasarela no devolvió URL de pago." }); return; }
        window.location.href = url;
        return;
      }

      // FLOW (LINKS FIJOS): abre el link del plan
      if (plan.id === "intermediate") {
        const link = process.env.NEXT_PUBLIC_FLOW_LINK_INTERMEDIO;
        if (!link) { setMsg({ type: "error", text: "Falta configurar el LINK del Plan Intermedio." }); return; }
        window.open(link, "_blank", "noopener,noreferrer");
        return;
      }

      if (plan.id === "pro") {
        const link = process.env.NEXT_PUBLIC_FLOW_LINK_PRO;
        if (!link) { setMsg({ type: "error", text: "Falta configurar el LINK del Plan Pro." }); return; }
        window.open(link, "_blank", "noopener,noreferrer");
        return;
      }

      if (plan.id === "flow400") {
        const link = process.env.NEXT_PUBLIC_FLOW_LINK_400;
        if (!link) { setMsg({ type: "error", text: "Falta configurar el LINK del Plan 400 créditos." }); return; }
        window.open(link, "_blank", "noopener,noreferrer");
        return;
      }

      setMsg({ type: "error", text: "Plan no reconocido." });
    } catch (e: any) {
      setMsg({ type: "error", text: e?.message || "Error inesperado al iniciar el pago." });
    } finally {
      setLoadingBuy(null);
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-5 py-10 space-y-8">
      {/* Barra correo guardado */}
      {savedEmail && !email && (
        <div className="rounded-xl border px-5 py-4 bg-gray-50 flex items-center justify-between gap-3">
          <div className="text-sm">Se encontró un correo guardado: <b>{savedEmail}</b></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={useSavedEmail} className="px-3 py-1.5 rounded bg-black text-white text-sm">Usar este correo</button>
            <button type="button" onClick={clearSavedEmail} className="px-3 py-1.5 rounded border text-sm">Cambiar</button>
          </div>
        </div>
      )}

      {/* Encabezado */}
      <header className="text-center space-y-3">
        <h1 className="text-3xl md:text-4xl font-bold">Elige tu plan</h1>
        <p className="text-base md:text-lg opacity-80">
          1 crédito = 1 imagen evaluada. Activa 10 créditos de prueba. Luego compra el plan que necesites.
        </p>
        <p className="text-xs opacity-60 mt-1">UI /planes v-29-08-02</p>
      </header>

      {/* Correo + Saldo */}
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

      {/* Mensajes */}
      {msg && (
        <div className={`max-w-xl mx-auto rounded-xl px-4 py-3 text-sm ${
          msg.type === "ok" ? "bg-green-50 text-green-700"
          : msg.type === "error" ? "bg-red-50 text-red-700"
          : "bg-yellow-50 text-yellow-800"
        }`}>{msg.text}</div>
      )}

      {/* Cards de Planes (fijos) */}
      <section className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {CLIENT_PLANS.map((p) => {
          const loading = loadingBuy === p.id || (p.precioCLP === 0 && loadingFree);
          const price = p.precioCLP > 0 ? `$ ${(p.precioCLP ?? 0).toLocaleString("es-CL")}` : "0 CLP";
          const subtitle = `${p.creditos} imágenes • ${p.vigenciaDias} días`;

          const destacado = p.id === "flow400"; // marcar el plan de mejor rendimiento

          return (
            <div
              key={p.id}
              className={`rounded-2xl p-6 flex flex-col gap-4 border ${
                p.id === "basic" ? "shadow-sm border-black/20" : ""
              } ${destacado ? "border-2 border-yellow-500 shadow-lg" : ""}`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{p.nombre}</h3>
                  {destacado && (
                    <span className="text-xxs md:text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-800 font-semibold">
                      ⭐ Mejor rendimiento
                    </span>
                  )}
                </div>
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

              {/* Aceptación obligatoria (pagados) */}
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
                } ${destacado ? "!border-yellow-500" : ""}`}
              >
                {loading ? (p.precioCLP === 0 ? "Activando…" : "Procesando…") : (p.precioCLP === 0 ? "Probar gratis" : "Comprar")}
              </button>
            </div>
          );
        })}
      </section>

      {/* Cómo funciona */}
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
