/**
 * Sprint 31–34 — Núcleo común de criterios de Desarrollo.
 *
 * Concentra: ítem + consigna + respuesta + rúbrica + contexto
 * → parseo rubric-first → (S34) requisitos estructurales + checks IA
 * → decisión de frontera determinista → criterios_evaluados[]
 *
 * Fuera del núcleo: OMR, scoring, Mechanical, Repair, Invariants,
 * colapso multipregunta, filtrado de cerradas, Mixta, persistencia, PDF, UI.
 *
 * No muta la entrada. No inventa criterios ni evidencia.
 * Conserva exactamente los niveles actuales de Solo Desarrollo.
 * Sprint 33: taxonomía forzada por rúbrica (solo camino independiente).
 * Sprint 34: frontera universal por checklist (solo camino independiente).
 */

import { requestEvaluationTextCompletion } from "@/app/lib/ai-evaluation-provider"
import {
  decideBoundaryLevel,
  sanitizeRequirementChecks,
  type RequirementCheck,
} from "@/app/lib/development-core/boundary-decision"
import type {
  DevelopmentCriteriaCoreInput,
  DevelopmentCriteriaCoreResult,
  DevelopmentCriteriaEvaluated,
  DevelopmentCriteriaParityComparison,
  DevelopmentCriteriaParityDiff,
  DevelopmentCriteriaPromptMode,
  RequirementCheckRecord,
} from "@/app/lib/development-core/development-criteria-core.types"
import {
  extractLevelRequirementPacks,
  requirementsFingerprint,
  type LevelRequirementPack,
} from "@/app/lib/development-core/extract-level-requirements"
import {
  isStudentEvidenceNotObservable,
  parseRubricCriteria,
  type ParsedRubricCriterion,
} from "@/app/lib/development-core/parse-rubric-criteria"

export type {
  DevelopmentCriteriaCoreInput,
  DevelopmentCriteriaCoreResult,
  DevelopmentCriteriaEvaluated,
  DevelopmentCriteriaParityComparison,
  DevelopmentCriteriaPromptMode,
} from "@/app/lib/development-core/development-criteria-core.types"

export {
  parseRubricCriteria,
  isStudentEvidenceNotObservable,
} from "@/app/lib/development-core/parse-rubric-criteria"

export {
  extractLevelRequirementPacks,
  requirementsFingerprint,
} from "@/app/lib/development-core/extract-level-requirements"

export {
  decideBoundaryLevel,
  sanitizeRequirementChecks,
} from "@/app/lib/development-core/boundary-decision"

// ---------------------------------------------------------------------------
// Feature flags (default false — producción idéntica al camino anterior)
// ---------------------------------------------------------------------------

/** Cuando true, Solo Desarrollo enruta criterios por el núcleo (parseo/compat). Default: false. */
export function isDevelopmentCriteriaCoreEnabled(): boolean {
  const v = String(process.env.DEVELOPMENT_CRITERIA_CORE_ENABLED ?? "").trim().toLowerCase()
  return v === "true" || v === "1"
}

/** Cuando true, ejecuta núcleo en shadow sobre copia; el resultado oficial usa camino antiguo. Default: false. */
export function isDevelopmentCriteriaCoreParityShadowEnabled(): boolean {
  const v = String(process.env.DEVELOPMENT_CRITERIA_CORE_PARITY_SHADOW ?? "").trim().toLowerCase()
  return v === "true" || v === "1"
}

// ---------------------------------------------------------------------------
// Prompt de criterios (extraído bit-a-bit de desarrollo-pipeline Solo Desarrollo)
// ---------------------------------------------------------------------------

/**
 * Instrucciones de criterios — misma redacción que buildPedagogicalEvidencePromptInstruction.
 * Sin calcular puntaje; sin convertir criterios en preguntas.
 */
export function buildDevelopmentCriteriaPromptInstruction(params: {
  applies: boolean
  mode: DevelopmentCriteriaPromptMode
  puntajeTotal: number
}): string {
  if (!params.applies) return ""

  const mechanicalContract = `
INSTRUCCIÓN PEDAGÓGICA (OBLIGATORIA — SOLO_DESARROLLO):
Evalúa la evidencia contra la rúbrica. No calcules puntaje final. No conviertas criterios de rúbrica en preguntas. Devuelve criterios_evaluados con nivel_logro, evidencia y justificación. Si por compatibilidad incluyes respuestas_desarrollo, su puntaje será ignorado por el sistema.

- Estás evaluando una evidencia pedagógica real del estudiante.
- La rúbrica sirve para JUZGAR la evidencia; NO conviertas criterios de rúbrica en preguntas P1, P2, P3.
- NO dividas un ensayo, carta, informe o reflexión en varias preguntas artificiales.
- Observa la evidencia, contrástala con la rúbrica y determina el nivel de logro por criterio.
- NO eres autoridad aritmética: NO calcules puntos, porcentajes ni puntaje X/Y final.
- Devuelve "criterios_evaluados" dentro de cada entrada de respuestas_desarrollo con este formato:
  "criterios_evaluados": [
    {
      "criterio_id": "identificador estable",
      "criterio_label": "nombre del criterio",
      "nivel_logro": "LOGRADO" | "PARCIALMENTE_LOGRADO" | "INSUFICIENTE" | "NO_OBSERVABLE",
      "evidencia": "qué observaste en la evidencia del estudiante",
      "justificacion": "por qué ese nivel según la rúbrica"
    }
  ]
- Si incluyes "puntaje" por compatibilidad, será ignorado; LibelIA calculará el puntaje mecánicamente.
- El puntaje global máximo de la evaluación es ${params.puntajeTotal} puntos (solo referencia; no lo calcules tú).`

  if (params.mode === "SINGLE_EVIDENCE_TEXT") {
    return `${mechanicalContract}
- Modo: evidencia textual única (ensayo, carta, comentario, informe, reflexión o respuesta extensa).
- Devuelve exactamente UNA entrada en respuestas_desarrollo.`
  }

  if (params.mode === "SINGLE_EVIDENCE_VISUAL") {
    return `${mechanicalContract}
- Modo: evidencia visual única (dibujo, pintura, fotografía, collage, afiche, maqueta u obra visual).
- No exijas cita textual si no hay texto escrito.
- Evalúa evidencia observable: composición, color, técnica, materialidad, uso del espacio, intención, creatividad y relación con la consigna.
- Devuelve exactamente UNA entrada en respuestas_desarrollo.`
  }

  if (params.mode === "MULTIPLE_OPEN_EVIDENCES") {
    return `${mechanicalContract}
- Modo: varias preguntas abiertas independientes con evidencias distintas.
- Devuelve UNA entrada en respuestas_desarrollo por cada pregunta real (P1, P2, …), no por criterio de rúbrica.
- Cada entrada debe tener sus propios criterios_evaluados según la rúbrica aplicable a esa pregunta.`
  }

  return mechanicalContract
}

