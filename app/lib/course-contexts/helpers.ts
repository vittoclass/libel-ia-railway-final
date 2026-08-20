/**
 * Helpers puros de CourseContext (S3).
 * No tocan motores, SCALE-R4 selector, QR generation ni persistencia.
 */

import {
  COURSE_CONTEXT_SCALE_KEY,
  type CourseContextDisplayStatus,
  type CourseContextFileLike,
  type CourseContextGroupLike,
  type CourseContextPreparedStatus,
  type CourseContextSnapshot,
  type InFlightGuards,
  type LiveWorkspace,
  type ScaleKvStore,
  type SwitchBlockedReason,
} from "./types"

export function createEmptyCourseContextsState<
  TGroup extends CourseContextGroupLike = CourseContextGroupLike,
  TFile extends CourseContextFileLike = CourseContextFileLike,
>() {
  return { contexts: [] as Array<CourseContextSnapshot<TGroup, TFile>>, activeContextId: null as string | null }
}

export function buildInstrumentFingerprint(sourceExamId: string, tipoPrueba: string): string {
  return `${String(sourceExamId ?? "").trim()}|${String(tipoPrueba ?? "").trim()}`
}

export function displayContextStatus(
  preparedStatus: CourseContextPreparedStatus,
  contextId: string,
  activeContextId: string | null,
): CourseContextDisplayStatus {
  if (activeContextId && contextId === activeContextId) return "ACTIVE"
  return preparedStatus
}

export function countActiveIds(activeContextId: string | null): 0 | 1 {
  return activeContextId ? 1 : 0
}

export function isRosterLocked(preparedStatus: CourseContextPreparedStatus): boolean {
  return preparedStatus === "READY"
}

export function isInstrumentLocked(
  contexts: Array<{ preparedStatus: CourseContextPreparedStatus }>,
): boolean {
  return contexts.some((c) => c.preparedStatus === "READY")
}

export function shouldSkipClassSizeWorkspaceWipe(restoring: boolean): boolean {
  return restoring === true
}

export function applyClassSizeWorkspaceChange<TGroup, TFile>(opts: {
  restoring: boolean
  classSize: number
  prevGroups: TGroup[]
  prevUnassigned: TFile[]
  buildEmptyGroups: (count: number) => TGroup[]
}): { groups: TGroup[]; unassigned: TFile[]; wiped: boolean } {
  if (shouldSkipClassSizeWorkspaceWipe(opts.restoring)) {
    return { groups: opts.prevGroups, unassigned: opts.prevUnassigned, wiped: false }
  }
  const count = Math.max(1, opts.classSize)
  return { groups: opts.buildEmptyGroups(count), unassigned: [], wiped: true }
}

export function parkFilePreview<TFile extends CourseContextFileLike>(file: TFile): TFile {
  return { ...file, dataUrl: "" }
}

export function parkGroups<TGroup extends CourseContextGroupLike>(groups: TGroup[]): TGroup[] {
  return groups.map((g) => ({
    ...g,
    isEvaluating: false,
    files: g.files.map((f) => parkFilePreview(f)),
  }))
}

export function parkUnassigned<TFile extends CourseContextFileLike>(files: TFile[]): TFile[] {
  return files.map((f) => parkFilePreview(f))
}

export function snapshotFromLive<
  TGroup extends CourseContextGroupLike,
  TFile extends CourseContextFileLike,
>(
  live: LiveWorkspace<TGroup, TFile>,
  scaleBlob: string | null,
  preparedStatus: CourseContextPreparedStatus,
): CourseContextSnapshot<TGroup, TFile> {
  const batchId = String(live.batchId ?? "").trim()
  const groups = parkGroups(live.studentGroups)
  return {
    contextId: batchId,
    courseValue: String(live.courseValue ?? ""),
    imagesPerStudent: live.imagesPerStudent > 0 ? live.imagesPerStudent : 1,
    studentGroups: groups,
    unassignedFiles: parkUnassigned(live.unassignedFiles),
    batchId,
    attemptId: String(live.attemptId ?? ""),
    scaleBlob,
    instrumentFingerprint: live.instrumentFingerprint,
    preparedStatus,
    captureMode: live.captureMode,
    classSize: Math.max(1, groups.length || live.classSize || 1),
  }
}

