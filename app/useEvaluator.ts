// useEvaluator.ts
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { buildTeacherAnswerKeyFromFormPauta } from '@/app/lib/evaluation-base';

/**
 * Feature flag cliente (default false). Solo elige ruta UI → /api/evaluate/start.
 * No autoriza backend: el servidor exige ASYNC_EVALUATION_WRAPPER_ENABLED=true|1.
 * Ambos flags deben estar activos para usar async. Sin fallback automático a sync
 * tras un start fallido.
 */
function isAsyncEvaluationWrapperEnabled(): boolean {
  const v = process.env.NEXT_PUBLIC_ASYNC_EVALUATION_WRAPPER_ENABLED?.trim().toLowerCase();
  return v === 'true' || v === '1';
}

const ASYNC_JOB_SESSION_KEY = 'libelia_async_eval_job_v1';

type AsyncJobSession = {
  client_request_id: string;
  job_id: string;
  started_at: string;
  /** Solo UI: enlaza el job async al grupo del evaluador (contexto visual). */
  group_id?: string;
};

export type AsyncEvaluationUiStatus = {
  phase: 'idle' | 'starting' | 'pending' | 'processing' | 'completed' | 'failed' | 'waiting_timeout';
  job_id?: string;
  message?: string;
  progress?: number;
};

/** Modo diagnóstico temporal: pantalla completa en el cliente con detalle del fetch a /api/evaluate */
export type EvaluateDiagnosticPayload = Record<string, unknown> & {
  mode?: 'LIBELIA_EVALUATE_DEBUG_V1';
  timestamp?: string;
};

