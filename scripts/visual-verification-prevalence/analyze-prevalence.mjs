#!/usr/bin/env node
/**
 * Analizador OFFLINE de prevalencia (FASE 2A-2).
 *
 * Uso:
 *   node scripts/visual-verification-prevalence/analyze-prevalence.mjs <logfile1> [logfile2...]
 *
 * NO se importa desde runtime. Solo lee logs exportados.
 *
 * Regla de attempt efectivo (demostrable por evaluation-logic.ts):
 *   for (let attempt = 0; attempt < 2 && !azureOfficial; attempt++)
 * - attempt 1 solo corre si azureOfficial sigue null tras attempt 0
 * - por página+estudiante+run: si existe attempt 1, ese es el efectivo; attempt 0 = discarded
 * - si solo existe attempt 0, ese es el efectivo
 * - no se suman ambos como dos páginas
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PREFIX = "[VISUAL_VERIFICATION_PREVALENCE]"
const SCHEMA_VERSION = 1
const EVENT_NAME = "PAGE_PREVALENCE_SUMMARY"

/**
 * @typedef {object} PageEvent
 * @property {number} schemaVersion
 * @property {string} event
 * @property {string} diagnosticRunId
 * @property {string} [evaluationBatchId]
 * @property {number} [batchStudentIndex]
 * @property {number} pageIndex
 * @property {number} attempt
 * @property {string} eventKey
 * @property {"batch"|"direct"} sourceMode
 * @property {number} expectedQuestionCount
 * @property {number} autoRescueCandidateCount
 * @property {number} reviewCandidateCount
 * @property {boolean} degradedPage
 * @property {string|null} degradedReason
 * @property {string} pageUsefulness
 * @property {number} selectionMarksTotal
 * @property {number} excludedCompetitiveDoubleMarkCount
 * @property {number} excludedGridIncompleteCount
 * @property {number} excludedInvalidPolygonCount
 * @property {number} excludedOtherCount
 */

/**
 * @param {string} line
 * @returns {PageEvent|null}
 */
export function parsePrevalenceLine(line) {
  const idx = line.indexOf(PREFIX)
  if (idx < 0) return null
  const jsonPart = line.slice(idx + PREFIX.length).trim()
  if (!jsonPart) return null
  let obj
  try {
    obj = JSON.parse(jsonPart)
  } catch {
    return null
  }
  if (!obj || typeof obj !== "object") return null
  if (obj.schemaVersion !== SCHEMA_VERSION) return null
  if (obj.event !== EVENT_NAME) return null
  if (typeof obj.diagnosticRunId !== "string" || !obj.diagnosticRunId.trim()) return null
  if (typeof obj.eventKey !== "string" || !obj.eventKey.trim()) return null
  if (obj.sourceMode !== "batch" && obj.sourceMode !== "direct") return null
  if (!Number.isInteger(obj.pageIndex) || obj.pageIndex < 0) return null
  if (!Number.isInteger(obj.attempt) || obj.attempt < 0) return null
  return /** @type {PageEvent} */ (obj)
}

/**
 * Deduplica por eventKey. Colisión (mismo key, payload distinto sin emittedAt) → error.
 * @param {PageEvent[]} events
 */
export function dedupeEvents(events) {
  /** @type {Map<string, PageEvent>} */
  const byKey = new Map()
  let duplicates = 0
  /** @type {string[]} */
  const collisions = []

  for (const ev of events) {
    const prev = byKey.get(ev.eventKey)
    if (!prev) {
      byKey.set(ev.eventKey, ev)
      continue
    }
    const a = stablePayload(prev)
    const b = stablePayload(ev)
    if (a === b) {
      duplicates++
      continue
    }
    collisions.push(ev.eventKey)
  }

  return {
    unique: [...byKey.values()],
    duplicates,
    collisions,
    hasCollisions: collisions.length > 0,
  }
}

/** @param {PageEvent} ev */
function stablePayload(ev) {
  const copy = { ...ev }
  delete copy.emittedAt
  return JSON.stringify(copy)
}

/**
 * Resuelve attempt efectivo por (run, batch, student, page).
 * @param {PageEvent[]} events
 */
