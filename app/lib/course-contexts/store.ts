/**
 * Store in-memory de hasta 4 CourseContexts / 1 ACTIVE.
 * Park/restore puro. Fail-soft: si el target es inválido, el estado current no se muta.
 */

import {
  MAX_COURSE_CONTEXTS,
  MAX_CONTEXTS_MESSAGE,
  type CourseContextErrorCode,
  type CourseContextFileLike,
  type CourseContextGroupLike,
  type CourseContextOpResult,
  type CourseContextsState,
  type CourseContextSnapshot,
  type InFlightGuards,
  type LiveWorkspace,
  type ScaleKvStore,
  type SwitchBlockedReason,
} from "./types"
import {
  createEmptyStudentGroup,
  deriveCourseContextSwitchBlocked,
  displayContextStatus,
  isScaleBlobRestorable,
  parkGroups,
  parkUnassigned,
  readScaleBlob,
  snapshotFromLive,
  SWITCH_BLOCKED_MESSAGES,
  writeScaleBlob,
} from "./helpers"

export { displayContextStatus }

function fail<TGroup extends CourseContextGroupLike, TFile extends CourseContextFileLike>(
  state: CourseContextsState<TGroup, TFile>,
  code: CourseContextErrorCode,
  error: string,
  blockedReason?: SwitchBlockedReason,
): CourseContextOpResult<TGroup, TFile> {
  return { ok: false, code, error, state, blockedReason }
}

export function findContext<TGroup extends CourseContextGroupLike, TFile extends CourseContextFileLike>(
  state: CourseContextsState<TGroup, TFile>,
  id: string,
): CourseContextSnapshot<TGroup, TFile> | undefined {
  return state.contexts.find((c) => c.contextId === id)
}

export function confirmContext<TGroup extends CourseContextGroupLike, TFile extends CourseContextFileLike>(
  state: CourseContextsState<TGroup, TFile>,
  contextId: string,
): CourseContextOpResult<TGroup, TFile> {
  const ctx = findContext(state, contextId)
  if (!ctx) return fail(state, "NOT_FOUND", "No existe el contexto a confirmar.")
  const next = {
    ...state,
    contexts: state.contexts.map((c) =>
      c.contextId === contextId ? { ...c, preparedStatus: "READY" as const } : c,
    ),
  }
  return { ok: true, state: next, activated: findContext(next, contextId) }
}

export function unconfirmContext<TGroup extends CourseContextGroupLike, TFile extends CourseContextFileLike>(
  state: CourseContextsState<TGroup, TFile>,
  contextId: string,
): CourseContextOpResult<TGroup, TFile> {
  const ctx = findContext(state, contextId)
  if (!ctx) return fail(state, "NOT_FOUND", "No existe el contexto a desconfirmar.")
  const next = {
    ...state,
    contexts: state.contexts.map((c) =>
      c.contextId === contextId ? { ...c, preparedStatus: "DRAFT" as const } : c,
    ),
  }
  return { ok: true, state: next, activated: findContext(next, contextId) }
}

export function createContext<TGroup extends CourseContextGroupLike, TFile extends CourseContextFileLike>(opts: {
  state: CourseContextsState<TGroup, TFile>
  live: LiveWorkspace<TGroup, TFile>
  scaleStore: ScaleKvStore | null | undefined
  newBatchId: string
  emptyGroupFactory?: (index: number) => TGroup
  inFlight: InFlightGuards
}): CourseContextOpResult<TGroup, TFile> {
  const { state, live, scaleStore, newBatchId, inFlight } = opts
  if (state.contexts.length >= MAX_COURSE_CONTEXTS) {
    return fail(state, "MAX_CONTEXTS", MAX_CONTEXTS_MESSAGE)
  }

  const blocked = deriveCourseContextSwitchBlocked(inFlight)
  if (blocked.blocked && state.contexts.length > 0) {
    return fail(
      state,
      "SWITCH_BLOCKED",
      SWITCH_BLOCKED_MESSAGES[blocked.reason!],
      blocked.reason,
    )
  }

  const currentScale = readScaleBlob(scaleStore)

  if (state.contexts.length === 0) {
    const batchId = String(live.batchId ?? "").trim() || newBatchId
    const firstLive: LiveWorkspace<TGroup, TFile> = { ...live, batchId }
    const first = snapshotFromLive(firstLive, currentScale, "DRAFT")
    return {
      ok: true,
      state: { contexts: [first], activeContextId: first.contextId },
      activated: first,
    }
  }

  const active = state.activeContextId ? findContext(state, state.activeContextId) : undefined
  const parkedCurrent = active
    ? snapshotFromLive(
        { ...live, batchId: active.batchId || live.batchId },
        currentScale,
        active.preparedStatus,
      )
    : null

  const factory = opts.emptyGroupFactory
  const emptyGroup = factory
    ? factory(0)
    : (createEmptyStudentGroup(0) as TGroup)
  const emptyGroups = parkGroups([emptyGroup])
  const created: CourseContextSnapshot<TGroup, TFile> = {
    contextId: newBatchId,
    courseValue: "",
    imagesPerStudent: 1,
    studentGroups: emptyGroups,
    unassignedFiles: [] as TFile[],
    batchId: newBatchId,
    attemptId: "",
    scaleBlob: null,
    instrumentFingerprint: live.instrumentFingerprint,
    preparedStatus: "DRAFT",
    captureMode: null,
    classSize: 1,
  }

  if (!writeScaleBlob(scaleStore, null)) {
    return fail(state, "SCALE_RESTORE_FAILED", "No se pudo preparar SCALE del nuevo contexto. Se mantiene el actual.")
  }

  const nextContexts = state.contexts.map((c) =>
    parkedCurrent && c.contextId === parkedCurrent.contextId ? parkedCurrent : c,
  )
  nextContexts.push(created)
  return {
    ok: true,
    state: { contexts: nextContexts, activeContextId: created.contextId },
    activated: created,
  }
}