/**
 * Ejemplo JSON de criterios — misma redacción que buildSoloDesarrolloRespuestasDesarrolloJsonExample.
 */
export function buildDevelopmentCriteriaRespuestasDesarrolloJsonExample(params: {
  applies: boolean
  mode: DevelopmentCriteriaPromptMode
}): string {
  if (!params.applies) return ""

  const criterioBlock = `"criterios_evaluados": [
        {
          "criterio_id": "C1",
          "criterio_label": "nombre del criterio según rúbrica",
          "nivel_logro": "LOGRADO",
          "evidencia": "qué observaste en la evidencia del estudiante",
          "justificacion": "por qué ese nivel según la rúbrica"
        }
      ]`

  if (params.mode === "MULTIPLE_OPEN_EVIDENCES") {
    return `"respuestas_desarrollo": {
    "P1": {
      "texto_estudiante": "CITA LITERAL de la respuesta a la pregunta 1",
      "justificacion": "síntesis pedagógica opcional",
      ${criterioBlock}
    },
    "P2": {
      "texto_estudiante": "CITA LITERAL de la respuesta a la pregunta 2",
      "justificacion": "síntesis pedagógica opcional",
      ${criterioBlock}
    }
  }`
  }

  return `"respuestas_desarrollo": {
    "P1": {
      "texto_estudiante": "CITA LITERAL de la evidencia del estudiante",
      "justificacion": "síntesis pedagógica opcional",
      ${criterioBlock}
    }
  }`
}

/** Prompt de un solo ítem para evaluateDevelopmentCriteriaCore (sin puntaje). Rubric-first. */
export function buildDevelopmentCriteriaCorePrompt(
  input: DevelopmentCriteriaCoreInput,
  parsedCriteria?: ParsedRubricCriterion[],
): string {
  const subjectLine = input.subject?.trim() ? `Área / asignatura: ${input.subject.trim()}\n` : ""
  const contextBlock = input.context?.trim()
    ? `\nCONTEXTO ADICIONAL:\n${input.context.trim()}\n`
    : ""

  const criteria = parsedCriteria ?? []
  const criteriaBlock =
    criteria.length > 0
      ? criteria
          .map((c, idx) => {
            const descLines =
              c.descriptors.length > 0
                ? c.descriptors
                    .map(
                      (d) =>
                        `    - [${d.ordinal}] ${d.level_label ? d.level_label + ": " : ""}${d.text}`,
                    )
                    .join("\n")
                : "    (descriptores en el fragmento de rúbrica)"
            return `CRITERIO ${idx + 1} (OBLIGATORIO — no renombrar ni omitir):
  criterion_id: ${c.criterion_id}
  criterion_label: ${c.criterion_label}
  Descriptores (superior → inferior):
${descLines}`
          })
          .join("\n\n")
      : "(sin criterios pre-parseados — no inventes taxonomía)"

  return `Actúa como un evaluador pedagógico experto. Tu rol es OBSERVAR evidencia y JUZGAR CADA criterio SOLO contra SUS descriptores. NO calcules puntaje numérico.

Ítem: ${input.item_key}
${subjectLine}
CONSIGNA / PREGUNTA:
${input.question_text || "(sin consigna explícita)"}

RÚBRICA ORIGINAL (referencia):
${input.rubric_text || "(rúbrica no proporcionada)"}
${contextBlock}
CRITERIOS OBLIGATORIOS (taxonomía fija — rubric-first):
${criteriaBlock}

EVIDENCIA DEL ESTUDIANTE (texto):
${input.student_text || ""}

REGLAS SAGRADAS:
- Debes devolver EXACTAMENTE ${criteria.length} criterios, en el mismo orden, con los criterion_id y criterion_label indicados arriba.
- PROHIBIDO inventar, fusionar, dividir o renombrar criterios.
- Evalúa CADA criterio EXCLUSIVAMENTE con: descriptor(es) de ESE criterio vs. evidencia observable de ESE criterio.
- PROHIBIDO: evaluar el texto en general; compensar un criterio con otro; subir nivel por calidad global; bajar nivel por errores no exigidos por ese criterio; usar información no observable.
- selected_level debe ser uno de: LOGRADO | PARCIALMENTE_LOGRADO | INSUFICIENTE | NO_OBSERVABLE
  (mapeo estructural: superior→LOGRADO, intermedio-alto→PARCIALMENTE_LOGRADO, intermedio-bajo/inferior→INSUFICIENTE; NO_OBSERVABLE solo si no hay evidencia observable).
- descriptor_selected: copia textual del descriptor que mejor corresponde al nivel elegido.
- evidence: solo lo observable en el texto del estudiante (cita o descripción verificable). Si vacío/ilegible → evidence "".
- missing_requirements: lista de requisitos del descriptor que NO se cumplen; derivar SOLO del descriptor, no del juicio global.
- Si la evidencia está en el límite entre dos descriptores contiguos, NO elijas por impresión: marca requisitos como PRESENT/ABSENT/NOT_OBSERVABLE con cita.
- NO calcules puntaje.

Responde ÚNICAMENTE con este JSON (sin markdown):
{
  "criterios_evaluados": [
    {
      "criterion_id": "${criteria[0]?.criterion_id ?? "…"}",
      "criterion_label": "${criteria[0]?.criterion_label ?? "…"}",
      "selected_level": "LOGRADO",
      "descriptor_selected": "texto del descriptor elegido",
      "evidence": "evidencia observable",
      "justification": "por qué ese nivel según el descriptor",
      "missing_requirements": []
    }
  ]
}`
}