export function selectEffectiveAttempts(events) {
  /** @type {Map<string, PageEvent[]>} */
  const groups = new Map()
  for (const ev of events) {
    const gkey = pageGroupKey(ev)
    if (!groups.has(gkey)) groups.set(gkey, [])
    groups.get(gkey).push(ev)
  }

  /** @type {PageEvent[]} */
  const effective = []
  /** @type {Array<{group:string, used:number, discarded:number[]}>} */
  const resolutions = []

  for (const [gkey, list] of groups) {
    list.sort((a, b) => a.attempt - b.attempt)
    const maxAttempt = Math.max(...list.map((e) => e.attempt))
    const used = list.find((e) => e.attempt === maxAttempt)
    if (!used) continue
    effective.push(used)
    resolutions.push({
      group: gkey,
      used: used.attempt,
      discarded: list.filter((e) => e.attempt !== used.attempt).map((e) => e.attempt),
      rule: "loop_invariant_max_attempt",
    })
  }

  return { effective, resolutions }
}

/** @param {PageEvent} ev */
function pageGroupKey(ev) {
  if (ev.sourceMode === "batch") {
    return `${ev.diagnosticRunId}|${ev.evaluationBatchId}|${ev.batchStudentIndex}|${ev.pageIndex}`
  }
  return `${ev.diagnosticRunId}|direct|${ev.pageIndex}`
}

/** @param {PageEvent} ev */
export function isNonUsablePage(ev) {
  if (ev.pageUsefulness === "ignoredOrNonOmrPage") return true
  if (ev.pageUsefulness === "gridIncompleteUsefulPage") return true
  if (ev.selectionMarksTotal === 0) return true
  if (ev.degradedReason === "grid_incomplete") return true
  return false
}

/**
 * @param {PageEvent[]} effectivePages — ya deduplicados y con attempt efectivo
 */
export function analyzeBatch(effectivePages) {
  const batchOnly = effectivePages.filter((e) => e.sourceMode === "batch")
  /** @type {Map<string, PageEvent[]>} */
  const byStudent = new Map()

  for (const ev of batchOnly) {
    const sk = `${ev.diagnosticRunId}|${ev.evaluationBatchId}|${ev.batchStudentIndex}`
    if (!byStudent.has(sk)) byStudent.set(sk, [])
    byStudent.get(sk).push(ev)
  }

  let studentsWith0Review = 0
  let studentsWith1Review = 0
  let studentsWith2Review = 0
  let studentsWith3To5Review = 0
  let studentsWithMoreThan5Review = 0
  let studentsWithAnyReview = 0
  let studentsWithDegradedPage = 0
  let totalQuestions = 0
  let totalReviewCandidates = 0
  let totalAutoRescueCandidates = 0
  let totalDegradedPages = 0
  let nonUsablePages = 0
  let maxReviewOnSinglePage = 0
  let excludedCases = 0

  /** @type {object[]} */
  const studentSummaries = []

  for (const [sk, pages] of byStudent) {
    let review = 0
    let auto = 0
    let questions = 0
    let degradedPages = 0
    let excl = 0
    let hasDegraded = false

    for (const p of pages) {
      if (isNonUsablePage(p)) {
        nonUsablePages++
        // no atribuir revisiones de páginas no útiles
        continue
      }
      const rc = Number(p.reviewCandidateCount) || 0
      const ar = Number(p.autoRescueCandidateCount) || 0
      const eq = Number(p.expectedQuestionCount) || 0
      review += rc
      auto += ar
      questions += eq
      maxReviewOnSinglePage = Math.max(maxReviewOnSinglePage, rc)
      excl +=
        (Number(p.excludedCompetitiveDoubleMarkCount) || 0) +
        (Number(p.excludedInvalidPolygonCount) || 0) +
        (Number(p.excludedOtherCount) || 0)
      if (p.degradedPage) {
        degradedPages++
        hasDegraded = true
      }
    }

    totalQuestions += questions
    totalReviewCandidates += review
    totalAutoRescueCandidates += auto
    totalDegradedPages += degradedPages
    excludedCases += excl
    if (hasDegraded) studentsWithDegradedPage++

    if (review === 0) studentsWith0Review++
    else if (review === 1) studentsWith1Review++
    else if (review === 2) studentsWith2Review++
    else if (review >= 3 && review <= 5) studentsWith3To5Review++
    else studentsWithMoreThan5Review++

    if (review > 0) studentsWithAnyReview++

    studentSummaries.push({
      studentKey: sk,
      totalQuestions: questions,
      autoRescues: auto,
      reviewCandidates: review,
      degradedPages,
      excludedCases: excl,
    })
  }

  const totalStudents = byStudent.size
  const zone = classifyZone({
    totalStudents,
    studentsWith0Review,
    studentsWithAnyReview,
    studentsWith3To5Review,
    studentsWithMoreThan5Review,
    studentSummaries,
    totalReviewCandidates,
    totalDegradedPages,
    maxReviewOnSinglePage,
  })

  const pct = (n, d) => (d > 0 ? Number(((100 * n) / d).toFixed(2)) : null)

  return {
    sample: {
      totalStudents,
      totalPagesEffective: batchOnly.length,
      nonUsablePages,
      sourceModeFilter: "batch",
    },
    students: {
      studentsWith0Review,
      studentsWith1Review,
      studentsWith2Review,
      studentsWith3To5Review,
      studentsWithMoreThan5Review,
      studentsWithAnyReview,
      studentsWithDegradedPage,
      pctWith0Review: pct(studentsWith0Review, totalStudents),
      pctWithAnyReview: pct(studentsWithAnyReview, totalStudents),
    },
    totals: {
      totalQuestions,
      totalReviewCandidates,
      totalAutoRescueCandidates,
      totalDegradedPages,
      excludedCases,
      maxReviewOnSinglePage,
    },
    denominators: {
      pctWith0Review: "studentsWith0Review / totalStudents",
      pctWithAnyReview: "studentsWithAnyReview / totalStudents",
      reviewPerQuestion:
        totalQuestions > 0
          ? Number((totalReviewCandidates / totalQuestions).toFixed(4))
          : null,
      reviewPerQuestionDenom: "totalReviewCandidates / totalQuestions",
    },
    zone,
    studentSummaries,
  }
}

