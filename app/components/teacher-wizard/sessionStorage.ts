/**
 * Solo localStorage en cliente. Sin backend ni contratos de API.
 */
export const WIZARD_SESSION_STORAGE_KEY = "libel_teacher_wizard_session" as const

/** Misma pestaña: localStorage no dispara `storage`; usamos CustomEvent tras guardar. */
export const WIZARD_SESSION_CHANGED_EVENT = "libel-teacher-wizard-session-changed" as const

/** Alineado con el enum del formulario del evaluador (solo UI / localStorage). */
export type WizardSessionTipoPrueba = "mixta" | "solo_desarrollo" | "solo_alternativas"

export type TeacherWizardSessionDraft = {
  /** Curso final para el evaluador: nivel + letra (p. ej. 2 + A → 2A). */
  course: string
  /** Nivel o curso (campo de edición); opcional en JSON legado. */
  courseLevel?: string
  /** Letra de curso opcional. */
  courseLetter?: string
  testName: string
  teacherName: string
  departmentName?: string
  /** Asignatura / materia (equivale al campo `asignatura` del evaluador). */
  subjectName?: string
  tipoPrueba?: WizardSessionTipoPrueba
  studentCount: number
  imagesPerStudent: number
  savedAt: string
  /** Solo si el usuario eligió explícitamente una prueba base en el panel del wizard (referencia local). */
  sessionSourceExamId?: string
  sessionSourceExamTitle?: string | null
  /**
   * Porcentaje de exigencia (1–100). Se mapea al campo `porcentajeExigencia` del evaluador.
   * Ausente en JSON antiguo: no se fuerza valor al aplicar al evaluador.
   */
  exigencia?: number
  /**
   * Puntaje máximo de la prueba (entero ≥ 1). Se mapea al campo `puntajeTotal` del evaluador.
   * Ausente en JSON antiguo: no se fuerza valor al aplicar al evaluador.
   */
  puntajeTotal?: number
}

const TIPO_PRUEBA_VALUES: readonly WizardSessionTipoPrueba[] = [
  "mixta",
  "solo_desarrollo",
  "solo_alternativas",
] as const

function parseTipoPrueba(raw: unknown): WizardSessionTipoPrueba | undefined {
  if (typeof raw !== "string") return undefined
  const t = raw.trim() as WizardSessionTipoPrueba
  return TIPO_PRUEBA_VALUES.includes(t) ? t : undefined
}

function parseOptionalExigencia(raw: unknown): number | undefined {
  const n =
    typeof raw === "number"
      ? Math.round(raw)
      : typeof raw === "string" && /^[0-9]+$/.test(raw.trim())
        ? Number.parseInt(raw.trim(), 10)
        : Number.NaN
  if (!Number.isFinite(n) || n < 1 || n > 100) return undefined
  return n
}

function parseOptionalPuntajeTotalWizard(raw: unknown): number | undefined {
  const n =
    typeof raw === "number"
      ? Math.round(raw)
      : typeof raw === "string" && /^[0-9]+$/.test(raw.trim())
        ? Number.parseInt(raw.trim(), 10)
        : Number.NaN
  if (!Number.isFinite(n) || n < 1) return undefined
  return n
}

/** Construye el curso mostrado en el evaluador: con letra → nivel+letra; sin letra → solo nivel. */
export function buildWizardCourseFromParts(level: string, letter: string | undefined): string {
  const l = (level ?? "").trim()
  const t = (letter ?? "").trim()
  if (!l) return t
  if (!t) return l
  return `${l}${t}`
}

export function parseWizardSession(raw: string | null): TeacherWizardSessionDraft | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== "object") return null
    const o = v as Record<string, unknown>
    const courseLegacy = typeof o.course === "string" ? o.course : ""
    const courseLevelRaw = typeof o.courseLevel === "string" ? o.courseLevel : ""
    const courseLetterRaw = typeof o.courseLetter === "string" ? o.courseLetter : ""
    const courseLevel = courseLevelRaw.trim() ? courseLevelRaw : courseLegacy.trim() ? courseLegacy : ""
    const courseLetter = courseLetterRaw.trim() ? courseLetterRaw : undefined
    const courseFromParts = buildWizardCourseFromParts(courseLevel, courseLetter)
    const course = courseFromParts.trim() ? courseFromParts : courseLegacy.trim() ? courseLegacy : ""
    const testName = typeof o.testName === "string" ? o.testName : ""
    const teacherName = typeof o.teacherName === "string" ? o.teacherName : ""
    const departmentName = typeof o.departmentName === "string" ? o.departmentName : undefined
    const subjectFromKey =
      typeof o.subjectName === "string"
        ? o.subjectName
        : typeof o.asignatura === "string"
          ? o.asignatura
          : ""
    const subjectName = subjectFromKey.trim() ? subjectFromKey.trim() : undefined
    const tipoPrueba = parseTipoPrueba(o.tipoPrueba)
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
    const exigenciaRaw = o.exigencia ?? o.porcentajeExigencia ?? o.requirementPercent
    const exigencia = parseOptionalExigencia(exigenciaRaw)
    const puntajeTotalRaw = o.puntajeTotal ?? o.totalScore
    const puntajeTotal = parseOptionalPuntajeTotalWizard(puntajeTotalRaw)
    return {
      course,
      ...(courseLevel.trim() ? { courseLevel: courseLevel.trim() } : {}),
      ...(courseLetter ? { courseLetter } : {}),
      testName,
      teacherName,
      ...(typeof departmentName === "string" ? { departmentName } : {}),
      ...(subjectName ? { subjectName } : {}),
      ...(tipoPrueba ? { tipoPrueba } : {}),
      studentCount,
      imagesPerStudent,
      savedAt,
      ...(sessionSourceExamId ? { sessionSourceExamId, sessionSourceExamTitle: sessionSourceExamTitle ?? null } : {}),
      ...(exigencia != null ? { exigencia } : {}),
      ...(puntajeTotal != null ? { puntajeTotal } : {}),
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
  const level = (data.courseLevel ?? "").trim() || (data.course ?? "").trim()
  const letter = (data.courseLetter ?? "").trim() || undefined
  const courseComputed = buildWizardCourseFromParts(level, letter).trim() || (data.course ?? "").trim()
  const draft: TeacherWizardSessionDraft = {
    ...data,
    course: courseComputed,
    savedAt: new Date().toISOString(),
    tipoPrueba: data.tipoPrueba ?? "mixta",
  }
  if (level) draft.courseLevel = level
  else delete draft.courseLevel
  if (letter) draft.courseLetter = letter
  else delete draft.courseLetter
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

/** Configuración mínima para desbloquear QR/escaneo en la estación (solo cliente / localStorage). */
export function isWizardSessionConfigValid(d: TeacherWizardSessionDraft | null): boolean {
  if (!d?.savedAt) return false
  const curso =
    buildWizardCourseFromParts(d.courseLevel ?? d.course ?? "", d.courseLetter).trim() || d.course.trim()
  return (
    curso !== "" &&
    d.testName.trim() !== "" &&
    d.teacherName.trim() !== "" &&
    d.studentCount >= 1 &&
    d.imagesPerStudent >= 1
  )
}