/**
 * Sprint 34 — Prompt Etapa B: solo checklist de requisitos (sin elegir nivel).
 * La decisión de nivel la aplica decideBoundaryLevel de forma determinista.
 */
export function buildRequirementCheckPrompt(
  input: DevelopmentCriteriaCoreInput,
  rubricCriteria: ParsedRubricCriterion[],
  packsByCriterion: LevelRequirementPack[][],
): string {
  const subjectLine = input.subject?.trim() ? `Área / asignatura: ${input.subject.trim()}\n` : ""
  const contextBlock = input.context?.trim()
    ? `\nCONTEXTO ADICIONAL:\n${input.context.trim()}\n`
    : ""

  const criteriaBlock = rubricCriteria
    .map((c, idx) => {
      const packs = packsByCriterion[idx] ?? extractLevelRequirementPacks(c.descriptors)
      const reqBlock = packs
        .map((p) => {
          const lines: string[] = []
          for (const r of p.observable_requirements) {
            lines.push(`      - ordinal=${p.ordinal} kind=positive :: ${r}`)
          }
          for (const r of p.prohibited_or_absent_conditions ?? []) {
            lines.push(`      - ordinal=${p.ordinal} kind=problem_condition :: ${r}`)
          }
          if (lines.length === 0) {
            lines.push(`      - ordinal=${p.ordinal} kind=positive :: ${p.descriptor_text}`)
          }
          return `  [${p.ordinal}] ${p.level_label || "banda"}:\n${lines.join("\n")}`
        })
        .join("\n")
      return `CRITERIO ${idx + 1}:
  criterion_id: ${c.criterion_id}
  criterion_label: ${c.criterion_label}
${reqBlock}`
    })
    .join("\n\n")

  // Plantilla JSON con requisitos exactos (el modelo solo rellena status/quote/reason)
  const jsonTemplate = {
    criterios_evaluados: rubricCriteria.map((c, idx) => {
      const packs = packsByCriterion[idx] ?? extractLevelRequirementPacks(c.descriptors)
      const requirement_checks: Array<Record<string, unknown>> = []
      for (const p of packs) {
        for (const item of p.items) {
          requirement_checks.push({
            level_ordinal: p.ordinal,
            kind: item.kind,
            requirement: item.requirement,
            status: "NOT_OBSERVABLE",
            evidence_quote: "",
            reason: "",
          })
        }
      }
      return {
        criterion_id: c.criterion_id,
        criterion_label: c.criterion_label,
        evidence: "",
        requirement_checks,
      }
    }),
  }

  return `Actúa como observador pedagógico. NO elijas nivel de logro. Solo marca cada requisito listado.

Ítem: ${input.item_key}
${subjectLine}
CONSIGNA / PREGUNTA:
${input.question_text || "(sin consigna explícita)"}
${contextBlock}
EVIDENCIA DEL ESTUDIANTE (texto):
${input.student_text || ""}

REQUISITOS POR CRITERIO (extraídos de la rúbrica — no inventes otros):
${criteriaBlock}

REGLAS:
- Devuelve EXACTAMENTE el JSON plantilla de abajo (mismos criterion_id, mismos requirement strings).
- Solo cambia: status (PRESENT|ABSENT|NOT_OBSERVABLE), evidence_quote, reason, y evidence.
- PRESENT solo con evidence_quote citando el texto del estudiante.
- ABSENT si la evidencia muestra que falta o se contradice.
- NOT_OBSERVABLE si no puedes comprobarlo sin inferir.
- PROHIBIDO: elegir nivel; omitir requisitos; renombrar requisitos; inventar evidencia.

JSON plantilla (completa status/evidence_quote/reason/evidence):
${JSON.stringify(jsonTemplate)}`
}

// ---------------------------------------------------------------------------
// Parseo / validación mínima de shape (sin scoring)
// ---------------------------------------------------------------------------