/**
 * @param {object} s
 */
export function classifyZone(s) {
  const {
    totalStudents,
    studentsWith0Review,
    studentsWithAnyReview,
    studentSummaries,
    totalReviewCandidates,
    totalDegradedPages,
    maxReviewOnSinglePage,
  } = s

  const pct0 = totalStudents > 0 ? studentsWith0Review / totalStudents : 0
  const pctAny = totalStudents > 0 ? studentsWithAnyReview / totalStudents : 0
  const maxPerStudent = Math.max(0, ...studentSummaries.map((x) => x.reviewCandidates))
  const massiveDegraded =
    totalStudents > 0 && totalDegradedPages >= Math.max(2, Math.ceil(totalStudents * 0.25))

  // Zona C
  if (
    pctAny >= 0.4 ||
    (totalStudents <= 25 && studentsWithAnyReview >= 10) ||
    totalReviewCandidates > 20 ||
    maxPerStudent > 5 ||
    maxReviewOnSinglePage > 5 ||
    massiveDegraded
  ) {
    return {
      zone: "ZONA_C",
      reasons: {
        pctAny,
        studentsWithAnyReview,
        totalReviewCandidates,
        maxPerStudent,
        maxReviewOnSinglePage,
        totalDegradedPages,
        massiveDegraded,
      },
    }
  }

  // Zona A
  const allStudentsAtMost2 = studentSummaries.every((x) => x.reviewCandidates <= 2)
  if (
    pct0 >= 0.85 &&
    pctAny <= 0.2 &&
    allStudentsAtMost2 &&
    totalReviewCandidates <= 8 &&
    !massiveDegraded
  ) {
    return { zone: "ZONA_A", reasons: { pct0, pctAny, totalReviewCandidates } }
  }

  // Zona B (resto sin alcanzar C)
  return {
    zone: "ZONA_B",
    reasons: {
      pctAny,
      maxPerStudent,
      totalReviewCandidates,
      note: "20–40% revisión, o >2 casos en algún estudiante, o 9–20 revisables, sin C",
    },
  }
}

/**
 * Calidad de muestra: no clasificar como representativa si es incompleta.
 * Umbral mínimo: ≥10 estudiantes batch efectivos y ≥1 pregunta cerrada.
 * @param {object} batchAnalysis
 * @param {{ synthetic?: boolean, hasCollisions?: boolean }} opts
 */
