/** Metadatos de tarjetas de acceso (home); iconos y estilos viven en el componente cliente. */
export type HomeAccessCardVariant = "docente" | "utp" | "direccion"

export type HomeAccessCardDef = {
  href: string
  emoji: string
  title: string
  subtitle: string
  description: string
  variant: HomeAccessCardVariant
}

export const HOME_ACCESS_CARDS: readonly HomeAccessCardDef[] = [
  {
    href: "/docente/estacion",
    emoji: "📸",
    title: "Estación de Escaneo",
    subtitle: "Sección Docente",
    description: "Captura y digitalización de pruebas en el aula o sala.",
    variant: "docente",
  },
  {
    href: "/dashboard/utp",
    emoji: "⚖️",
    title: "Auditoría de Lotes",
    subtitle: "Sección UTP",
    description: "Revisión, control y liberación de evaluaciones por lote.",
    variant: "utp",
  },
  {
    href: "/dashboard/direccion/trazabilidad",
    emoji: "📊",
    title: "Trazabilidad",
    subtitle: "Sección Dirección",
    description: "Visibilidad de resultados y trazabilidad curricular.",
    variant: "direccion",
  },
]