const ALLOWED_NIVELES = new Set([
  "LOGRADO",
  "PARCIALMENTE_LOGRADO",
  "INSUFICIENTE",
  "NO_OBSERVABLE",
  "BOUNDARY_AMBIGUOUS",
])

function asTrimmedString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (value == null) return ""
  return String(value).trim()
}

function extractCriteriosArrayFromUnknown(raw: unknown): { list: unknown[]; parser_used: string } {
  if (Array.isArray(raw)) {
    return { list: raw, parser_used: "direct_array" }
  }
  if (!raw || typeof raw !== "object") {
    return { list: [], parser_used: "empty_non_object" }
  }
  const obj = raw as Record<string, unknown>
  if (Array.isArray(obj.criterios_evaluados)) {
    return { list: obj.criterios_evaluados, parser_used: "object.criterios_evaluados" }
  }
  const respuestas = obj.respuestas_desarrollo
  if (respuestas && typeof respuestas === "object" && !Array.isArray(respuestas)) {
    const merged: unknown[] = []
    for (const item of Object.values(respuestas as Record<string, unknown>)) {
      if (!item || typeof item !== "object") continue
      const list = (item as Record<string, unknown>).criterios_evaluados
      if (Array.isArray(list)) merged.push(...list)
    }
    return { list: merged, parser_used: "respuestas_desarrollo.*.criterios_evaluados" }
  }
  return { list: [], parser_used: "object_without_criterios" }
}

/**
 * Parsea y valida shape mínimo de criterios_evaluados.
 * Conserva nivel_logro tal cual si es válido; no inventa criterios.
 * Acepta aliases Sprint 33 (criterion_id / selected_level / evidence / justification).
 */
export function parseDevelopmentCriteriaEvaluados(raw: unknown): {
  criterios_evaluados: DevelopmentCriteriaEvaluated[]
  parser_used: string
  blocked: boolean
  blocked_reason?: string
} {
  const { list, parser_used } = extractCriteriosArrayFromUnknown(raw)

  if (list.length === 0) {
    return {
      criterios_evaluados: [],
      parser_used,
      blocked: false,
    }
  }

  const out: DevelopmentCriteriaEvaluated[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const c = entry as Record<string, unknown>
    const criterio_id = asTrimmedString(c.criterio_id ?? c.criterion_id)
    const criterio_label = asTrimmedString(c.criterio_label ?? c.criterion_label)
    const nivelRaw = asTrimmedString(c.nivel_logro ?? c.selected_level)
    const evidencia = asTrimmedString(c.evidencia ?? c.evidence)
    const justificacion = asTrimmedString(c.justificacion ?? c.justification)
    const descriptor_selected = asTrimmedString(c.descriptor_selected)
    const missingRaw = c.missing_requirements
    const missing_requirements = Array.isArray(missingRaw)
      ? missingRaw.map((x) => asTrimmedString(x)).filter(Boolean)
      : undefined
    const assessment_status = asTrimmedString(c.assessment_status)
    const idSource = asTrimmedString(c.criterion_id_source)

    // No inventar: exige al menos id o label (como el flujo actual que usa id/label)
    if (!criterio_id && !criterio_label) continue

    const nivel_logro = ALLOWED_NIVELES.has(nivelRaw) ? nivelRaw : nivelRaw

    const item: DevelopmentCriteriaEvaluated = {
      criterio_id: criterio_id || criterio_label,
      criterio_label: criterio_label || criterio_id,
      nivel_logro,
      evidencia,
      justificacion,
    }
    if (descriptor_selected) item.descriptor_selected = descriptor_selected
    if (missing_requirements) item.missing_requirements = missing_requirements
    if (assessment_status === "OBSERVABLE" || assessment_status === "NOT_OBSERVABLE") {
      item.assessment_status = assessment_status
    }
    if (
      idSource === "explicit_rubric_id" ||
      idSource === "explicit_position" ||
      idSource === "stable_label_position"
    ) {
      item.criterion_id_source = idSource
    }

    const checksRaw = c.requirement_checks
    if (Array.isArray(checksRaw)) {
      item.requirement_checks = checksRaw
        .filter((x) => x && typeof x === "object")
        .map((x) => {
          const r = x as Record<string, unknown>
          const status = asTrimmedString(r.status)
          return {
            requirement: asTrimmedString(r.requirement),
            status:
              status === "PRESENT" || status === "ABSENT" || status === "NOT_OBSERVABLE"
                ? status
                : "NOT_OBSERVABLE",
            evidence_quote: asTrimmedString(r.evidence_quote) || undefined,
            reason: asTrimmedString(r.reason),
            level_label: asTrimmedString(r.level_label) || undefined,
            level_ordinal:
              typeof r.level_ordinal === "number"
                ? r.level_ordinal
                : Number.isFinite(Number(r.level_ordinal))
                  ? Number(r.level_ordinal)
                  : undefined,
            kind:
              r.kind === "positive" || r.kind === "problem_condition"
                ? r.kind
                : undefined,
          } satisfies RequirementCheckRecord
        })
        .filter((x) => x.requirement)
    }

    out.push(item)
  }

  return {
    criterios_evaluados: out,
    parser_used,
    blocked: false,
  }
}

