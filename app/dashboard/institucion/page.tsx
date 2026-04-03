import Link from "next/link"

export default function DashboardInstitucionPage() {
  return (
    <section className="space-y-5">
      <h2 className="text-xl font-semibold">Vista Institucional</h2>
      <p className="text-sm text-[var(--text-muted)]">
        Acceso central a monitoreo pedagógico y trazabilidad de acciones. Esta capa es aditiva y reversible.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-[var(--border-color)] bg-white p-4">
          <h3 className="font-semibold">Panel UTP</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Auditoría de acciones: quién corrige, cuándo y sobre qué alumno/curso.
          </p>
          <Link href="/dashboard/utp" className="inline-block mt-3 text-sm text-[var(--accent)] hover:underline">
            Abrir auditoría
          </Link>
        </article>
        <article className="rounded-xl border border-[var(--border-color)] bg-white p-4">
          <h3 className="font-semibold">Panel Dirección</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            KPI institucionales: logro promedio, volumen mensual y delta de mejora.
          </p>
          <Link href="/dashboard/direccion" className="inline-block mt-3 text-sm text-[var(--accent)] hover:underline">
            Abrir resumen ejecutivo
          </Link>
        </article>
      </div>
    </section>
  )
}
