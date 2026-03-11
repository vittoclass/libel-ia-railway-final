/**
 * Store local de plantillas OMR LibelIA (solo frontend).
 * No toca backend ni APIs; persiste en localStorage.
 */

export interface OMRTemplate {
  templateId: string
  name: string
  numQuestions: number
  numOptions: number
  answerKey: { [question: number]: string }
  createdAt: number
  sheetSpec: "libelia_standard_v1" | "libelia_standard_v2"
  /** Plantilla Aspose .omr en base64 (generada automáticamente desde la hoja LibelIA). */
  asposeOmrBase64?: string
}

const STORAGE_KEY = "libelia_omr_templates_v1"

function safeParse(value: string | null): OMRTemplate[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (t) =>
          t &&
          typeof t.templateId === "string" &&
          typeof t.numQuestions === "number" &&
          typeof t.numOptions === "number" &&
          typeof t.answerKey === "object",
      ) as OMRTemplate[]
    }
    return []
  } catch {
    return []
  }
}

function loadAll(): OMRTemplate[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return safeParse(raw)
  } catch {
    return []
  }
}

function saveAll(templates: OMRTemplate[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates))
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.error("[OMRTemplateStore] Error al guardar en localStorage (quota o bloqueado)", e)
    }
  }
}

export function saveOMRTemplate(template: OMRTemplate): void {
  const existing = loadAll()
  const filtered = existing.filter((t) => t.templateId !== template.templateId)
  filtered.push(template)
  saveAll(filtered)
  if (process.env.NODE_ENV === "development") {
    console.log("[OMRTemplateStore] guardando plantilla", {
      templateId: template.templateId,
      hasAspose: !!template.asposeOmrBase64,
      asposeLength: template.asposeOmrBase64?.length ?? 0,
    })
  }
}

export function getOMRTemplate(templateId: string): OMRTemplate | null {
  const all = loadAll()
  return all.find((t) => t.templateId === templateId) || null
}

export function getAllOMRTemplates(): OMRTemplate[] {
  const all = loadAll().sort((a, b) => b.createdAt - a.createdAt)
  if (process.env.NODE_ENV === "development") {
    console.log("[OMRTemplateStore] Plantillas cargadas", {
      total: all.length,
      withAspose: all.filter((t) => !!t.asposeOmrBase64).length,
    })
    all.forEach((t) => {
      console.log("[OMRTemplateStore] plantilla cargada", {
        templateId: t.templateId,
        hasAspose: !!t.asposeOmrBase64,
        asposeLength: t.asposeOmrBase64?.length ?? 0,
      })
    })
  }
  return all
}

export function deleteOMRTemplate(templateId: string): void {
  const all = loadAll()
  const filtered = all.filter((t) => t.templateId !== templateId)
  saveAll(filtered)
}