/** Fuerza IDs/labels/orden de la rúbrica parseada sobre la salida del proveedor. */
export function reconcileCriteriaToRubric(
  providerCriteria: DevelopmentCriteriaEvaluated[],
  rubricCriteria: ParsedRubricCriterion[],
): DevelopmentCriteriaEvaluated[] {
  return rubricCriteria.map((rc, i) => {
    const byId = providerCriteria.find((p) => p.criterio_id === rc.criterion_id)
    const byLabel = providerCriteria.find(
      (p) =>
        asTrimmedString(p.criterio_label).toLowerCase() ===
        rc.criterion_label.toLowerCase(),
    )
    const byIndex = providerCriteria[i]
    const src = byId ?? byLabel ?? byIndex

    const nivel = src?.nivel_logro && ALLOWED_NIVELES.has(src.nivel_logro)
      ? src.nivel_logro
      : src?.nivel_logro || "INSUFICIENTE"

    let descriptor_selected = src?.descriptor_selected ?? ""
    if (!descriptor_selected && rc.descriptors.length > 0) {
      // Heurística estructural: mapear nivel → banda ordinal
      const bandIdx =
        nivel === "LOGRADO"
          ? 0
          : nivel === "PARCIALMENTE_LOGRADO"
            ? Math.min(1, rc.descriptors.length - 1)
            : nivel === "NO_OBSERVABLE"
              ? -1
              : rc.descriptors.length - 1
      if (bandIdx >= 0) descriptor_selected = rc.descriptors[bandIdx]?.text ?? ""
    }

    return {
      criterio_id: rc.criterion_id,
      criterio_label: rc.criterion_label,
      criterion_id_source: rc.criterion_id_source,
      nivel_logro: nivel,
      evidencia: src?.evidencia ?? "",
      justificacion: src?.justificacion ?? "",
      descriptor_selected: descriptor_selected || undefined,
      missing_requirements: src?.missing_requirements ?? [],
      assessment_status: src?.assessment_status,
    }
  })
}

function buildNotObservableCriteria(
  rubricCriteria: ParsedRubricCriterion[],
): DevelopmentCriteriaEvaluated[] {
  return rubricCriteria.map((rc) => {
    const packs = extractLevelRequirementPacks(rc.descriptors)
    return {
      criterio_id: rc.criterion_id,
      criterio_label: rc.criterion_label,
      criterion_id_source: rc.criterion_id_source,
      nivel_logro: "NO_OBSERVABLE",
      evidencia: "",
      justificacion:
        "No hay evidencia observable del estudiante para contrastar con el descriptor de este criterio.",
      descriptor_selected: rc.descriptors[rc.descriptors.length - 1]?.text ?? "",
      missing_requirements: rc.descriptors[0]?.text
        ? [`No se observa: ${rc.descriptors[0].text.slice(0, 200)}`]
        : ["Evidencia del estudiante ausente o no observable"],
      assessment_status: "NOT_OBSERVABLE" as const,
      boundary_decision: "INSUFFICIENT_EVIDENCE" as const,
      present_requirements: [],
      absent_requirements: packs.flatMap((p) => p.observable_requirements),
      level_requirement_packs: packs.map((p) => ({
        level_label: p.level_label,
        observable_requirements: p.observable_requirements,
        prohibited_or_absent_conditions: p.prohibited_or_absent_conditions,
      })),
    }
  })
}

/**
 * Alinea checks del proveedor a los requisitos estructurales del pack.
 * Requisitos sin check → NOT_OBSERVABLE. Ignora requisitos inventados.
 * Matching tolerante a variaciones menores de fraseo del proveedor.
 */
