"use client"

/**
 * Informe directivo UTP para PDF (HTML). Sin metadatos de depuración en el lienzo.
 * id: utp-dashboard-pdf-capture-root
 */
import * as React from "react"
import { uiCoberturaTitulo, uiSemaforoTitulo } from "@/app/lib/pedagogic-ui-copy"

const CARD: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: 8,
  marginBottom: 8,
  boxSizing: "border-box",
  boxShadow: "0 2px 10px rgba(15, 23, 42, 0.07)",
}

const INNER: React.CSSProperties = {
  background: "#fafafa",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  padding: 8,
  boxSizing: "border-box",
}

/** Celdas semáforo: rojo / amarillo / verde */
const CELL_INSUF: React.CSSProperties = {
  ...INNER,
  background: "#fee2e2",
  border: "1px solid #dc2626",
  textAlign: "center",
}
const CELL_ELEM: React.CSSProperties = {
  ...INNER,
  background: "#fef9c3",
  border: "1px solid #ca8a04",
  textAlign: "center",
}
const CELL_ADEC: React.CSSProperties = {
  ...INNER,
  background: "#dcfce7",
  border: "1px solid #16a34a",
  textAlign: "center",
}

/** Logo: altura fija 60px, ancho automático; sin overflow:hidden que fragmente texto en PNG con html2canvas. */
const LOGO_IMG: React.CSSProperties = {
  display: "block",
  height: 60,
  width: "auto",
  maxWidth: 280,
  objectFit: "contain",
  objectPosition: "left center",
}