export function isScaleBlobRestorable(blob: string | null | undefined): boolean {
  if (blob == null || blob === "") return true
  try {
    const parsed = JSON.parse(blob) as unknown
    return parsed != null && typeof parsed === "object"
  } catch {
    return false
  }
}

export function readScaleBlob(store: ScaleKvStore | null | undefined): string | null {
  if (!store) return null
  try {
    const raw = store.getItem(COURSE_CONTEXT_SCALE_KEY)
    return raw == null || raw === "" ? null : raw
  } catch {
    return null
  }
}

export function writeScaleBlob(store: ScaleKvStore | null | undefined, blob: string | null): boolean {
  if (!store) return false
  try {
    store.setItem(COURSE_CONTEXT_SCALE_KEY, blob ?? "")
    return true
  } catch {
    return false
  }
}

export function deriveCourseContextSwitchBlocked(
  g: InFlightGuards,
): { blocked: boolean; reason: SwitchBlockedReason } {
  if (g.switchInProgress || g.restoring) return { blocked: true, reason: "switch_in_progress" }
  if (g.evaluatingGroupIdsCount > 0) return { blocked: true, reason: "evaluate_individual" }
  if (g.anyGroupEvaluating) return { blocked: true, reason: "group_evaluating" }
  if (g.evaluateAllGuard || g.batchProgressActive) return { blocked: true, reason: "evaluate_all" }
  if (g.isLoading) return { blocked: true, reason: "loading" }
  if (g.isExtractingNames) return { blocked: true, reason: "extracting_names" }
  if (g.mobileBatchSyncing) return { blocked: true, reason: "ocr_or_upload" }
  if (g.asyncJobActive) return { blocked: true, reason: "async_job" }
  return { blocked: false, reason: null }
}

export function idleInFlightGuards(overrides?: Partial<InFlightGuards>): InFlightGuards {
  return {
    evaluatingGroupIdsCount: 0,
    anyGroupEvaluating: false,
    evaluateAllGuard: false,
    batchProgressActive: false,
    isLoading: false,
    isExtractingNames: false,
    mobileBatchSyncing: false,
    asyncJobActive: false,
    switchInProgress: false,
    restoring: false,
    ...overrides,
  }
}

/** Feature OFF o sin contexto activo: adoptar como hoy. Feature ON con ACTIVE: solo ese batch. */
export function shouldAdoptStorageActiveBatch(opts: {
  featureOn: boolean
  incomingBatchId: string
  activeBatchId: string | null
}): boolean {
  if (!opts.featureOn) return true
  const active = String(opts.activeBatchId ?? "").trim()
  if (!active) return true
  const incoming = String(opts.incomingBatchId ?? "").trim()
  return incoming.length > 0 && incoming === active
}

export function shouldMergeQrSyncForActiveBatch(
  incomingBatchId: string,
  activeBatchId: string | null,
): boolean {
  const incoming = String(incomingBatchId ?? "").trim()
  const active = String(activeBatchId ?? "").trim()
  return incoming.length > 0 && incoming === active
}

export function collectOwnedPreviewUrls(
  files: Array<{ previewUrl?: string }>,
): string[] {
  const out: string[] = []
  for (const f of files) {
    const u = typeof f.previewUrl === "string" ? f.previewUrl : ""
    if (u.startsWith("blob:")) out.push(u)
  }
  return out
}

export function collectContextPreviewUrls<
  TGroup extends CourseContextGroupLike,
  TFile extends CourseContextFileLike,
