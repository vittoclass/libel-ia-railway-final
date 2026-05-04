/** Metadatos de tarjetas de acceso (home); iconos y estilos viven en el componente cliente. */
export type HomeAccessCardVariant = "docente" | "panel_docente" | "utp" | "direccion"

/** Igual que en rutas de dashboard: comparación en mayúsculas. */
export function normalizeProfileRoleForHome(role: string | null | undefined): string {
  return String(role ?? "").trim().toUpperCase()
}

type HomeRoleBucket = "TEACHER" | "UTP" | "DIRECCION"

/**
 * Agrupa el rol de `profiles.role` para decidir visibilidad en el home (solo UI).
 * Valores desconocidos se tratan como docente por defecto de la app (`docente` / `teacher`).
 */
export function homeRoleBucket(profileRole: string | null | undefined): HomeRoleBucket {
  const r = normalizeProfileRoleForHome(profileRole)
  if (r === "UTP") return "UTP"
  if (r === "DIRECCION") return "DIRECCION"
  return "TEACHER"
}

/**
 * Filtra tarjetas del home según rol. No reemplaza el control de acceso en cada ruta.
 * - Sin sesión: todas las tarjetas (home usable como hoy para visitantes).
 * - Master / admin API / ADMIN / ADMIN_INSTITUCION: todas.
 * - Docente (`docente`, `teacher`, u otros): estación + Mi Docencia.
 * - UTP: estación + UTP.
 * - Dirección: solo Trazabilidad.
 */
export function filterHomeAccessCards(params: {
  cards: readonly HomeAccessCardDef[]
  profileRole: string | null | undefined
  isMaster: boolean
  /** `GET /api/profile` → `isAdmin` (rol `admin` en minúsculas en API). */
  isAdminFromProfile: boolean
  hasSession: boolean
}): HomeAccessCardDef[] {
  const { cards, profileRole, isMaster, isAdminFromProfile, hasSession } = params
  if (!hasSession) return [...cards]
  if (isMaster) return [...cards]

  const r = normalizeProfileRoleForHome(profileRole)
  if (isAdminFromProfile || r === "ADMIN" || r === "ADMIN_INSTITUCION") return [...cards]

  const bucket = homeRoleBucket(profileRole)

  return cards.filter((c) => {
    switch (bucket) {
      case "TEACHER":
        return c.variant === "docente" || c.variant === "panel_docente"
      case "UTP":
        return c.variant === "docente" || c.variant === "utp"
      case "DIRECCION":
        return c.variant === "direccion"
      default:
        return false
    }
  })
}

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
    href: "/dashboard/docente",
    emoji: "📚",
    title: "Mi Docencia",
    subtitle: "Panel docente",
    description: "Revisa tus cursos, evaluaciones, estudiantes en riesgo e informes.",
    variant: "panel_docente",
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