function normalizeReqKey(s: string): string {
  return asTrimmedString(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function requirementsMatch(a: string, b: string): boolean {
  const na = normalizeReqKey(a)
  const nb = normalizeReqKey(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  // solapamiento de tokens significativos
  const ta = new Set(na.split(" ").filter((t) => t.length >= 4))
  const tb = new Set(nb.split(" ").filter((t) => t.length >= 4))
  if (ta.size === 0 || tb.size === 0) return false
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = new Set([...ta, ...tb]).size
  return inter / union >= 0.6
}

function alignChecksToPacks(
  packs: LevelRequirementPack[],
  providerChecks: RequirementCheckRecord[],
  fallbackEvidence?: string,
): RequirementCheck[] {
  const out: RequirementCheck[] = []
  const used = new Set<number>()

  for (const pack of packs) {
    for (const item of pack.items) {
      let matchIdx = -1
      for (let i = 0; i < providerChecks.length; i++) {
        if (used.has(i)) continue
        const c = providerChecks[i]
        const sameOrd = c.level_ordinal == null || c.level_ordinal === pack.ordinal
        if (!sameOrd) continue
        if (requirementsMatch(c.requirement, item.requirement)) {
          matchIdx = i
          break
        }
      }
      // Segundo pase: sin exigir ordinal (proveedor a menudo lo omite/erra)
      if (matchIdx < 0) {
        for (let i = 0; i < providerChecks.length; i++) {
          if (used.has(i)) continue
          if (requirementsMatch(providerChecks[i].requirement, item.requirement)) {
            matchIdx = i
            break
          }
        }
      }

      const match = matchIdx >= 0 ? providerChecks[matchIdx] : undefined
      if (matchIdx >= 0) used.add(matchIdx)

      out.push({
        requirement: item.requirement,
        level_ordinal: pack.ordinal,
        kind: item.kind,
        status: match?.status ?? "NOT_OBSERVABLE",
        evidence_quote: match?.evidence_quote,
        reason: match?.reason || "Sin check del proveedor → NOT_OBSERVABLE",
      })
    }
  }
  return sanitizeRequirementChecks(out, fallbackEvidence)
}

function applyBoundaryToCriterion(
  rc: ParsedRubricCriterion,
  packs: LevelRequirementPack[],
  providerItem: DevelopmentCriteriaEvaluated | undefined,
  hasEvidence: boolean,
  studentText?: string,
): DevelopmentCriteriaEvaluated {
  let aligned = alignChecksToPacks(
    packs,
    providerItem?.requirement_checks ?? [],
    providerItem?.evidencia,
  )
  // Evidencia inventada dura: solo degradar si la cita no comparte ningún token
  // significativo con el texto del estudiante (parafraseos cortos se permiten).
  const student = String(studentText ?? "").toLowerCase()
  if (student.length >= 8) {
    aligned = aligned.map((c) => {
      if (c.status !== "PRESENT") return c
      const quote = String(c.evidence_quote ?? "").trim().toLowerCase()
      if (!quote || quote.length < 8) return c
      const tokens = quote
        .replace(/[^a-záéíóúñü0-9\s]/gi, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 5)
      if (tokens.length === 0) return c
      const hit = tokens.filter((t) => student.includes(t)).length
      if (hit === 0) {
        return {
          ...c,
          status: "NOT_OBSERVABLE" as const,
          reason: `${c.reason} [cita sin anclaje léxico en texto estudiante → NOT_OBSERVABLE]`,
        }
      }
      return c
    })
  }
  const decision = decideBoundaryLevel({
    packs,
    checks: aligned,
    hasAnyStudentEvidence: hasEvidence,
  })

  return {
    criterio_id: rc.criterion_id,
    criterio_label: rc.criterion_label,
    criterion_id_source: rc.criterion_id_source,
    nivel_logro: decision.selected_level,
    evidencia: providerItem?.evidencia ?? "",
    justificacion: decision.justification,
    descriptor_selected: decision.descriptor_selected,
    missing_requirements: decision.absent_requirements,
    present_requirements: decision.present_requirements,
    absent_requirements: decision.absent_requirements,
    assessment_status:
      decision.decision === "INSUFFICIENT_EVIDENCE" ? "NOT_OBSERVABLE" : "OBSERVABLE",
    boundary_decision: decision.decision,
    recommended_level: decision.recommended_level,
    alternate_level: decision.alternate_level,
    ambiguity_reason: decision.ambiguity_reason,
    requirement_checks: aligned.map((c) => ({
      requirement: c.requirement,
      status: c.status,
      evidence_quote: c.evidence_quote,
      reason: c.reason,
      level_ordinal: c.level_ordinal,
      kind: c.kind,
    })),
    level_requirement_packs: packs.map((p) => ({
      level_label: p.level_label,
      observable_requirements: p.observable_requirements,
      prohibited_or_absent_conditions: p.prohibited_or_absent_conditions,
    })),
  }
}

function tryParseProviderJsonContent(content: string): unknown {
  const raw = String(content ?? "").trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf("{")
    const end = raw.lastIndexOf("}")
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Núcleo común: prompt → (IA | metadata existente) → parseo → criterios_evaluados[].
 * Si existing_item_metadata trae criterios_evaluados o raw_provider_output, no llama IA (modo compatibilidad).
 * Sprint 33: camino independiente = rubric-first + IDs estables + vacío preserva criterios.
 */
export async function evaluateDevelopmentCriteriaCore(
  input: DevelopmentCriteriaCoreInput,
): Promise<DevelopmentCriteriaCoreResult> {
  // No mutar entrada
  const safeInput: DevelopmentCriteriaCoreInput = {
    item_key: String(input.item_key ?? ""),
    question_text: String(input.question_text ?? ""),
    student_text: String(input.student_text ?? ""),
    rubric_text: String(input.rubric_text ?? ""),
    subject: input.subject,
    context: input.context,
    existing_item_metadata: input.existing_item_metadata
      ? deepCloneJson(input.existing_item_metadata)
      : undefined,
  }

  const meta = safeInput.existing_item_metadata

  // Modo compatibilidad: reutilizar salida ya producida por Solo Desarrollo (paridad exacta).
  if (meta && Array.isArray(meta.criterios_evaluados)) {
    const parsed = parseDevelopmentCriteriaEvaluados({
      criterios_evaluados: meta.criterios_evaluados,
    })
    return {
      criterios_evaluados: parsed.criterios_evaluados,
      raw_provider_output: { criterios_evaluados: meta.criterios_evaluados },
      diagnostics: {
        parser_used: `compat_metadata:${parsed.parser_used}`,
        criteria_count: parsed.criterios_evaluados.length,
        blocked: false,
      },
    }
  }

  if (meta && meta.raw_provider_output != null) {
    const parsed = parseDevelopmentCriteriaEvaluados(meta.raw_provider_output)
    return {
      criterios_evaluados: parsed.criterios_evaluados,
      raw_provider_output: meta.raw_provider_output,
      diagnostics: {
        parser_used: `compat_raw:${parsed.parser_used}`,
        criteria_count: parsed.criterios_evaluados.length,
        blocked: parsed.blocked,
        blocked_reason: parsed.blocked_reason,
      },
    }
  }

  // ——— Camino independiente (Sprint 33: rubric-first) ———
  const rubricParse = parseRubricCriteria(safeInput.rubric_text)

  if (rubricParse.status === "RUBRIC_EMPTY") {
    return {
      criterios_evaluados: [],
      diagnostics: {
        parser_used: "blocked_empty_rubric",
        criteria_count: 0,
        blocked: true,
        blocked_reason: "rubric_text_empty",
        rubric_parse_status: rubricParse.status,
        rubric_format: rubricParse.format,
      },
    }
  }

  if (rubricParse.status === "RUBRIC_CRITERIA_NOT_VERIFIABLE") {
    return {
      criterios_evaluados: [],
      diagnostics: {
        parser_used: "blocked_rubric_not_verifiable",
        criteria_count: 0,
        blocked: true,
        blocked_reason: "RUBRIC_CRITERIA_NOT_VERIFIABLE",
        rubric_parse_status: rubricParse.status,
        rubric_format: rubricParse.format,
      },
    }
  }

  const rubricCriteria = rubricParse.criteria

  // Vacío / ilegible: preservar criterios reales sin inventar evidencia.
  if (isStudentEvidenceNotObservable(safeInput.student_text)) {
    const criterios = buildNotObservableCriteria(rubricCriteria)
    return {
      criterios_evaluados: criterios,
      raw_provider_output: { criterios_evaluados: criterios, path: "empty_evidence_no_provider" },
      diagnostics: {
        parser_used: "empty_evidence_preserved_rubric_criteria",
        criteria_count: criterios.length,
        blocked: false,
        rubric_parse_status: rubricParse.status,
        rubric_format: rubricParse.format,
        criterion_ids_stable: true,
        empty_evidence_preserved_criteria: true,
        boundary_stage: true,
      },
    }
  }

  // Etapa A estructural (determinista): packs de requisitos por criterio
  const packsByCriterion = rubricCriteria.map((rc) =>
    extractLevelRequirementPacks(rc.descriptors),
  )
  const fp = packsByCriterion.map((p) => requirementsFingerprint(p)).join("||")

  const prompt = buildRequirementCheckPrompt(safeInput, rubricCriteria, packsByCriterion)

  let content: string
  try {
    const completion = await requestEvaluationTextCompletion({
      prompt,
      maxTokens: 6144,
      temperature: 0,
      // LAB only: checklist más largo que el prompt S33; timeout productivo intacto (default 25s).
      timeoutMs: Number(process.env.DEVELOPMENT_CORE_LAB_TIMEOUT_MS ?? "90000") || 90_000,
    })
    content = completion.content
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      criterios_evaluados: [],
      diagnostics: {
        parser_used: "provider_error",
        criteria_count: 0,
        blocked: true,
        blocked_reason: `provider_error:${msg.slice(0, 200)}`,
        rubric_parse_status: rubricParse.status,
        rubric_format: rubricParse.format,
        boundary_stage: true,
        requirements_fingerprint: fp,
      },
    }
  }

  const raw = tryParseProviderJsonContent(content)
  if (raw == null) {
    return {
      criterios_evaluados: [],
      raw_provider_output: content,
      diagnostics: {
        parser_used: "json_parse_failed",
        criteria_count: 0,
        blocked: true,
        blocked_reason: "provider_json_unparseable",
        rubric_parse_status: rubricParse.status,
        rubric_format: rubricParse.format,
        boundary_stage: true,
        requirements_fingerprint: fp,
      },
    }
  }

  const parsed = parseDevelopmentCriteriaEvaluados(raw)

  // Etapa B determinista: frontera por checklist (no por impresión del proveedor)
  const criterios = rubricCriteria.map((rc, i) => {
    const byId = parsed.criterios_evaluados.find((p) => p.criterio_id === rc.criterion_id)
    const byLabel = parsed.criterios_evaluados.find(
      (p) =>
        asTrimmedString(p.criterio_label).toLowerCase() ===
        rc.criterion_label.toLowerCase(),
    )
    const byIndex = parsed.criterios_evaluados[i]
    return applyBoundaryToCriterion(
      rc,
      packsByCriterion[i],
      byId ?? byLabel ?? byIndex,
      true,
      safeInput.student_text,
    )
  })

  return {
    criterios_evaluados: criterios,
    raw_provider_output: raw,
    diagnostics: {
      parser_used: `rubric_first_boundary:${parsed.parser_used}`,
      criteria_count: criterios.length,
      blocked: false,
      rubric_parse_status: rubricParse.status,
      rubric_format: rubricParse.format,
      criterion_ids_stable: true,
      empty_evidence_preserved_criteria: false,
      boundary_stage: true,
      requirements_fingerprint: fp,
    },
  }
}

/** Comparación campo a campo (cantidad, ids, labels, niveles, evidencia, justificación, orden). */
export function compareDevelopmentCriteriaParity(
  left: DevelopmentCriteriaEvaluated[],
  right: DevelopmentCriteriaEvaluated[],
): DevelopmentCriteriaParityComparison {
  const diffs: DevelopmentCriteriaParityDiff[] = []
  const count_match = left.length === right.length
  if (!count_match) {
    diffs.push({
      index: -1,
      field: "length",
      left: String(left.length),
      right: String(right.length),
    })
  }

  const n = Math.min(left.length, right.length)
  let order_match = count_match
  for (let i = 0; i < n; i++) {
    const a = left[i]
    const b = right[i]
    const fields: Array<keyof DevelopmentCriteriaEvaluated> = [
      "criterio_id",
      "criterio_label",
      "nivel_logro",
      "evidencia",
      "justificacion",
    ]
    for (const field of fields) {
      if (String(a[field] ?? "") !== String(b[field] ?? "")) {
        order_match = false
        diffs.push({
          index: i,
          field,
          left: String(a[field] ?? ""),
          right: String(b[field] ?? ""),
        })
      }
    }
  }

  return {
    equal: diffs.length === 0,
    count_match,
    order_match,
    diffs,
  }
}

export type ApplyDevelopmentCriteriaCoreToRecordInput = {
  respuestasDesarrollo: Record<string, unknown>
  rubrica?: string | null
  subject?: string | null
  /** Solo aplicar cuando Solo Desarrollo (plan.applies). */
  soloDesarrolloApplies: boolean
}

export type ApplyDevelopmentCriteriaCoreToRecordResult = {
  respuestasDesarrollo: Record<string, unknown>
  coreApplied: boolean
  shadowCompared: boolean
  parityEqual: boolean | null
  diagnostics: Array<{
    item_key: string
    criteria_count: number
    parser_used: string
    blocked: boolean
    blocked_reason?: string
    parity_equal?: boolean
  }>
}

function extractStudentTextFromItem(item: Record<string, unknown>): string {
  const t = item.texto_estudiante ?? item.cita_estudiante ?? ""
  return typeof t === "string" ? t : String(t ?? "")
}

/**
 * Wiring Solo Desarrollo (sync, fail-open):
 * - flags false → no-op (camino inline anterior)
 * - PARITY_SHADOW → compara núcleo (compat) vs criterios actuales; NO muta oficial
 * - ENABLED → reemplaza criterios por salida del núcleo en modo compat (misma fuente → paridad)
 *
 * No ejecuta Mechanical/Repair/Invariants. No corre en Mixta (soloDesarrolloApplies=false).
 */
export function applyDevelopmentCriteriaCoreToSoloDesarrolloRecord(
  input: ApplyDevelopmentCriteriaCoreToRecordInput,
): ApplyDevelopmentCriteriaCoreToRecordResult {
  const enabled = isDevelopmentCriteriaCoreEnabled()
  const shadow = isDevelopmentCriteriaCoreParityShadowEnabled()

  if (!input.soloDesarrolloApplies || (!enabled && !shadow)) {
    return {
      respuestasDesarrollo: input.respuestasDesarrollo,
      coreApplied: false,
      shadowCompared: false,
      parityEqual: null,
      diagnostics: [],
    }
  }

  if (!input.respuestasDesarrollo || typeof input.respuestasDesarrollo !== "object") {
    return {
      respuestasDesarrollo: {},
      coreApplied: false,
      shadowCompared: false,
      parityEqual: null,
      diagnostics: [],
    }
  }

  const diagnostics: ApplyDevelopmentCriteriaCoreToRecordResult["diagnostics"] = []
  let allParityEqual = true
  let anyShadow = false

  const out: Record<string, unknown> = enabled ? {} : input.respuestasDesarrollo

  for (const [key, val] of Object.entries(input.respuestasDesarrollo)) {
    if (!val || typeof val !== "object") {
      if (enabled) out[key] = val
      continue
    }

    const item = val as Record<string, unknown>
    const existingCriteria = Array.isArray(item.criterios_evaluados)
      ? item.criterios_evaluados
      : []

    const coreInput: DevelopmentCriteriaCoreInput = {
      item_key: key,
      question_text: asTrimmedString(item.pregunta ?? item.consigna ?? key),
      student_text: extractStudentTextFromItem(item),
      rubric_text: String(input.rubrica ?? ""),
      subject: input.subject ?? undefined,
      existing_item_metadata: {
        criterios_evaluados: existingCriteria,
      },
    }

    // Compat sync: misma fuente → parseo del núcleo sin segunda llamada IA.
    const parsed = parseDevelopmentCriteriaEvaluados({
      criterios_evaluados: coreInput.existing_item_metadata!.criterios_evaluados,
    })

    const left = parseDevelopmentCriteriaEvaluados({
      criterios_evaluados: existingCriteria,
    }).criterios_evaluados
    const right = parsed.criterios_evaluados
    const parity = compareDevelopmentCriteriaParity(left, right)

    if (shadow) {
      anyShadow = true
      if (!parity.equal) allParityEqual = false
      console.info("[development-criteria-core][parity-shadow]", {
        item_key: key,
        equal: parity.equal,
        count_left: left.length,
        count_right: right.length,
        diffs: parity.diffs.slice(0, 8),
      })
    }

    diagnostics.push({
      item_key: key,
      criteria_count: parsed.criterios_evaluados.length,
      parser_used: parsed.parser_used,
      blocked: parsed.blocked,
      blocked_reason: parsed.blocked_reason,
      parity_equal: parity.equal,
    })

    if (enabled) {
      // Paridad exacta: si el parseo del núcleo coincide, conservar el array original (sin reinventar shape).
      out[key] = {
        ...item,
        criterios_evaluados: parity.equal ? existingCriteria : parsed.criterios_evaluados,
      }
    }
  }

  // Shadow no muta el resultado oficial.
  if (shadow && !enabled) {
    return {
      respuestasDesarrollo: input.respuestasDesarrollo,
      coreApplied: false,
      shadowCompared: anyShadow,
      parityEqual: anyShadow ? allParityEqual : null,
      diagnostics,
    }
  }

  return {
    respuestasDesarrollo: enabled ? out : input.respuestasDesarrollo,
    coreApplied: enabled,
    shadowCompared: anyShadow,
    parityEqual: anyShadow ? allParityEqual : null,
    diagnostics,
  }
}
