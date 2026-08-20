/**
 * Contrato mínimo CourseContext (S3 / S2.6).
 * contextId MVP = batchId. No clona prueba/rúbrica (GLOBAL).
 */

export const MAX_COURSE_CONTEXTS = 4

/**
 * Misma key singleton SCALE-R4. Duplicada a propósito para no importar useEvaluator
 * desde esta capa. Tests de integridad exigen igualdad con SELECTIVE_RETRY_COMPLETED_KEY.
 */
export const COURSE_CONTEXT_SCALE_KEY = "libelia_selective_retry_completed_v1"

export type CourseContextPreparedStatus = "DRAFT" | "READY"
export type CourseContextDisplayStatus = "DRAFT" | "READY" | "ACTIVE"

export type CourseContextFileLike = {
  id: string
  file: File
  previewUrl: string
  dataUrl: string
  mobileBatchPhotoId?: string
  fromMobileBatch?: boolean
  mobileBatchPageIndex?: number | null
  mobileBatchProcessedAt?: string | null
  batchScanStoragePath?: string | null
}

export type CourseContextGroupLike = {
  id: string
  studentName: string
  observedOcrName?: string | null
  studentRut?: string
  files: CourseContextFileLike[]
  decimasAdicionales: number
  isEvaluated: boolean
  isEvaluating: boolean
  error?: string
  evaluation_id?: string | null
  promotedEvaluationId?: string | null
  selectiveRetryAttemptId?: string | null
  selectiveRetryInputFingerprint?: string | null
  isValidationStep?: boolean
}

export type CourseContextSnapshot<
  TGroup extends CourseContextGroupLike = CourseContextGroupLike,
  TFile extends CourseContextFileLike = CourseContextFileLike,
> = {
  contextId: string
  courseValue: string
  imagesPerStudent: number
  studentGroups: TGroup[]
  unassignedFiles: TFile[]
  batchId: string
  attemptId: string
  scaleBlob: string | null
  instrumentFingerprint: string
  preparedStatus: CourseContextPreparedStatus
  captureMode: string | null
  classSize: number
}

export type CourseContextsState<
  TGroup extends CourseContextGroupLike = CourseContextGroupLike,
  TFile extends CourseContextFileLike = CourseContextFileLike,
> = {
  contexts: Array<CourseContextSnapshot<TGroup, TFile>>
  activeContextId: string | null
}

export type LiveWorkspace<
  TGroup extends CourseContextGroupLike = CourseContextGroupLike,
  TFile extends CourseContextFileLike = CourseContextFileLike,
> = {
  courseValue: string
  classSize: number
  imagesPerStudent: number
  studentGroups: TGroup[]
  unassignedFiles: TFile[]
  batchId: string
  attemptId: string
  captureMode: string | null
  instrumentFingerprint: string
}

export type ScaleKvStore = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export type InFlightGuards = {
  evaluatingGroupIdsCount: number
  anyGroupEvaluating: boolean
  evaluateAllGuard: boolean
  batchProgressActive: boolean
  isLoading: boolean
  isExtractingNames: boolean
  mobileBatchSyncing: boolean
  asyncJobActive: boolean
  switchInProgress: boolean
  restoring: boolean
}

export type SwitchBlockedReason =
  | "evaluate_individual"
  | "evaluate_all"
  | "group_evaluating"
  | "loading"
  | "extracting_names"
  | "ocr_or_upload"
  | "async_job"
  | "switch_in_progress"
  | null

export type CourseContextErrorCode =
  | "MAX_CONTEXTS"
  | "NOT_FOUND"
  | "SWITCH_BLOCKED"
  | "TARGET_INVALID"
  | "INSTRUMENT_MISMATCH"
  | "SCALE_RESTORE_FAILED"
  | "NO_ACTIVE"
  | "CANNOT_DELETE_ACTIVE"

export type CourseContextOpOk<
  TGroup extends CourseContextGroupLike = CourseContextGroupLike,
  TFile extends CourseContextFileLike = CourseContextFileLike,
> = {
  ok: true
  state: CourseContextsState<TGroup, TFile>
  activated?: CourseContextSnapshot<TGroup, TFile>
  message?: string
}

export type CourseContextOpFail<
  TGroup extends CourseContextGroupLike = CourseContextGroupLike,
  TFile extends CourseContextFileLike = CourseContextFileLike,
> = {
  ok: false
  code: CourseContextErrorCode
  error: string
  state: CourseContextsState<TGroup, TFile>
  blockedReason?: SwitchBlockedReason
}

export type CourseContextOpResult<
  TGroup extends CourseContextGroupLike = CourseContextGroupLike,
  TFile extends CourseContextFileLike = CourseContextFileLike,
> = CourseContextOpOk<TGroup, TFile> | CourseContextOpFail<TGroup, TFile>

export const MAX_CONTEXTS_MESSAGE =
  "Máximo 4 contextos de curso. Elimine o desconfirme uno para crear otro."