export function assessSampleQuality(batchAnalysis, opts = {}) {
  const reasons = []
  if (opts.synthetic === true) {
    reasons.push("fixtures_sinteticos_no_prueban_prevalencia_real_de_produccion")
  }
  if (opts.hasCollisions === true) {
    reasons.push("colisiones_de_payload")
  }
  const totalStudents = batchAnalysis?.sample?.totalStudents ?? 0
  const totalQuestions = batchAnalysis?.totals?.totalQuestions ?? 0
  if (totalStudents < 10) {
    reasons.push(`estudiantes_insuficientes_${totalStudents}_min_10`)
  }
  if (totalQuestions <= 0) {
    reasons.push("preguntas_cerradas_cero")
  }
  if (reasons.length > 0) {
    return { quality: "INSUFICIENTE", reasons }
  }
  return { quality: "VÁLIDA", reasons: ["denominadores_completos_y_n_minimo"] }
}

/**
 * Resumen ejecutivo verificable (denominadores explícitos; % solo si denom > 0).
 * @param {object} result — salida de analyzeFiles
 * @param {{ synthetic?: boolean }} [opts]
 */
export function formatExecutiveSummary(result, opts = {}) {
  const lines = []
  const push = (s = "") => lines.push(s)
  push("--------------------------------------------------")
  push("RESUMEN DE PREVALENCIA")
  push("--------------------------------------------------")
  push("")

  if (!result || result.ok === false) {
    push("Estado: NO CLASIFICABLE")
    push(`Error: ${result?.error ?? "unknown"}`)
    push(`Mensaje: ${result?.message ?? ""}`)
    push(`Colisiones: ${result?.collisions?.length ?? 0}`)
    push(`Eventos duplicados (idénticos): ${result?.stats?.duplicates ?? 0}`)
    push(`Eventos descartados: ${(result?.stats?.parseFail ?? 0) + (result?.stats?.incomplete ?? 0)}`)
    push("")
    push("Calidad de la muestra:")
    push("INSUFICIENTE")
    push("Motivos: colisión o parseo inválido — no se clasifica zona.")
    if (opts.synthetic === true) {
      push("")
      push(
        "NOTA: fixtures sintéticos y anonimizados. NO prueban la prevalencia real de producción.",
      )
    }
    push("--------------------------------------------------")
    return lines.join("\n")
  }

  const st = result.stats
  const b = result.batch
  const students = b.students
  const totals = b.totals
  const sample = b.sample
  const zone = b.zone

  const batchIds = new Set()
  const runIds = new Set()
  for (const s of b.studentSummaries ?? []) {
    const parts = String(s.studentKey).split("|")
    if (parts.length >= 2) {
      runIds.add(parts[0])
      batchIds.add(parts[1])
    }
  }

  const sampleQuality = assessSampleQuality(b, {
    synthetic: opts.synthetic === true,
    hasCollisions: false,
  })

  const fmtPct = (v) => (v === null || v === undefined ? "N/A (denominador 0)" : `${v}%`)

  push(`Lotes válidos: ${batchIds.size}`)
  push(`Ejecuciones válidas: ${runIds.size}`)
  push(`Estudiantes: ${sample.totalStudents}`)
  push(`Preguntas cerradas: ${totals.totalQuestions}`)
  push(`Eventos válidos: ${st.parsedValid}`)
  push(`Eventos descartados: ${st.discardedIncompleteOrInvalid}`)
  push(`Eventos duplicados: ${st.duplicatesIdentical}`)
  push(`Colisiones: ${st.collisions}`)
  push("")
  push(`Estudiantes con 0 revisiones: ${students.studentsWith0Review}`)
  push(`Estudiantes con 1 revisión: ${students.studentsWith1Review}`)
  push(`Estudiantes con 2 revisiones: ${students.studentsWith2Review}`)
  push(`Estudiantes con 3–5 revisiones: ${students.studentsWith3To5Review}`)
  push(`Estudiantes con más de 5 revisiones: ${students.studentsWithMoreThan5Review}`)
  push("")
  push(`Estudiantes con alguna revisión: ${students.studentsWithAnyReview}`)
  push(`Porcentaje con revisión: ${fmtPct(students.pctWithAnyReview)}`)
  push(`  (denominador: studentsWithAnyReview / totalStudents = ${students.studentsWithAnyReview} / ${sample.totalStudents})`)
  push(`Porcentaje con 0 revisión: ${fmtPct(students.pctWith0Review)}`)
  push(`  (denominador: studentsWith0Review / totalStudents = ${students.studentsWith0Review} / ${sample.totalStudents})`)
  push("")
  push(`Candidatos de revisión: ${totals.totalReviewCandidates}`)
  push(`Rescates automáticos: ${totals.totalAutoRescueCandidates}`)
  push(`Páginas degradadas: ${totals.totalDegradedPages}`)
  push(`Estudiantes con página degradada: ${students.studentsWithDegradedPage}`)
  push(`Páginas no útiles (excluidas de tasa): ${sample.nonUsablePages}`)
  push(`Páginas efectivas (post-attempt): ${sample.totalPagesEffective}`)
  push("")
  if (sampleQuality.quality === "INSUFICIENTE") {
    push("Clasificación global (orientativa; muestra no representativa):")
  } else {
    push("Clasificación global:")
  }
  push(`${zone.zone}`)
  push("Motivos de clasificación:")
  push(JSON.stringify(zone.reasons, null, 2))
  push("")
  push("Calidad de la muestra:")
  push(sampleQuality.quality)
  push(`Motivos calidad: ${sampleQuality.reasons.join("; ")}`)
  if (opts.synthetic === true) {
    push("")
    push(
      "NOTA: fixtures sintéticos y anonimizados. NO prueban la prevalencia real de producción.",
    )
  }
  push("--------------------------------------------------")
  return lines.join("\n")
}

