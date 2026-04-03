// app/presentacion/page.tsx
/* eslint-disable @next/next/no-img-element -- Logo como data URL SVG embebida. */
import Link from "next/link";
import { Metadata } from "next";
import { Button } from "@/components/ui/button";

// Si usas el mismo logo SVG que en EvaluatorClient, puedes copiar la constante.
// Para mantenerlo simple aquí, usa un <div> como placeholder o reemplaza por tu imagen.
const DRAGONFLY_SVG = `
<svg viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg" aria-label="Libel-IA logo">
  <defs>
    <linearGradient id="lg-a" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#7C3AED"/>
      <stop offset="50%" stop-color="#4F46E5"/>
      <stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
  </defs>
  <rect x="147" y="72" width="6" height="92" rx="3" fill="url(#lg-a)"/>
  <circle cx="150" cy="66" r="11" fill="url(#lg-a)"/>
  <path d="M30,80 C90,40 210,40 270,80 C210,92 90,92 30,80Z" fill="url(#lg-a)" opacity="0.25"/>
  <path d="M40,110 C100,90 200,90 260,110 C200,122 100,122 40,110Z" fill="url(#lg-a)" opacity="0.2"/>
  <rect x="149" y="166" width="2" height="14" rx="1" fill="#6366F1"/>
  <rect x="149" y="182" width="2" height="10" rx="1" fill="#22D3EE"/>
</svg>
`;
const DRAGONFLY_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(DRAGONFLY_SVG)}`;

export const metadata: Metadata = {
  title: "Presentación | Libel-IA",
  description: "Qué es Libel-IA y cómo usarla paso a paso",
};

const wordmarkClass =
  "text-transparent bg-clip-text bg-gradient-to-r from-violet-500 via-indigo-500 to-cyan-400";

export default function PresentacionPage() {
  return (
    <main className="p-4 md:p-8 max-w-5xl mx-auto">
      <section className="max-w-4xl mx-auto border rounded-xl shadow-lg p-8 md:p-12 bg-white">
        <div className="flex flex-col items-center text-center">
          <img
            src={DRAGONFLY_DATA_URL}
            alt="Logo Libel-IA"
            className="h-28 w-28 mb-4"
          />
          <h1 className={`text-5xl md:text-6xl font-bold ${wordmarkClass} font-logo`}>
            Libel-IA
          </h1>
          <p className="mt-3 text-base md:text-lg text-gray-600">
            “Evaluación con Inteligencia Docente: hecha por un profe, para profes”.
          </p>
        </div>

        <div className="mt-8 grid gap-6">
          <div className="rounded-lg border p-6">
            <h2 className="text-xl font-semibold">¿Qué hace Libel-IA?</h2>
            <p className="mt-2 text-gray-700">
              Analiza trabajos de estudiantes y genera retroalimentación pedagógica de alto nivel.
              Puedes evaluar <b>texto</b> (ensayos, respuestas abiertas),{" "}
              <b>imágenes</b> (pruebas escaneadas / fotografías) o <b>multimodal</b> (imagen + texto).
            </p>
            <ul className="mt-3 list-disc pl-5 text-gray-700">
              <li>Alternativas, V/F y desarrollo (con evidencias y justificación).</li>
              <li>Notas en escala chilena y puntaje total.</li>
              <li>Informe PDF listo para imprimir y enviar.</li>
              <li>Funciona para Lenguaje, Matemáticas, Ciencias, Artes, Humanidades e Inglés.</li>
            </ul>
          </div>

          <div className="rounded-lg border p-6">
            <h3 className="text-lg font-semibold">¿Qué IA utiliza?</h3>
            <p className="mt-2 text-gray-700">
              Usa un pipeline con <b>OCR de Azure Cognitive Services</b> para extraer texto de imágenes
              y un LLM (ej. <b>Mistral</b>) con un prompt pedagógico experto que:
            </p>
            <ul className="mt-3 list-disc pl-5 text-gray-700">
              <li>Observa evidencia concreta (citas o rasgos visuales).</li>
              <li>Conecta la evidencia con la rúbrica (justificación clara).</li>
              <li>Interpreta el nivel de logro con criterio docente.</li>
              <li>Entrega fortalezas y áreas de mejora accionables.</li>
            </ul>
          </div>

          <div className="rounded-lg border p-6">
            <h3 className="text-lg font-semibold">Cómo usarla (paso a paso)</h3>
            <ol className="mt-2 list-decimal pl-5 text-gray-700 space-y-2">
              <li>En “Evaluador”, indica curso y rúbrica (puedes pegar la pauta).</li>
              <li>Sube fotos/escaneos o usa la cámara integrada.</li>
              <li>Asigna páginas a cada estudiante y ejecuta “Evaluar todo”.</li>
              <li>Revisa resultados, ajusta décimas si necesitas y descarga el PDF.</li>
            </ol>
          </div>

          <div className="rounded-lg border p-6">
            <h3 className="text-lg font-semibold">Créditos y acceso</h3>
            <p className="mt-2 text-gray-700">
              Para proteger tus evaluaciones, <b>necesitas un correo verificado</b>. Cada imagen
              evaluada descuenta <b>1 crédito</b>. Si te quedas sin saldo, podrás activarlo en “Planes”.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 mt-2">
            <Link href="/evaluador">
              <Button size="lg" className="px-6 py-5">
                Ir al Evaluador
              </Button>
            </Link>
            <Link href="/planes" className="inline-flex">
              <Button variant="outline" size="lg" className="px-6 py-5">
                Activar créditos
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