function PlaceholderLogo() {
  return (
    <div
      style={{
        flexShrink: 0,
        height: 60,
        width: 56,
        borderRadius: 8,
        background: "linear-gradient(145deg, #f1f5f9 0%, #e2e8f0 100%)",
        border: "1px solid #cbd5e1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-hidden
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M12 3L2 9v12h6v-7h8v7h6V9L12 3z"
          stroke="#64748b"
          strokeWidth="1.5"
          strokeLinejoin="round"
          fill="#f8fafc"
        />
      </svg>
    </div>
  )
}

export type UtpExecutivePdfCaptureProps = {
  institutionName: string
  reportDateLabel: string
  /** URL del logo (p. ej. mismo src que el header); vacío = placeholder */
  logoSrc: string | null
  omrLiveActive: boolean
  coberturaInstitucionalOmr: number | null
  semaforo: { insuficiente: number; elemental: number; adecuado: number; total: number }
  simceProyectadoOmr: number
  paesProyectadoOmr: number
  bySkill: Array<{ skill_name: string; subject: string | null; avg_logro_pct: number | null; student_result_rows: number }>
}

export const UtpExecutivePdfCapture = React.forwardRef<HTMLDivElement, UtpExecutivePdfCaptureProps>(
  function UtpExecutivePdfCapture(
    {
      institutionName,
      reportDateLabel,
      logoSrc,
      omrLiveActive,
      coberturaInstitucionalOmr,
      semaforo,
      simceProyectadoOmr,
      paesProyectadoOmr,
      bySkill,
    },
    ref,
  ) {
    const cobPct = coberturaInstitucionalOmr != null ? Math.round(coberturaInstitucionalOmr) : null
    const skills = bySkill.slice(0, 12)

    return (
      <div
        ref={ref}
        id="utp-dashboard-pdf-capture-root"
        className="bg-white text-slate-900"
        style={{
          width: 720,
          marginTop: 0,
          padding: "20px 10px 8px",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 11,
          lineHeight: 1.35,
          boxSizing: "border-box",
          background: "#ffffff",
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          position: "relative",
        }}
        aria-hidden
      >
        <div
          className="utp-pdf-ficha-header-shell"
          style={{
            width: "100%",
            maxWidth: "100%",
            boxSizing: "border-box",
            marginTop: 0,
            paddingTop: 0,
            paddingBottom: 6,
            marginBottom: 4,
            borderBottom: "2px solid #e2e8f0",
            flexShrink: 0,
            position: "relative",
            top: 0,
          }}
        >
          {/* Fila 1: logo + nombre del colegio (sin overflow:hidden para no recortar ascendentes en PDF) */}
          <div
            className="utp-print-header utp-pdf-header-row1"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
              width: "100%",
              maxWidth: "100%",
              minHeight: 60,
              marginTop: 0,
              flexWrap: "nowrap",
            }}
          >
            {logoSrc ? (
              <div style={{ flexShrink: 0, height: 60, lineHeight: 0, display: "flex", alignItems: "center" }}>
                <img
                  src={logoSrc}
                  alt=""
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  style={LOGO_IMG}
                />
              </div>
            ) : (
              <PlaceholderLogo />
            )}
            <div
              className="utp-pdf-institution-name"
              style={{
                flex: 1,
                minWidth: 0,
                textAlign: "right",
                fontSize: 17,
                fontWeight: 700,
                color: "#0f172a",
                lineHeight: 1.35,
                overflow: "visible",
                wordBreak: "break-word",
              }}
            >
              {institutionName || "Institución"}
            </div>
          </div>
          {/* Fila 2: título del informe y fecha; la línea gruesa separa este bloque de los indicadores */}
          <div
            className="utp-pdf-header-row2"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              width: "100%",
              marginTop: 8,
              paddingTop: 4,
              lineHeight: 1.4,
            }}
          >
            <span style={{ fontSize: 10, fontWeight: 600, color: "#475569" }}>Informe de gestión pedagógica</span>
            <span style={{ fontSize: 10, fontWeight: 500, color: "#64748b", whiteSpace: "nowrap" }}>{reportDateLabel}</span>
          </div>
          {omrLiveActive ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 8,
                color: "#166534",
                fontWeight: 600,
                background: "#f0fdf4",
                border: "1px solid #86efac",
                padding: "3px 6px",
                borderRadius: 4,
                display: "inline-block",
              }}
            >
              Indicadores sincronizados con evaluaciones institucionales
            </div>
          ) : null}
        </div>

        {/* Tarjeta: Semáforo y cobertura */}
        <div style={{ ...CARD, marginTop: 0, marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>{uiSemaforoTitulo()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={INNER}>
              <div style={{ fontSize: 8, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b", fontWeight: 600 }}>
                {uiCoberturaTitulo()}
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#047857", marginTop: 6, lineHeight: 1 }}>{cobPct != null ? `${cobPct}%` : "—"}</div>
              <div style={{ height: 8, background: "#e2e8f0", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(0, Math.min(100, coberturaInstitucionalOmr ?? 0))}%`,
                    background: "#059669",
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              <div style={CELL_INSUF}>
                <div style={{ fontSize: 9, color: "#991b1b", fontWeight: 700 }}>Insuficiente</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#7f1d1d", marginTop: 6 }}>{semaforo.insuficiente}</div>
              </div>
              <div style={CELL_ELEM}>
                <div style={{ fontSize: 9, color: "#854d0e", fontWeight: 700 }}>Elemental</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#713f12", marginTop: 6 }}>{semaforo.elemental}</div>
              </div>
              <div style={CELL_ADEC}>
                <div style={{ fontSize: 9, color: "#166534", fontWeight: 700 }}>Adecuado</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#14532d", marginTop: 6 }}>{semaforo.adecuado}</div>
              </div>
            </div>
            <div style={{ fontSize: 9, color: "#475569", fontWeight: 600 }}>Total categorías de desempeño: {semaforo.total}</div>
          </div>
        </div>

        {/* Tarjeta: Proyección */}
        <div style={{ ...CARD, marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>Proyección resultados nacionales</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{ ...INNER, background: "#ffffff", boxShadow: "inset 0 0 0 1px #e0f2fe" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#0c4a6e" }}>SIMCE proyectado</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#0369a1", marginTop: 6, lineHeight: 1 }}>{Math.round(simceProyectadoOmr)}</div>
              <div style={{ fontSize: 8, color: "#64748b", marginTop: 6 }}>Escala SIMCE (200-350)</div>
            </div>
            <div style={{ ...INNER, background: "#ffffff", boxShadow: "inset 0 0 0 1px #e0e7ff" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#312e81" }}>PAES proyectado</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#4338ca", marginTop: 6, lineHeight: 1 }}>{Math.round(paesProyectadoOmr)}</div>
              <div style={{ fontSize: 8, color: "#64748b", marginTop: 6 }}>Escala PAES (100-1000)</div>
            </div>
          </div>
        </div>

        {/* Tarjeta: Habilidades — data-pdf-skills-count para espera en export-utp-dashboard-pdf.ts */}
        <div style={{ ...CARD, marginBottom: 6 }} data-pdf-skills-count={skills.length}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>Logro por habilidad</div>
          {skills.length === 0 ? (
            <div
              style={{
                fontSize: 10,
                color: "#64748b",
                padding: 14,
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                textAlign: "center",
              }}
            >
              No hay datos de habilidad para incluir en este informe.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {skills.map((r, i) => {
                const pct = Math.round(Number(r.avg_logro_pct ?? 0))
                return (
                  <div key={`${r.skill_name}-${i}`} style={{ ...INNER, background: "#ffffff" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#1e293b", flex: 1 }}>{r.skill_name}</span>
                      <span style={{ fontSize: 11, fontWeight: 800, color: "#1e40af", whiteSpace: "nowrap" }}>{pct}%</span>
                    </div>
                    <div style={{ fontSize: 8, color: "#64748b", marginTop: 4 }}>
                      {r.subject ?? "—"} · n={r.student_result_rows}
                    </div>
                    <div style={{ height: 9, background: "#e2e8f0", borderRadius: 4, overflow: "hidden", marginTop: 8 }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.max(0, Math.min(100, pct))}%`,
                          background: "#0d9488",
                          borderRadius: 4,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    )
  },
)

UtpExecutivePdfCapture.displayName = "UtpExecutivePdfCapture"