function serializeUnknown(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

function loadAsyncJobSession(): AsyncJobSession | null {
  try {
    const raw = sessionStorage.getItem(ASYNC_JOB_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AsyncJobSession;
    if (parsed?.client_request_id && parsed?.job_id) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveAsyncJobSession(session: AsyncJobSession) {
  try {
    sessionStorage.setItem(ASYNC_JOB_SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

function clearAsyncJobSession() {
  try {
    sessionStorage.removeItem(ASYNC_JOB_SESSION_KEY);
  } catch {
    // ignore
  }
  // Limpiar contexto visual UI ligado al job (no secrets; solo previews/rutas).
  try {
    // lazy require-free: clave compartida con evaluation-visual-context.ts
    sessionStorage.removeItem('libelia_async_eval_visual_v1');
  } catch {
    // ignore
  }
}

function peekAsyncSessionGroupId(): string | undefined {
  const s = loadAsyncJobSession();
  return s?.group_id;
}

/** SCALE-R2/R4: reintento selectivo (quién se encola). No cambia cómo se evalúa. */
export const SELECTIVE_RETRY_COMPLETED_KEY = 'libelia_selective_retry_completed_v1';
export const SELECTIVE_RETRY_STATE_VERSION = 2 as const;

export type SelectiveRetryKvStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type SelectiveRetryGroupSnapshot = {
  id: string;
  hasFiles: boolean;
  isEvaluated: boolean;
  isEvaluating: boolean;
  evaluationId?: string | null;
  promotedEvaluationId?: string | null;
  error?: string | null;
  isValidationStep?: boolean;
  /** SCALE-R4: intento actual (estable en refresh; nuevo en «Nuevo lote»). */
  currentAttemptId?: string | null;
  /** Fingerprint del input actual (archivos / foto móvil). */
  inputFingerprint?: string | null;
  /** Intento al que pertenece el completed record hidratado o en sesión. */
  completedAttemptId?: string | null;
  /** Fingerprint del input que produjo el completed record. */
  completedFingerprint?: string | null;
};

export type SelectiveRetryClass =
  | 'COMPLETED'
  | 'IN_FLIGHT'
  | 'FAILED_RETRYABLE'
  | 'FAILED_NON_RETRYABLE'
  | 'NEVER_EVALUATED'
  | 'AMBIGUOUS';

export type SelectiveRetryCompletedSlot = {
  evaluationId: string;
  fingerprint: string;
  attemptId: string;
};

export type SelectiveRetryCompletedState = {
  v: 1 | 2;
  batchId: string;
  attemptId: string;
  groupCount: number;
  isLegacy: boolean;
  completedByIndex: Record<string, SelectiveRetryCompletedSlot>;
};

export function createSyncOnceGuard(): { tryAcquire: () => boolean; release: () => void; isLocked: () => boolean } {
  let locked = false;
  return {
    tryAcquire(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    release(): void {
      locked = false;
    },
    isLocked(): boolean {
      return locked;
    },
  };
}

function trimId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function groupHasPersistedEvaluationId(g: Pick<SelectiveRetryGroupSnapshot, 'evaluationId' | 'promotedEvaluationId'>): boolean {
  return trimId(g.evaluationId).length > 0 || trimId(g.promotedEvaluationId).length > 0;
}

export function classifyEvaluateError(error: string | null | undefined): 'retryable' | 'non_retryable' | 'unknown' {
  if (error == null) return 'unknown';
  const raw = String(error).trim();
  if (!raw) return 'unknown';
  const lower = raw.toLowerCase();

  if (lower === 'evaluate_in_flight') return 'unknown';

  if (/\b401\b/.test(raw) || /\b403\b/.test(raw)) return 'non_retryable';
  if (
    lower.includes('no autorizado') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('ownership') ||
    lower.includes('no pertenece')
  ) {
    return 'non_retryable';
  }
  if (
    lower.includes('input ausente') ||
    lower.includes('payload ausente') ||
    lower.includes('sin archivos') ||
    lower.includes('no hay archivos') ||
    lower.includes('foto inexistente') ||
    lower.includes('foto inválida') ||
    lower.includes('imagen inválida') ||
    lower.includes('invalid image') ||
    lower.includes('invalid payload')
  ) {
    return 'non_retryable';
  }

  const http4 = raw.match(/\b(?:HTTP\s*)?(4\d\d)\b/i);
  if (http4) {
    const code = Number(http4[1]);
    if (code === 408 || code === 429) return 'retryable';
    if (code >= 400 && code < 500) return 'non_retryable';
  }

  if (
    /\b5\d\d\b/.test(raw) ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('network') ||
    lower.includes('fetch failed') ||
    lower.includes('econnreset') ||
    lower.includes('en cola') ||
    lower.includes('no se pudo iniciar') ||
    lower.includes('evaluación asíncrona falló') ||
    lower.includes('error en la evaluación') ||
    lower.includes('error consultando estado') ||
    lower.includes('trabajo de evaluación no encontrado') ||
    lower.includes('polling cancelado') ||
    lower.includes('falló') ||
    lower.includes('failed')
  ) {
    return 'retryable';
  }

  return 'unknown';
}

export type SelectiveRetryFingerprintFile = {
  name?: string;
  size?: number;
  lastModified?: number;
  type?: string;
  mobileBatchPhotoId?: string | null;
  file?: { name?: string; size?: number; lastModified?: number; type?: string } | null;
};

export function computeSelectiveRetryFileFingerprint(file: SelectiveRetryFingerprintFile | null | undefined): string {
  if (!file) return '';
  const mobile = trimId(file.mobileBatchPhotoId);
  if (mobile) return `m:${mobile}`;
  const f = file.file;
  const name = String(f?.name ?? file.name ?? '');
  const size = Number(f?.size ?? file.size ?? 0);
  const lastModified = Number(f?.lastModified ?? file.lastModified ?? 0);
  const type = String(f?.type ?? file.type ?? '');
  if (!name && !size && !lastModified && !type) return '';
  return `f:${name}|${Number.isFinite(size) ? size : 0}|${Number.isFinite(lastModified) ? lastModified : 0}|${type}`;
}

export function computeSelectiveRetryGroupFingerprint(
  files: Array<SelectiveRetryFingerprintFile | null | undefined> | null | undefined,
): string {
  if (!Array.isArray(files) || files.length === 0) return '';
  return files.map((f) => computeSelectiveRetryFileFingerprint(f)).filter(Boolean).join('||');
}

function isForeignAttempt(g: SelectiveRetryGroupSnapshot): boolean {
  const cur = trimId(g.currentAttemptId);
  const rec = trimId(g.completedAttemptId);
  if (!cur || !rec) return false;
  return cur !== rec;
}

function isDifferentInput(g: SelectiveRetryGroupSnapshot): boolean {
  const a = trimId(g.inputFingerprint);
  const b = trimId(g.completedFingerprint);
  if (!a || !b) return false;
  return a !== b;
}

/** evaluation_id histórica sin attempt identity: no puede bloquear una corrida actual. */
function isLegacyUnscopedPersistedId(g: SelectiveRetryGroupSnapshot): boolean {
  return groupHasPersistedEvaluationId(g) && trimId(g.currentAttemptId).length > 0 && trimId(g.completedAttemptId).length === 0;
}

function persistedIdBelongsToCurrentAttempt(g: SelectiveRetryGroupSnapshot): boolean {
  if (!groupHasPersistedEvaluationId(g)) return false;
  if (isForeignAttempt(g) || isDifferentInput(g) || isLegacyUnscopedPersistedId(g)) return false;
  return true;
}

export function classifySelectiveRetryGroup(g: SelectiveRetryGroupSnapshot): SelectiveRetryClass {
  if (g.isEvaluating) return 'IN_FLIGHT';

  const foreign = isForeignAttempt(g);
  const differentInput = isDifferentInput(g);

  if (persistedIdBelongsToCurrentAttempt(g)) return 'COMPLETED';
  if (g.isEvaluated && !g.error && !foreign && !differentInput) return 'COMPLETED';
  if (g.isEvaluated && g.error && !foreign && !differentInput) return 'AMBIGUOUS';

  if (g.error) {
    if (!g.hasFiles) return 'FAILED_NON_RETRYABLE';
    const kind = classifyEvaluateError(g.error);
    if (kind === 'non_retryable') return 'FAILED_NON_RETRYABLE';
    if (kind === 'retryable') return 'FAILED_RETRYABLE';
    return 'AMBIGUOUS';
  }

  if (!g.hasFiles) return 'AMBIGUOUS';
  return 'NEVER_EVALUATED';
}

export function shouldEnqueueSelectiveRetry(klass: SelectiveRetryClass): boolean {
  return klass === 'FAILED_RETRYABLE' || klass === 'NEVER_EVALUATED';
}

export function selectGroupIdsToEvaluate(groups: SelectiveRetryGroupSnapshot[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    if (shouldEnqueueSelectiveRetry(classifySelectiveRetryGroup(g))) out.push(g.id);
  }
  return out;
}

function mintAttemptId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `att-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeCompletedSlot(raw: unknown): SelectiveRetryCompletedSlot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Partial<SelectiveRetryCompletedSlot>;
  const evaluationId = trimId(rec.evaluationId);
  const fingerprint = trimId(rec.fingerprint);
  const attemptId = trimId(rec.attemptId);
  if (!evaluationId || !fingerprint || !attemptId) return null;
  return { evaluationId, fingerprint, attemptId };
}

function parseCompletedState(raw: string | null): SelectiveRetryCompletedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      v?: unknown;
      batchId?: unknown;
      attemptId?: unknown;
      groupCount?: unknown;
      completedByIndex?: unknown;
    };
    const batchId = typeof parsed.batchId === 'string' ? parsed.batchId.trim() : '';
    const attemptId = typeof parsed.attemptId === 'string' ? parsed.attemptId.trim() : '';
    const v = parsed.v === 2 ? 2 : 1;
    const groupCount = Number(parsed.groupCount);
    const rawMap =
      parsed.completedByIndex && typeof parsed.completedByIndex === 'object' && !Array.isArray(parsed.completedByIndex)
        ? (parsed.completedByIndex as Record<string, unknown>)
        : {};

    const clean: Record<string, SelectiveRetryCompletedSlot> = {};
    let sawLegacyEntry = false;
    for (const [k, val] of Object.entries(rawMap)) {
      if (typeof val === 'string') {
        sawLegacyEntry = true;
        continue;
      }
      const slot = normalizeCompletedSlot(val);
      if (slot) clean[String(k)] = slot;
      else sawLegacyEntry = true;
    }

    const isLegacy = v !== 2 || !attemptId || sawLegacyEntry;
    if (!attemptId && !batchId) return null;
    return {
      v,
      batchId,
      attemptId,
      groupCount: Number.isFinite(groupCount) && groupCount > 0 ? groupCount : 0,
      isLegacy,
      completedByIndex: isLegacy ? {} : clean,
    };
  } catch {
    return null;
  }
}

export function readSelectiveRetryCurrentState(
  store: SelectiveRetryKvStore | null | undefined,
): SelectiveRetryCompletedState | null {
  if (!store) return null;
  try {
    return parseCompletedState(store.getItem(SELECTIVE_RETRY_COMPLETED_KEY));
  } catch {
    return null;
  }
}

export function readSelectiveRetryCompletedState(
  store: SelectiveRetryKvStore | null | undefined,
  batchId: string,
): SelectiveRetryCompletedState | null {
  if (!store) return null;
  const want = trimId(batchId);
  if (!want) return null;
  try {
    const parsed = parseCompletedState(store.getItem(SELECTIVE_RETRY_COMPLETED_KEY));
    if (!parsed || parsed.batchId !== want) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSelectiveRetryCompletedState(store: SelectiveRetryKvStore, state: SelectiveRetryCompletedState): void {
  store.setItem(
    SELECTIVE_RETRY_COMPLETED_KEY,
    JSON.stringify({
      v: SELECTIVE_RETRY_STATE_VERSION,
      batchId: state.batchId,
      attemptId: state.attemptId,
      groupCount: state.groupCount,
      completedByIndex: state.completedByIndex,
    }),
  );
}

function sameAttemptState(
  prev: SelectiveRetryCompletedState | null,
  batchId: string,
  attemptId: string,
): boolean {
  if (!prev || prev.isLegacy || !attemptId || prev.attemptId !== attemptId) return false;
  if (!prev.batchId || !batchId) return true;
  return prev.batchId === batchId;
}

export function beginSelectiveRetryAttempt(
  store: SelectiveRetryKvStore | null | undefined,
  args?: { batchId?: string | null; groupCount?: number; attemptId?: string | null },
): string {
  const attemptId = trimId(args?.attemptId) || mintAttemptId();
  const batchId = trimId(args?.batchId);
  const groupCount = args?.groupCount && args.groupCount > 0 ? args.groupCount : 0;
  if (store) {
    try {
      writeSelectiveRetryCompletedState(store, {
        v: 2,
        batchId,
        attemptId,
        groupCount,
        isLegacy: false,
        completedByIndex: {},
      });
    } catch {
      // storage lleno o bloqueado
    }
  }
  return attemptId;
}

export function ensureSelectiveRetryAttempt(
  store: SelectiveRetryKvStore | null | undefined,
  args?: { batchId?: string | null; groupCount?: number },
): { attemptId: string; state: SelectiveRetryCompletedState } {
  const bid = trimId(args?.batchId);
  const groupCount = args?.groupCount && args.groupCount > 0 ? args.groupCount : 0;
  const prev = store ? parseCompletedState(store.getItem(SELECTIVE_RETRY_COMPLETED_KEY)) : null;
  if (prev && !prev.isLegacy && prev.attemptId) {
    const batchCompatible = !bid || !prev.batchId || prev.batchId === bid;
    if (batchCompatible) {
      const state: SelectiveRetryCompletedState = {
        v: 2,
        batchId: bid || prev.batchId,
        attemptId: prev.attemptId,
        groupCount: groupCount || prev.groupCount,
        isLegacy: false,
        completedByIndex: prev.completedByIndex,
      };
      if (store && (state.batchId !== prev.batchId || state.groupCount !== prev.groupCount)) {
        try {
          writeSelectiveRetryCompletedState(store, state);
        } catch {
          // storage lleno o bloqueado
        }
      }
      return { attemptId: prev.attemptId, state };
    }
  }
  const attemptId = mintAttemptId();
  const state: SelectiveRetryCompletedState = {
    v: 2,
    batchId: bid,
    attemptId,
    groupCount,
    isLegacy: false,
    completedByIndex: {},
  };
  if (store) {
    try {
      writeSelectiveRetryCompletedState(store, state);
    } catch {
      // storage lleno o bloqueado
    }
  }
  return { attemptId, state };
}

export function rememberSelectiveRetryGroupCount(
  store: SelectiveRetryKvStore | null | undefined,
  batchId: string,
  groupCount: number,
  attemptId?: string,
): void {
  if (!store) return;
  const bid = trimId(batchId);
  if (!bid || !(groupCount > 0)) return;
  try {
    const prev = parseCompletedState(store.getItem(SELECTIVE_RETRY_COMPLETED_KEY));
    const aid = trimId(attemptId) || (prev && !prev.isLegacy ? prev.attemptId : '');
    if (!aid) {
      ensureSelectiveRetryAttempt(store, { batchId: bid, groupCount });
      return;
    }
    const keep = sameAttemptState(prev, bid, aid);
    writeSelectiveRetryCompletedState(store, {
      v: 2,
      batchId: bid,
      attemptId: aid,
      groupCount,
      isLegacy: false,
      completedByIndex: keep && prev ? prev.completedByIndex : {},
    });
  } catch {
    // storage lleno o bloqueado
  }
}

export function rememberSelectiveRetryCompletedSlot(
  store: SelectiveRetryKvStore | null | undefined,
  args: {
    batchId: string;
    studentIndex: number;
    evaluationId: string;
    groupCount: number;
    attemptId: string;
    fingerprint: string;
  },
): void {
  if (!store) return;
  const batchId = trimId(args.batchId);
  const evaluationId = trimId(args.evaluationId);
  const attemptId = trimId(args.attemptId);
  const fingerprint = trimId(args.fingerprint);
  const studentIndex = Number(args.studentIndex);
  if (!batchId || !evaluationId || !attemptId || !fingerprint || !Number.isFinite(studentIndex) || studentIndex < 1) return;
  try {
    const prev = parseCompletedState(store.getItem(SELECTIVE_RETRY_COMPLETED_KEY));
    const keep = sameAttemptState(prev, batchId, attemptId);
    const completedByIndex = keep && prev ? { ...prev.completedByIndex } : {};
    completedByIndex[String(studentIndex)] = { evaluationId, fingerprint, attemptId };
    const groupCount =
      args.groupCount > 0 ? args.groupCount : keep && prev && prev.groupCount > 0 ? prev.groupCount : studentIndex;
    writeSelectiveRetryCompletedState(store, {
      v: 2,
      batchId,
      attemptId,
      groupCount,
      isLegacy: false,
      completedByIndex,
    });
  } catch {
    // storage lleno o bloqueado
  }
}

export function applySelectiveRetryCompletedHydration<T extends SelectiveRetryGroupSnapshot>(
  groups: T[],
  completedByIndex:
    | Record<string, string | SelectiveRetryCompletedSlot>
    | SelectiveRetryCompletedState['completedByIndex']
    | null
    | undefined,
  ctx?: { currentAttemptId?: string | null; isLegacy?: boolean },
): T[] {
  if (!completedByIndex || ctx?.isLegacy) return groups;
  const currentAttemptId = trimId(ctx?.currentAttemptId);
  let changed = false;
  const next = groups.map((g, i) => {
    if (groupHasPersistedEvaluationId(g)) return g;
    const raw = completedByIndex[String(i + 1)];
    const slot = typeof raw === 'string' ? null : normalizeCompletedSlot(raw);
    if (!slot) return g;
    if (currentAttemptId && slot.attemptId !== currentAttemptId) return g;
    const fp = trimId(g.inputFingerprint);
    if (!fp || fp !== slot.fingerprint) return g;
    changed = true;
    return {
      ...g,
      evaluationId: slot.evaluationId,
      isEvaluated: true,
      error: undefined,
      completedAttemptId: slot.attemptId,
      completedFingerprint: slot.fingerprint,
    };
  });
  return changed ? next : groups;
}

export function getSelectiveRetrySessionStore(): SelectiveRetryKvStore | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** QR-R4: generación capturada al iniciar sync móvil vs estado al aplicar. */
export type QrSyncGeneration = {
  attemptId?: string | null
  batchId?: string | null
}

export function compareQrSyncGeneration(
  started: QrSyncGeneration,
  current: QrSyncGeneration,
): { sameAttempt: boolean; sameBatch: boolean } {
  const startAttempt = trimId(started.attemptId)
  const curAttempt = trimId(current.attemptId)
  const startBatch = trimId(started.batchId)
  const curBatch = trimId(current.batchId)
  return {
    sameAttempt: startAttempt.length > 0 && startAttempt === curAttempt,
    sameBatch: startBatch.length > 0 && startBatch === curBatch,
  }
}

export function shouldApplyQrSyncPhotos(gen: { sameBatch: boolean }): boolean {
  return gen.sameBatch === true
}

/**
 * QR-R4 current-attempt completed gate.
 * API `is_evaluated` es historial del batch/slot, no completed de la corrida actual.
 * Solo se conserva completed ya ganado en sesión.
 */
export function shouldPromoteApiIsEvaluatedToCurrentAttempt(args: {
  apiIsEvaluated: boolean
  sameAttempt: boolean
  sameBatch: boolean
  groupAlreadyCompletedInCurrentAttempt: boolean
}): boolean {
  if (args.groupAlreadyCompletedInCurrentAttempt) return true
  if (!args.sameAttempt || !args.sameBatch) return false
  void args.apiIsEvaluated
  return false
}

/** Historial de batch-evaluar-sync nunca escribe sessionStorage completed. */
export function shouldRememberCompletedFromQrSyncHistory(): boolean {
  return false
}

function safeParseJsonResponse(
  rawBody: string,
  response: Response,
  urlAttempted: string,
): { ok: true; data: any } | { ok: false; error: string; diagnostic: EvaluateDiagnosticPayload } {
  try {
    const data = rawBody ? JSON.parse(rawBody) : {};
    return { ok: true, data };
  } catch (parseErr) {
    return {
      ok: false,
      error: `Respuesta no JSON (status ${response.status}).`,
      diagnostic: {
        phase: 'parse_response_json',
        urlAttempted,
        method: 'GET',
        responseStatus: response.status,
        responseStatusText: response.statusText,
        responseBodyFromServer: rawBody.slice(0, 120_000),
        errorSerialized: serializeUnknown(parseErr),
      },
    };
  }
}

async function pollAsyncEvaluationJob(args: {
  jobId: string;
  signal: AbortSignal;
  onStatus?: (s: AsyncEvaluationUiStatus) => void;
}): Promise<{ success: true; data: any } | { success: false; error: string; diagnostic?: EvaluateDiagnosticPayload }> {
  const { jobId, signal, onStatus } = args;
  let delayMs = 1500;
  const maxDelayMs = 8000;
  const uiTimeoutMs = 10 * 60 * 1000;
  const started = Date.now();
  let timedOutUi = false;

  while (!signal.aborted) {
    if (!timedOutUi && Date.now() - started > uiTimeoutMs) {
      timedOutUi = true;
      onStatus?.({
        phase: 'waiting_timeout',
        job_id: jobId,
        message:
          'La evaluación sigue en el servidor. Puedes esperar o revisar el historial más tarde.',
        progress: 70,
      });
    }

    const urlAttempted =
      typeof window !== 'undefined'
        ? `${window.location.origin}/api/evaluate/status?job_id=${encodeURIComponent(jobId)}`
        : `/api/evaluate/status?job_id=${encodeURIComponent(jobId)}`;

    let response: Response;
    try {
      response = await fetch(`/api/evaluate/status?job_id=${encodeURIComponent(jobId)}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
    } catch (netErr) {
      if (signal.aborted) {
        return { success: false, error: 'Polling cancelado (desmontaje local; el job sigue en servidor).' };
      }
      // Red intermitente: reintentar con backoff
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(maxDelayMs, Math.floor(delayMs * 1.4));
      continue;
    }

    const rawBody = await response.text();
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok && response.status !== 404) {
      const parsed = safeParseJsonResponse(rawBody, response, urlAttempted);
      const msg =
        parsed.ok && parsed.data?.error
          ? String(parsed.data.error)
          : `Error consultando estado (HTTP ${response.status}).`;
      if (response.status === 403) {
        clearAsyncJobSession();
        return { success: false, error: msg };
      }
    }

    if (!contentType.includes('application/json') && rawBody && !rawBody.trim().startsWith('{')) {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(maxDelayMs, Math.floor(delayMs * 1.4));
      continue;
    }

    const parsed = safeParseJsonResponse(rawBody, response, urlAttempted);
    if (!parsed.ok) {
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(maxDelayMs, Math.floor(delayMs * 1.4));
      continue;
    }

    const data = parsed.data;
    const status = String(data?.status || '');
    if (status === 'pending' || status === 'processing') {
      onStatus?.({
        phase: status as 'pending' | 'processing',
        job_id: jobId,
        message: status === 'pending' ? 'En cola…' : 'Procesando evaluación…',
        progress: typeof data.progress === 'number' ? data.progress : status === 'pending' ? 5 : 55,
      });
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(maxDelayMs, Math.floor(delayMs * 1.25));
      continue;
    }

    if (status === 'completed') {
      clearAsyncJobSession();
      onStatus?.({ phase: 'completed', job_id: jobId, progress: 100, message: 'Completada' });
      // result exacto del motor (mismo JSON que /api/evaluate)
      const result = data?.result !== undefined ? data.result : data;
      return { success: true, data: result };
    }

    if (status === 'failed') {
      clearAsyncJobSession();
      const errMsg =
        (data?.error && typeof data.error === 'object' && data.error.message) ||
        data?.error ||
        'La evaluación asíncrona falló';
      onStatus?.({ phase: 'failed', job_id: jobId, progress: 100, message: String(errMsg) });
      return { success: false, error: String(errMsg) };
    }

    if (response.status === 404) {
      clearAsyncJobSession();
      return { success: false, error: 'Trabajo de evaluación no encontrado' };
    }

    await new Promise((r) => setTimeout(r, delayMs));
    delayMs = Math.min(maxDelayMs, Math.floor(delayMs * 1.25));
  }

  return { success: false, error: 'Polling cancelado (desmontaje local; el job sigue en servidor).' };
}

// Tipo para la plantilla de respuestas del profesor
export interface AnswerKeyItem {
  pregunta: number;
  respuestaCorrecta: string;
  confianza: number;
  metodo: "auto" | "manual" | "mistral" | "sharp";
}

export interface AnswerKeyData {
  respuestas: AnswerKeyItem[];
  totalPreguntas: number;
  preguntasDudosas: number[];
  imagenPlantilla?: string;
  templateId?: string;
}

// 1. Parsea la pauta del profesor
function parsePauta(pautaStr: string) {
  const lines = pautaStr.split('\n').map(l => l.trim()).filter(Boolean);
  let sm: string[] = [];
  let vf: string[] = [];

  for (const line of lines) {
    if (line.startsWith('SM:')) {
      sm = line.replace('SM:', '').split(',').map(s => s.trim().toUpperCase());
    } else if (line.startsWith('VF:')) {
      vf = line.replace('VF:', '').split(',').map(s => s.trim().toUpperCase());
    }
  }
  return { sm, vf };
}

// 2. Corrige comparando con la pauta
function corregirObjetivas(
  pauta: { sm: string[]; vf: string[] },
  respuestas: { sm: string[]; vf: string[] }
) {
  const smCorregido = pauta.sm.map((correcta, i) => ({
    respuesta: respuestas.sm[i] || '',
    correcta,
    esCorrecta: (respuestas.sm[i] || '').trim().toUpperCase() === correcta
  }));

  const vfCorregido = pauta.vf.map((correcta, i) => ({
    respuesta: respuestas.vf[i] || '',
    correcta,
    esCorrecta: (respuestas.vf[i] || '').trim().toUpperCase() === correcta
  }));

  return {
    sm: smCorregido,
    vf: vfCorregido,
    smCorrectas: smCorregido.filter(r => r.esCorrecta).length,
    vfCorrectas: vfCorregido.filter(r => r.esCorrecta).length
  };
}

/** =========================
 *  OMR: memoria momentánea
 *  ========================= */
const OMR_SESSION_KEY = 'libelia_omr_session_v1';

function loadOmrSession() {
  try {
    return JSON.parse(sessionStorage.getItem(OMR_SESSION_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveOmrSession(obj: any) {
  try {
    sessionStorage.setItem(OMR_SESSION_KEY, JSON.stringify(obj));
  } catch {
    // si storage está bloqueado, no pasa nada
  }
}

/** Evita /api/omr en cliente cuando la evaluación es solo desarrollo o asignaturas sin lectura OMR típica (Arte, etc.). */
function shouldSkipClientOmr(payload: any): boolean {
  const tipo = String(payload?.tipoPrueba ?? '');
  if (tipo === 'solo_desarrollo') return true;
  const subj = String(payload?.evaluation_subject ?? payload?.asignatura ?? '').trim().toLowerCase();
  if (!subj) return false;
  if (/\bartes?\b/i.test(subj)) return true;
  if (subj.includes('desarrollo personal')) return true;
  if (subj.includes('educación en el desarrollo') || subj.includes('educacion en el desarrollo')) return true;
  return false;
}

/** Detecta URLs/imagenes en el payload sin asumir un nombre único */
function getPayloadFileUrls(payload: any): string[] | null {
  const candidates = [
    payload?.fileUrls,
    payload?.filesUrls,
    payload?.imageUrls,
    payload?.imagenesUrls,
    payload?.imagenes,
    payload?.images
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0 && typeof c[0] === 'string') return c;
  }
  return null;
}

export const useEvaluator = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [answerKey, setAnswerKey] = useState<AnswerKeyData | null>(null);
  const [evaluateDiagnostic, setEvaluateDiagnostic] = useState<EvaluateDiagnosticPayload | null>(null);
  const [asyncEvaluationStatus, setAsyncEvaluationStatus] = useState<AsyncEvaluationUiStatus>({
    phase: 'idle',
  });
  const pollAbortRef = useRef<AbortController | null>(null);
  const evaluateInFlightRef = useRef(false);

  const clearEvaluateDiagnostic = useCallback(() => {
    setEvaluateDiagnostic(null);
  }, []);

  const reportEvaluateDiagnostic = useCallback((partial: EvaluateDiagnosticPayload) => {
    setEvaluateDiagnostic({
      mode: 'LIBELIA_EVALUATE_DEBUG_V1',
      timestamp: new Date().toISOString(),
      ...partial,
    });
  }, []);

  // Al desmontar: detener polling local; NO cancelar job en servidor.
  useEffect(() => {
    return () => {
      pollAbortRef.current?.abort();
    };
  }, []);

  // Refresh: si hay job activo en sessionStorage, exponer estado para que la UI pueda retomar.
  useEffect(() => {
    if (!isAsyncEvaluationWrapperEnabled()) return;
    const session = loadAsyncJobSession();
    if (session?.job_id) {
      setAsyncEvaluationStatus({
        phase: 'processing',
        job_id: session.job_id,
        message: 'Hay una evaluación en curso. Reanudando seguimiento…',
        progress: 40,
      });
    }
  }, []);

  // Funcion para guardar la plantilla del profesor (memorizada por el sistema)
  const saveAnswerKey = useCallback((data: AnswerKeyData) => {
    setAnswerKey(data);
    try {
      sessionStorage.setItem('libelia_answer_key_v1', JSON.stringify(data));
      // Persistir también en localStorage para que sobreviva al cierre del navegador
      localStorage.setItem('libelia_answer_key_v1', JSON.stringify(data));
    } catch {
      // Si storage esta bloqueado, no pasa nada
    }
  }, []);

  // Funcion para cargar la plantilla guardada (prioridad: estado > session > localStorage)
  const loadAnswerKey = useCallback((): AnswerKeyData | null => {
    if (answerKey) return answerKey;
    try {
      let stored = sessionStorage.getItem('libelia_answer_key_v1');
      if (!stored) stored = localStorage.getItem('libelia_answer_key_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        setAnswerKey(parsed);
        return parsed;
      }
    } catch {
      // Si falla, retornamos null
    }
    return null;
  }, [answerKey]);

  // Funcion para limpiar la plantilla
  const clearAnswerKey = useCallback(() => {
    setAnswerKey(null);
    try {
      sessionStorage.removeItem('libelia_answer_key_v1');
      localStorage.removeItem('libelia_answer_key_v1');
    } catch {
      // Si falla, no pasa nada
    }
  }, []);

  // Funcion para convertir la plantilla a formato de pauta texto
  const answerKeyToPauta = useCallback((key: AnswerKeyData): string => {
    // Genera formato compatible: "SM1:A; SM2:B; SM3:C; ..."
    // Usamos prefijo SM para seleccion multiple
    return key.respuestas
      .filter(r => r.respuestaCorrecta && r.respuestaCorrecta.trim() !== "")
      .map(r => `SM${r.pregunta}:${r.respuestaCorrecta}`)
      .join('; ');
  }, []);

  const evaluate = useCallback(async (payload: any): Promise<any> => {
    if (evaluateInFlightRef.current) {
      return { success: false, error: 'EVALUATE_IN_FLIGHT', skippedDuplicate: true };
    }
    evaluateInFlightRef.current = true;
    setIsLoading(true);
    setEvaluateDiagnostic(null);
    const urlAttempted =
      typeof window !== 'undefined' ? `${window.location.origin}/api/evaluate` : '/api/evaluate';

    const requestSummary = (p: any) => ({
      fileUrlsCount: Array.isArray(p?.fileUrls) ? p.fileUrls.length : 0,
      firstUrlKind:
        Array.isArray(p?.fileUrls) && typeof p.fileUrls[0] === 'string'
          ? p.fileUrls[0].startsWith('data:')
            ? 'data_url'
            : /^https?:\/\//i.test(p.fileUrls[0])
              ? 'http_s'
              : 'other_string'
          : null,
      firstUrlPreview:
        Array.isArray(p?.fileUrls) && typeof p.fileUrls[0] === 'string'
          ? String(p.fileUrls[0]).slice(0, 240)
          : null,
    });

    try {
      // ✅ No mutar el payload original
      const payloadFinal: any = { ...payload };

      // Plantilla del profesor: se inyecta SOLO como CLAVE de corrección (respuestas correctas).
      // NUNCA se usa como respuestas del estudiante: la extracción del estudiante viene de sus propias imágenes.
      const currentAnswerKey = loadAnswerKey();
      if (currentAnswerKey && currentAnswerKey.respuestas.length > 0) {
        payloadFinal.answerKeyFromTemplate = currentAnswerKey;
        payloadFinal.pautaPlantilla = answerKeyToPauta(currentAnswerKey);
        if (currentAnswerKey.imagenPlantilla) {
          payloadFinal.templateImageUrl = currentAnswerKey.imagenPlantilla;
        }
        if (currentAnswerKey.templateId) {
          payloadFinal.templateId = currentAnswerKey.templateId;
        }
      } else {
        const bodyLen = Array.isArray(payloadFinal.answerKeyFromTemplate?.respuestas)
          ? payloadFinal.answerKeyFromTemplate.respuestas.length
          : 0;
        if (bodyLen === 0) {
          const syn = buildTeacherAnswerKeyFromFormPauta(
            String(payloadFinal.pautaEstructurada ?? ''),
            String(payloadFinal.pautaCorrectaAlternativas ?? ''),
            payloadFinal.tipoPrueba,
          );
          if (syn?.respuestas?.length) {
            payloadFinal.answerKeyFromTemplate = syn;
            payloadFinal.pautaPlantilla = syn.respuestas
              .map((r) => `SM${r.pregunta}:${r.respuestaCorrecta}`)
              .join('; ');
          }
        }
      }

      /** ======================================
       *  BLOQUE NUEVO (OPCIONAL): OMR Pro
       *  ======================================
       *  - Si /api/omr NO existe o falla: NO rompe nada.
       *  - Si existe y devuelve respuestasAlternativas: se inyecta y tu backend la usará.
       */
      const fileUrls = getPayloadFileUrls(payloadFinal);

      if (fileUrls && fileUrls.length > 0 && !shouldSkipClientOmr(payloadFinal)) {
        const omrSession = loadOmrSession();
        const templateId = payloadFinal.templateId || omrSession.templateId || 'auto';
        const captureMode = payloadFinal.captureMode || 'X'; // cruces

        try {
          const omrResp = await fetch('/api/omr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileUrls,
              templateId,
              captureMode,
              sessionCalibration: omrSession.calibration || null
            }),
          });

          // fetch no lanza error por 404, por eso verificamos ok:
          if (omrResp.ok) {
            const omrData = await omrResp.json();

            // Si el OMR trae alternativas, las adjuntamos
            if (omrData?.success && omrData?.respuestasAlternativas) {
              payloadFinal.respuestasAlternativas = omrData.respuestasAlternativas;

              // memoria momentánea (solo si viene algo)
              if (omrData?.templateId || omrData?.calibration) {
                saveOmrSession({
                  templateId: omrData.templateId || templateId,
                  calibration: omrData.calibration || omrSession.calibration || null,
                  updatedAt: Date.now(),
                });
              }
            }
          }
        } catch (e) {
          // IMPORTANTÍSIMO: si el OMR falla, seguimos igual con evaluate
          console.warn('[OMR] No disponible/falló. Continuando evaluación normal.', e);
        }
      }

      // Solo UI: no enviar al motor / Redis.
      const uiGroupId =
        typeof payloadFinal.ui_group_id === 'string' && payloadFinal.ui_group_id.trim()
          ? String(payloadFinal.ui_group_id).trim()
          : peekAsyncSessionGroupId();
      delete payloadFinal.ui_group_id;
      delete payloadFinal.uiGroupId;

      // Llama a tu API para procesar imágenes y extraer texto (tu flujo actual)
      let bodyStr: string;
      try {
        bodyStr = JSON.stringify(payloadFinal);
      } catch (serErr) {
        const diagnostic: EvaluateDiagnosticPayload = {
          phase: 'serialize_request_body',
          urlAttempted,
          method: 'POST',
          responseStatus: null,
          responseStatusText: null,
          responseBodyFromServer: null,
          requestBodyBytes: null,
          requestSummary: requestSummary(payloadFinal),
          errorSerialized: serializeUnknown(serErr),
          note: 'JSON.stringify(payloadFinal) falló (referencia circular, BigInt, etc.).',
        };
        setEvaluateDiagnostic({
          mode: 'LIBELIA_EVALUATE_DEBUG_V1',
          timestamp: new Date().toISOString(),
          ...diagnostic,
        });
        const msg =
          serErr instanceof Error ? serErr.message : 'No se pudo serializar el cuerpo para /api/evaluate';
        return { success: false, error: msg, diagnostic };
      }

      // ——— Flujo async (flag); default false = /api/evaluate idéntico ———
      if (isAsyncEvaluationWrapperEnabled()) {
        pollAbortRef.current?.abort();
        const abort = new AbortController();
        pollAbortRef.current = abort;

        const existing = loadAsyncJobSession();
        let jobId = existing?.job_id || '';
        let clientRequestId = existing?.client_request_id || '';

        if (!jobId) {
          clientRequestId = crypto.randomUUID();
          setAsyncEvaluationStatus({
            phase: 'starting',
            message: 'Encolando evaluación…',
            progress: 2,
          });

          const startUrl =
            typeof window !== 'undefined'
              ? `${window.location.origin}/api/evaluate/start`
              : '/api/evaluate/start';

          let startResp: Response;
          try {
            startResp = await fetch('/api/evaluate/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...payloadFinal, client_request_id: clientRequestId }),
              cache: 'no-store',
              credentials: 'same-origin',
              signal: abort.signal,
            });
          } catch (netErr) {
            const diagnostic: EvaluateDiagnosticPayload = {
              phase: 'fetch_network_or_cors',
              urlAttempted: startUrl,
              method: 'POST',
              fetchPathUsed: '/api/evaluate/start',
              errorSerialized: serializeUnknown(netErr),
              requestBodyBytes: bodyStr.length,
              requestSummary: requestSummary(payloadFinal),
            };
            setEvaluateDiagnostic({
              mode: 'LIBELIA_EVALUATE_DEBUG_V1',
              timestamp: new Date().toISOString(),
              ...diagnostic,
            });
            setAsyncEvaluationStatus({ phase: 'failed', message: 'No se pudo iniciar la evaluación asíncrona' });
            return {
              success: false,
              error: netErr instanceof Error ? netErr.message : 'fetch failed',
              diagnostic,
            };
          }

          const startRaw = await startResp.text();
          const startParsed = safeParseJsonResponse(startRaw, startResp, startUrl);
          if (!startParsed.ok) {
            setEvaluateDiagnostic({
              mode: 'LIBELIA_EVALUATE_DEBUG_V1',
              timestamp: new Date().toISOString(),
              ...startParsed.diagnostic,
            });
            setAsyncEvaluationStatus({ phase: 'failed', message: startParsed.error });
            return { success: false, error: startParsed.error, diagnostic: startParsed.diagnostic };
          }

          const startData = startParsed.data;
          if (!startResp.ok || !startData?.success || !startData?.job_id) {
            const msg = startData?.error || `Error al iniciar evaluación (status ${startResp.status}).`;
            setAsyncEvaluationStatus({ phase: 'failed', message: String(msg) });
            return { success: false, error: String(msg) };
          }

          jobId = String(startData.job_id);
          clientRequestId = String(startData.client_request_id || clientRequestId);
          saveAsyncJobSession({
            client_request_id: clientRequestId,
            job_id: jobId,
            started_at: new Date().toISOString(),
            ...(uiGroupId ? { group_id: uiGroupId } : {}),
          });
          // Enlazar contexto visual UI (sessionStorage) al job_id recién creado.
          try {
            const raw = sessionStorage.getItem('libelia_async_eval_visual_v1');
            if (raw) {
              const visual = JSON.parse(raw) as {
                version?: number;
                group_id?: string;
                job_id?: string;
                client_request_id?: string;
              };
              if (
                visual?.version === 1 &&
                (!uiGroupId || visual.group_id === uiGroupId)
              ) {
                sessionStorage.setItem(
                  'libelia_async_eval_visual_v1',
                  JSON.stringify({
                    ...visual,
                    job_id: jobId,
                    client_request_id: clientRequestId,
                  }),
                );
              }
            }
          } catch {
            // ignore
          }
        } else {
          setAsyncEvaluationStatus({
            phase: 'processing',
            job_id: jobId,
            message: 'Reanudando evaluación en curso…',
            progress: 40,
          });
        }

        const polled = await pollAsyncEvaluationJob({
          jobId,
          signal: abort.signal,
          onStatus: setAsyncEvaluationStatus,
        });

        if (!polled.success) {
          if (polled.diagnostic) {
            setEvaluateDiagnostic({
              mode: 'LIBELIA_EVALUATE_DEBUG_V1',
              timestamp: new Date().toISOString(),
              ...polled.diagnostic,
            });
          }
          return { success: false, error: polled.error, diagnostic: polled.diagnostic };
        }

        let data: any = polled.data;
        console.log('DEBUG - Respuesta completa (async):', data);
        if (!data?.success) {
          const msg = data?.error || 'Error en la evaluación asíncrona.';
          return { success: false, error: msg };
        }

        if (payloadFinal?.pauta && data?.respuestasExtraidas && typeof data.respuestasExtraidas === 'object') {
          const pauta = parsePauta(payloadFinal.pauta);
          const respuestasExtraidasSeguras = {
            sm: Array.isArray((data as any)?.respuestasExtraidas?.sm)
              ? (data as any).respuestasExtraidas.sm
              : [],
            vf: Array.isArray((data as any)?.respuestasExtraidas?.vf)
              ? (data as any).respuestasExtraidas.vf
              : [],
          };
          const correccion = corregirObjetivas(pauta, respuestasExtraidasSeguras);
          data.retroalimentacion = {
            ...(data?.retroalimentacion ?? {}),
            correccion_objetiva: correccion,
          };
        }

        return data;
      }

      // ——— Flujo sync histórico (flag false) ———
      const evaluateFetchInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        cache: 'no-store',
        credentials: 'same-origin',
        keepalive: false,
      };

      let response: Response | undefined;
      try {
        let lastNetErr: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) {
            await new Promise((r) => setTimeout(r, 450));
          }
          try {
            response = await fetch('/api/evaluate', evaluateFetchInit);
            break;
          } catch (e) {
            lastNetErr = e;
          }
        }
        if (response === undefined) {
          throw lastNetErr instanceof Error ? lastNetErr : new Error('fetch failed');
        }
      } catch (netErr) {
        const diagnostic: EvaluateDiagnosticPayload = {
          phase: 'fetch_network_or_cors',
          urlAttempted,
          method: 'POST',
          fetchPathUsed: '/api/evaluate',
          responseStatus: null,
          responseStatusText: null,
          responseBodyFromServer: null,
          requestBodyBytes: bodyStr.length,
          requestSummary: requestSummary(payloadFinal),
          errorSerialized: serializeUnknown(netErr),
          hint: 'TypeError "fetch failed": red, CORS, TLS, proxy o cuerpo demasiado grande.',
        };
        setEvaluateDiagnostic({
          mode: 'LIBELIA_EVALUATE_DEBUG_V1',
          timestamp: new Date().toISOString(),
          ...diagnostic,
        });
        const msg = netErr instanceof Error ? netErr.message : 'fetch failed';
        return { success: false, error: msg, diagnostic };
      }

      const rawBody = await response.text();
      const contentType = response.headers.get('content-type') || '';
      let data: any = {};
      try {
        if (!response.ok && contentType && !contentType.includes('application/json') && rawBody && !rawBody.trim().startsWith('{') && !rawBody.trim().startsWith('[')) {
          throw new Error('non-json');
        }
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch (parseErr) {
        const diagnostic: EvaluateDiagnosticPayload = {
          phase: 'parse_response_json',
          urlAttempted,
          method: 'POST',
          responseStatus: response.status,
          responseStatusText: response.statusText,
          responseBodyFromServer: rawBody.slice(0, 120_000),
          requestBodyBytes: bodyStr.length,
          requestSummary: requestSummary(payloadFinal),
          errorSerialized: serializeUnknown(parseErr),
        };
        setEvaluateDiagnostic({
          mode: 'LIBELIA_EVALUATE_DEBUG_V1',
          timestamp: new Date().toISOString(),
          ...diagnostic,
        });
        return {
          success: false,
          error: `Error parseando JSON de /api/evaluate (status ${response.status}).`,
          diagnostic,
        };
      }

      // SNAPSHOT_NATIONAL_ANALYTICS_V1: trazabilidad para inspeccionar payload real en navegador
      console.log("DEBUG - Respuesta completa:", data);
      if (!response.ok || !data?.success) {
        const diagnostic: EvaluateDiagnosticPayload = {
          phase: 'api_returned_error',
          urlAttempted,
          method: 'POST',
          responseStatus: response.status,
          responseStatusText: response.statusText,
          responseBodyFromServer: rawBody.slice(0, 120_000),
          parsedJson: data,
          serverErrorMessage: data?.error ?? null,
          requestBodyBytes: bodyStr.length,
          requestSummary: requestSummary(payloadFinal),
        };
        setEvaluateDiagnostic({
          mode: 'LIBELIA_EVALUATE_DEBUG_V1',
          timestamp: new Date().toISOString(),
          ...diagnostic,
        });
        const msg = data?.error || `Error en la evaluación (status ${response.status}).`;
        return { success: false, error: msg, diagnostic };
      }

      // Si hay pauta y respuestas extraídas, corrige automáticamente (tu lógica actual)
      if (payloadFinal?.pauta && data?.respuestasExtraidas && typeof data.respuestasExtraidas === "object") {
        const pauta = parsePauta(payloadFinal.pauta);
        const respuestasExtraidasSeguras = {
          sm: Array.isArray((data as any)?.respuestasExtraidas?.sm) ? (data as any).respuestasExtraidas.sm : [],
          vf: Array.isArray((data as any)?.respuestasExtraidas?.vf) ? (data as any).respuestasExtraidas.vf : [],
        };
        const correccion = corregirObjetivas(pauta, respuestasExtraidasSeguras);

        data.retroalimentacion = {
          ...(data?.retroalimentacion ?? {}),
          correccion_objetiva: correccion
        };
      }

      return data;
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Fallo inesperado en cliente al procesar /api/evaluate";
      const diagnostic: EvaluateDiagnosticPayload = {
        phase: 'unexpected_catch',
        urlAttempted,
        method: 'POST',
        errorSerialized: serializeUnknown(err),
        requestSummary: requestSummary(payload),
      };
      setEvaluateDiagnostic({
        mode: 'LIBELIA_EVALUATE_DEBUG_V1',
        timestamp: new Date().toISOString(),
        ...diagnostic,
      });
      return { success: false, error: msg, diagnostic };
    } finally {
      evaluateInFlightRef.current = false;
      setIsLoading(false);
    }
  }, [loadAnswerKey, answerKeyToPauta]);

// Nueva funcion: Comparar respuestas del estudiante con la plantilla del profesor
  const compareWithAnswerKey = useCallback(async (studentAnswers: { pregunta: string | number; respuesta: string; confianza: number }[]) => {
    const currentKey = loadAnswerKey();
    if (!currentKey || currentKey.respuestas.length === 0) {
      return { success: false, error: "No hay plantilla del profesor cargada" };
    }

    try {
      const response = await fetch('/api/omr/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answerKey: currentKey.respuestas,
          studentAnswers,
          exigencia: 0.6 // 60% para nota 4.0
        }),
      });

      const rawBody = await response.text();
      let data: any = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        return {
          success: false,
          error: `Error parseando JSON de /api/omr/compare (status ${response.status}).`,
        };
      }
      console.log("DEBUG - Respuesta completa:", data);
      return data;
    } catch (err: any) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Fallo de red o parsing en cliente al procesar /api/omr/compare",
      };
    }
  }, [loadAnswerKey]);

  return { 
    evaluate, 
    isLoading,
    evaluateDiagnostic,
    clearEvaluateDiagnostic,
    reportEvaluateDiagnostic,
    asyncEvaluationStatus,
    asyncEvaluationWrapperEnabled: isAsyncEvaluationWrapperEnabled(),
    // Funciones para manejar la plantilla del profesor
    answerKey,
    saveAnswerKey,
    loadAnswerKey,
    clearAnswerKey,
    answerKeyToPauta,
    // Nueva funcion de comparacion
    compareWithAnswerKey,
  };
};