export function executeSwitch<TGroup extends CourseContextGroupLike, TFile extends CourseContextFileLike>(opts: {
  state: CourseContextsState<TGroup, TFile>
  targetId: string
  live: LiveWorkspace<TGroup, TFile>
  scaleStore: ScaleKvStore | null | undefined
  inFlight: InFlightGuards
  globalInstrumentFingerprint: string
}): CourseContextOpResult<TGroup, TFile> {
  const { state, targetId, live, scaleStore, inFlight, globalInstrumentFingerprint } = opts
  const blocked = deriveCourseContextSwitchBlocked(inFlight)
  if (blocked.blocked) {
    return fail(state, "SWITCH_BLOCKED", SWITCH_BLOCKED_MESSAGES[blocked.reason!], blocked.reason)
  }

  const target = findContext(state, targetId)
  if (!target) return fail(state, "NOT_FOUND", "El curso destino no existe.")
  if (!target.batchId || !target.contextId) {
    return fail(state, "TARGET_INVALID", "El curso destino no tiene batchId válido.")
  }
  if (!isScaleBlobRestorable(target.scaleBlob)) {
    return fail(state, "TARGET_INVALID", "El blob SCALE del destino no es restaurable. Se permanece en el curso actual.")
  }
  if (target.instrumentFingerprint !== globalInstrumentFingerprint) {
    return fail(
      state,
      "INSTRUMENT_MISMATCH",
      "La prueba/rúbrica global no coincide con el contexto preparado. Se permanece en el curso actual.",
    )
  }

  if (state.activeContextId === targetId) {
    return { ok: true, state, activated: target }
  }

  const currentScale = readScaleBlob(scaleStore)
  const active = state.activeContextId ? findContext(state, state.activeContextId) : undefined
  const parkedCurrent = active
    ? snapshotFromLive(
        {
          ...live,
          batchId: active.batchId || live.batchId,
        },
        currentScale,
        active.preparedStatus,
      )
    : null

  const wrote = writeScaleBlob(scaleStore, target.scaleBlob)
  if (!wrote) {
    writeScaleBlob(scaleStore, currentScale)
    return fail(state, "SCALE_RESTORE_FAILED", "No se pudo restaurar SCALE del destino. Se permanece en el curso actual.")
  }
  const verify = readScaleBlob(scaleStore)
  const expected = target.scaleBlob ?? null
  if ((expected ?? null) !== (verify ?? null) && (expected ?? "") !== (verify ?? "")) {
    writeScaleBlob(scaleStore, currentScale)
    return fail(state, "SCALE_RESTORE_FAILED", "SCALE del destino no coincidió tras escribir. Se restaura el curso actual.")
  }

  const activated: CourseContextSnapshot<TGroup, TFile> = {
    ...target,
    studentGroups: parkGroups(target.studentGroups),
    unassignedFiles: parkUnassigned(target.unassignedFiles),
    classSize: Math.max(1, target.studentGroups.length || target.classSize || 1),
  }

  const nextContexts = state.contexts.map((c) => {
    if (parkedCurrent && c.contextId === parkedCurrent.contextId) return parkedCurrent
    if (c.contextId === activated.contextId) return activated
    return c
  })

  return {
    ok: true,
    state: { contexts: nextContexts, activeContextId: activated.contextId },
    activated,
  }
}

export function deleteContext<TGroup extends CourseContextGroupLike, TFile extends CourseContextFileLike>(opts: {
  state: CourseContextsState<TGroup, TFile>
  contextId: string
  revokeUrls?: (urls: string[]) => void
  collectUrls?: (ctx: CourseContextSnapshot<TGroup, TFile>) => string[]
}): CourseContextOpResult<TGroup, TFile> {
  const { state, contextId } = opts
  const ctx = findContext(state, contextId)
  if (!ctx) return fail(state, "NOT_FOUND", "No existe el contexto a eliminar.")
  if (state.activeContextId === contextId) {
    return fail(state, "CANNOT_DELETE_ACTIVE", "Cambie a otro curso antes de eliminar el activo.")
  }
  if (opts.collectUrls && opts.revokeUrls) {
    opts.revokeUrls(opts.collectUrls(ctx))
  }
  return {
    ok: true,
    state: {
      contexts: state.contexts.filter((c) => c.contextId !== contextId),
      activeContextId: state.activeContextId,
    },
  }
}

export function refreshActiveSnapshot<TGroup extends CourseContextGroupLike, TFile extends CourseContextFileLike>(opts: {
  state: CourseContextsState<TGroup, TFile>
  live: LiveWorkspace<TGroup, TFile>
  scaleStore: ScaleKvStore | null | undefined
}): CourseContextOpResult<TGroup, TFile> {
  const activeId = opts.state.activeContextId
  if (!activeId) return fail(opts.state, "NO_ACTIVE", "No hay contexto activo.")
  const active = findContext(opts.state, activeId)
  if (!active) return fail(opts.state, "NOT_FOUND", "El contexto activo no existe.")
  const parked = snapshotFromLive(
    { ...opts.live, batchId: active.batchId || opts.live.batchId },
    readScaleBlob(opts.scaleStore),
    active.preparedStatus,
  )
  const next = {
    ...opts.state,
    contexts: opts.state.contexts.map((c) => (c.contextId === activeId ? parked : c)),
  }
  return { ok: true, state: next, activated: parked }
}