/**
 * @param {string[]} filePaths
 * @param {{ synthetic?: boolean }} [opts]
 */
export function analyzeFiles(filePaths, opts = {}) {
  let rawLines = 0
  let prefixHits = 0
  let parseFail = 0
  let incomplete = 0
  /** @type {PageEvent[]} */
  const parsed = []

  for (const fp of filePaths) {
    const text = fs.readFileSync(fp, "utf8")
    const lines = text.split(/\r?\n/)
    for (const line of lines) {
      rawLines++
      if (!line.includes(PREFIX)) continue
      prefixHits++
      const ev = parsePrevalenceLine(line)
      if (!ev) {
        // skipped / invalid JSON / incomplete
        if (line.includes("PAGE_PREVALENCE_SKIPPED")) {
          incomplete++
        } else {
          parseFail++
        }
        continue
      }
      parsed.push(ev)
    }
  }

  const deduped = dedupeEvents(parsed)
  if (deduped.hasCollisions) {
    return {
      ok: false,
      error: "COLLISION",
      message:
        "Misma eventKey con payload distinto. No se cuenta. Corregir logs antes de clasificar.",
      collisions: deduped.collisions,
      stats: {
        rawLines,
        prefixHits,
        parsed: parsed.length,
        duplicates: deduped.duplicates,
        parseFail,
        incomplete,
      },
      synthetic: opts.synthetic === true,
    }
  }

  const { effective, resolutions } = selectEffectiveAttempts(deduped.unique)
  const batchAnalysis = analyzeBatch(effective)
  const sampleQuality = assessSampleQuality(batchAnalysis, {
    synthetic: opts.synthetic === true,
    hasCollisions: false,
  })

  return {
    ok: true,
    stats: {
      rawLines,
      prefixHits,
      parsedValid: parsed.length,
      discardedIncompleteOrInvalid: parseFail + incomplete,
      parseFail,
      skippedEvents: incomplete,
      duplicatesIdentical: deduped.duplicates,
      collisions: 0,
      uniqueEventKeys: deduped.unique.length,
      effectivePagesAfterAttemptResolve: effective.length,
    },
    attemptResolutionRule:
      "max_attempt_per_(diagnosticRunId,batch,student,page) — invariant of evaluation-logic loop (!azureOfficial)",
    attemptResolutions: resolutions,
    batch: batchAnalysis,
    sampleQuality,
    synthetic: opts.synthetic === true,
  }
}

function main() {
  const rawArgs = process.argv.slice(2)
  const synthetic = rawArgs.includes("--synthetic")
  const jsonOnly = rawArgs.includes("--json")
  const args = rawArgs.filter((a) => a !== "--synthetic" && a !== "--json")
  if (args.length === 0) {
    console.error(
      "Uso: node scripts/visual-verification-prevalence/analyze-prevalence.mjs [--synthetic] [--json] <logfile> [logfile2...]",
    )
    process.exit(2)
  }
  for (const a of args) {
    if (!fs.existsSync(a)) {
      console.error(`No existe: ${a}`)
      process.exit(2)
    }
  }
  const result = analyzeFiles(args, { synthetic })
  if (!jsonOnly) {
    console.log(formatExecutiveSummary(result, { synthetic }))
    console.log("")
  }
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(1)
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  main()
}
