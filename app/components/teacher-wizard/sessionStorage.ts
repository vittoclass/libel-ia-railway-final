/**
 * Solo localStorage en cliente. Sin backend ni contratos de API.
 */
export const WIZARD_SESSION_STORAGE_KEY = "libel_teacher_wizard_session" as const

/** Misma pestaña: localStorage no dispara `storage`; usamos CustomEvent tras guardar. */
export const WIZARD_SESSION_CHANGED_EVENT = "libel-teacher-wizard-session-changed" as const

export type TeacherWizardSessionDraft = {
  course: string
  testName: string
  teacherName: string
  studentCount: number
  imagesPerStudent: number
  savedAt: string
  /** Solo si el usuario eligió explícitamente una prueba base en el panel del wizard (referencia local). */
  sessionSourceExamId?: string
  sessionSourceExamTitle?: string | null
}

export function parseWizardSession(raw: string | null): TeacherWizardSessionDraft | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== "object") return null
    const o = v as Record<string, unknown>
    const course = typeof o.course === "string" ? o.course : ""
    const testName = typeof o.testName === "string" ? o.testName : ""
    const teacherName = typeof o.teacherName === "string" ? o.teacherName : ""
    const studentCount = typeof o.studentCount === "number" && Number.isFinite(o.studentCount) ? Math.max(0, Math.floor(o.studentCount)) : 0
    const imagesPerStudent =
      typeof o.imagesPerStudent === "number" && Number.isFinite(o.imagesPerStudent) ? Math.max(0, Math.floor(o.imagesPerStudent)) : 0
    const savedAt = typeof o.savedAt === "string" ? o.savedAt : ""
    const sessionSourceExamId =
      typeof o.sessionSourceExamId === "string" && o.sessionSourceExamId.trim() ? o.sessionSourceExamId.trim() : undefined
    const sessionSourceExamTitle =
      o.sessionSourceExamTitle === null
        ? null
        : typeof o.sessionSourceExamTitle === "string"
          ? o.sessionSourceExamTitle
          : undefined
    return {
      course,
      testName,
      teacherName,
      studentCount,
      imagesPerStudent,
      savedAt,
      ...(sessionSourceExamId ? { sessionSourceExamId, sessionSourceExamTitle: sessionSourceExamTitle ?? null } : {}),
    }
  } catch {
    return null
  }
}

export function readWizardSession(): TeacherWizardSessionDraft | null {
  if (typeof window === "undefined") return null
  return parseWizardSession(window.localStorage.getItem(WIZARD_SESSION_STORAGE_KEY))
}

export function writeWizardSession(data: Omit<TeacherWizardSessionDraft, "savedAt">): TeacherWizardSessionDraft {
  const draft: TeacherWizardSessionDraft = {
    ...data,
    savedAt: new Date().toISOString(),
  }
  window.localStorage.setItem(WIZARD_SESSION_STORAGE_KEY, JSON.stringify(draft))
  try {
    window.dispatchEvent(new CustomEvent(WIZARD_SESSION_CHANGED_EVENT))
  } catch {
    /* noop */
  }
  return draft
}

export function expectedImagesMeta(studentCount: number, imagesPerStudent: number): number {
  const s = Math.max(0, Math.floor(studentCount))
  const i = Math.max(0, Math.floor(imagesPerStudent))
  return s * i
}