>(ctx: CourseContextSnapshot<TGroup, TFile>): string[] {
  const files = [...ctx.unassignedFiles, ...ctx.studentGroups.flatMap((g) => g.files)]
  return collectOwnedPreviewUrls(files)
}

export function revokeOwnedPreviewUrls(
  urls: string[],
  revoker: (url: string) => void = (u) => {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(u)
    }
  },
): void {
  for (const u of urls) {
    try {
      revoker(u)
    } catch {
      /* noop */
    }
  }
}

export function createEmptyStudentGroup(index: number, now = Date.now()): CourseContextGroupLike {
  return {
    id: `student-${now}-${index}`,
    studentName: `Alumno ${index + 1}`,
    studentRut: "",
    files: [],
    isEvaluated: false,
    isEvaluating: false,
    decimasAdicionales: 0,
  }
}

export function durableContextView<
  TGroup extends CourseContextGroupLike,
  TFile extends CourseContextFileLike,
>(ctx: CourseContextSnapshot<TGroup, TFile>) {
  return {
    contextId: ctx.contextId,
    courseValue: ctx.courseValue,
    imagesPerStudent: ctx.imagesPerStudent,
    batchId: ctx.batchId,
    attemptId: ctx.attemptId,
    scaleBlob: ctx.scaleBlob,
    instrumentFingerprint: ctx.instrumentFingerprint,
    preparedStatus: ctx.preparedStatus,
    captureMode: ctx.captureMode,
    classSize: ctx.classSize,
    unassigned: ctx.unassignedFiles.map((f) => durableFileView(f)),
    groups: ctx.studentGroups.map((g) => durableGroupView(g)),
  }
}

export function durableGroupView(g: CourseContextGroupLike) {
  return {
    id: g.id,
    studentName: g.studentName,
    observedOcrName: g.observedOcrName ?? null,
    studentRut: g.studentRut ?? "",
    isEvaluated: g.isEvaluated,
    isEvaluating: g.isEvaluating,
    error: g.error ?? undefined,
    evaluation_id: g.evaluation_id ?? null,
    promotedEvaluationId: g.promotedEvaluationId ?? null,
    selectiveRetryAttemptId: g.selectiveRetryAttemptId ?? null,
    selectiveRetryInputFingerprint: g.selectiveRetryInputFingerprint ?? null,
    isValidationStep: g.isValidationStep ?? false,
    files: g.files.map((f) => durableFileView(f)),
  }
}

export function durableFileView(f: CourseContextFileLike) {
  return {
    id: f.id,
    fileRef: f.file,
    name: f.file?.name,
    size: f.file?.size,
    lastModified: f.file?.lastModified,
    type: f.file?.type,
    dataUrl: f.dataUrl,
    previewUrl: f.previewUrl,
    mobileBatchPhotoId: f.mobileBatchPhotoId ?? null,
    fromMobileBatch: f.fromMobileBatch ?? false,
    mobileBatchPageIndex: f.mobileBatchPageIndex ?? null,
    mobileBatchProcessedAt: f.mobileBatchProcessedAt ?? null,
    batchScanStoragePath: f.batchScanStoragePath ?? null,
  }
}

export const SWITCH_BLOCKED_MESSAGES: Record<Exclude<SwitchBlockedReason, null>, string> = {
  evaluate_individual: "No se puede cambiar de curso mientras hay una evaluación individual en curso.",
  evaluate_all: "No se puede cambiar de curso mientras «Evaluar todo» está en curso.",
  group_evaluating: "No se puede cambiar de curso mientras un estudiante se está evaluando.",
  loading: "No se puede cambiar de curso mientras hay una carga crítica.",
  extracting_names: "No se puede cambiar de curso mientras se extraen nombres.",
  ocr_or_upload: "No se puede cambiar de curso mientras hay una subida o sincronización crítica.",
  async_job: "No se puede cambiar de curso mientras hay un trabajo asíncrono local activo.",
  switch_in_progress: "Ya hay un cambio de curso en curso.",
}
