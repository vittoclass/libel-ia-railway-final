import { normalizePedagogicalText } from "@/app/lib/analyze-learning-results"
import { formatPedagogicalReadableText } from "@/app/lib/pedagogical-export-formatting"

function countDistinctZeroDimensions(
  by_axis: Array<{ dimension_value: string; logro_pct: number | null }>,
  by_skill: Array<{ dimension_value: string; logro_pct: number | null }>
): number {
  const seen = new Set<string>()
  for (const r of [...by_axis, ...by_skill]) {
    if (typeof r.logro_pct !== "number" || !Number.isFinite(r.logro_pct)) continue
    if (Math.round(r.logro_pct) !== 0) continue
    seen.add(normalizePedagogicalText(r.dimension_value))
  }
  return seen.size
}

export type StrategicInferenceInput = {
  // PHASE_3_INFERENCE_SECURITY_V1
  by_axis: Array<{ dimension_value: string; logro_pct: number | null }>
  // PHASE_3_INFERENCE_SECURITY_V1
  by_skill: Array<{ dimension_value: string; logro_pct: number | null }>
  // PHASE_3_INFERENCE_SECURITY_V1
  overall_logro_pct: number | null
  // PHASE_3_INFERENCE_SECURITY_V1
  z_score_course: number | null
  // PHASE_3_INFERENCE_SECURITY_V1
  simce_level: "Insuficiente" | "Elemental" | "Adecuado" | null
  // PHASE_4_MEMORY_IDENTITY_V1
  delta_overall_pct?: number | null
  // PHASE_4_MEMORY_IDENTITY_V1
  delta_by_axis?: Array<{ axis: string; delta_pct: number | null }>
  // PHASE_4_MEMORY_IDENTITY_V1
  delta_by_skill?: Array<{ skill: string; delta_pct: number | null }>
}

export type StrategicInferenceOutput = {
  // PHASE_3_INFERENCE_SECURITY_V1
  paragraph: string
  // PHASE_3_INFERENCE_SECURITY_V1
  key_gap: {
    numbers_pct: number | null
    modelacion_pct: number | null
    overall_pct: number | null
    z_score_course: number | null
    simce_level: "Insuficiente" | "Elemental" | "Adecuado" | null
  }
  // PHASE_4_MEMORY_IDENTITY_V1
  delta?: {
    overall_pct: number | null
    top_axis_progress: { axis: string; delta_pct: number | null } | null
    top_skill_progress: { skill: string; delta_pct: number | null } | null
  }
}

function pickPctByKeyword(
  rows: Array<{ dimension_value: string; logro_pct: number | null }>,
  keyword: string
): number | null {
  // PHASE_3_INFERENCE_SECURITY_V1
  const key = normalizePedagogicalText(keyword)
  const found = rows.find((r) => normalizePedagogicalText(r.dimension_value).includes(key))
  return typeof found?.logro_pct === "number" ? Math.round(found.logro_pct) : null
}

function formatPct(v: number | null): string {
  // PHASE_3_INFERENCE_SECURITY_V1
  return v == null ? "—" : `${Math.round(v)}%`
}

function formatZ(v: number | null): string {
  // PHASE_3_INFERENCE_SECURITY_V1
  return v == null || !Number.isFinite(v) ? "—" : `${v.toFixed(2)}`
}

export function generateStrategicAnalysis(input: StrategicInferenceInput): StrategicInferenceOutput {
  // PHASE_3_INFERENCE_SECURITY_V1
  const numbersPct = pickPctByKeyword(input.by_axis, "NUMEROS")
  // PHASE_3_INFERENCE_SECURITY_V1
  const modelacionPct = pickPctByKeyword(input.by_skill, "MODELACION")
  // PHASE_3_INFERENCE_SECURITY_V1
  const overallPct = typeof input.overall_logro_pct === "number" ? Math.round(input.overall_logro_pct) : null
  // PHASE_3_INFERENCE_SECURITY_V1
  const simceLevel = input.simce_level ?? "Insuficiente"
  const multiAreaZero = countDistinctZeroDimensions(input.by_axis, input.by_skill) >= 2

  // PHASE_3_INFERENCE_SECURITY_V1
  const hasGap =
    (numbersPct != null && numbersPct >= 33 && modelacionPct != null && modelacionPct <= 0) ||
    (numbersPct != null && numbersPct >= 40 && modelacionPct != null && modelacionPct <= 10)

  // PHASE_3_INFERENCE_SECURITY_V1
  const zRiskText =
    input.z_score_course != null && input.z_score_course <= -0.8
      ? "La posición relativa del estudiante se ubica por debajo del promedio del curso."
      : input.z_score_course != null && input.z_score_course >= 0.8
        ? "La posición relativa del estudiante se ubica por encima del promedio del curso, aunque persiste una brecha específica."
        : "La posición relativa del estudiante se mantiene en un rango cercano al promedio del curso."

  // PHASE_4_MEMORY_IDENTITY_V1
  const topAxisProgress =
    input.delta_by_axis && input.delta_by_axis.length > 0
      ? [...input.delta_by_axis]
          .filter((x) => typeof x.delta_pct === "number")
          .sort((a, b) => Number(b.delta_pct) - Number(a.delta_pct))[0] ?? null
      : null
  // PHASE_4_MEMORY_IDENTITY_V1
  const topSkillProgress =
    input.delta_by_skill && input.delta_by_skill.length > 0
      ? [...input.delta_by_skill]
          .filter((x) => typeof x.delta_pct === "number")
          .sort((a, b) => Number(b.delta_pct) - Number(a.delta_pct))[0] ?? null
      : null
  // PHASE_4_MEMORY_IDENTITY_V1
  const deltaSentence =
    input.delta_overall_pct == null
      ? ""
      : ` En perspectiva longitudinal, el cambio respecto de la evaluación inmediatamente anterior es de ${formatPct(Math.round(input.delta_overall_pct))} en logro global${
          topAxisProgress && topAxisProgress.delta_pct != null
            ? `, destacando la variación en ${formatPedagogicalReadableText(topAxisProgress.axis)} (${formatPct(topAxisProgress.delta_pct)})`
            : ""
        }${
          topSkillProgress && topSkillProgress.delta_pct != null
            ? ` y en ${formatPedagogicalReadableText(topSkillProgress.skill)} (${formatPct(topSkillProgress.delta_pct)}).`
            : "."
        }`

  // PHASE_3_INFERENCE_SECURITY_V1
  const paragraphHomogeneous = `Desde una perspectiva técnico-pedagógica, el perfil evidencia un desempeño más homogéneo entre ejes y habilidades, con logro global de ${formatPct(overallPct)} y nivel proyectado ${simceLevel.toUpperCase()}. ${zRiskText} La recomendación prioritaria es sostener la consolidación conceptual y aumentar la práctica de resolución contextualizada para proteger la estabilidad del desempeño en evaluaciones estandarizadas.${deltaSentence}`
  const paragraphMultiZero = `Desde una perspectiva técnico-pedagógica, el perfil muestra logro nulo o crítico en varias dimensiones del instrumento, lo que indica que requiere intervención prioritaria en múltiples dimensiones. Con logro global de ${formatPct(overallPct)} y nivel proyectado ${simceLevel.toUpperCase()}, conviene ordenar un plan de refuerzo transversal y dar seguimiento en la evaluación siguiente. ${zRiskText} La recomendación prioritaria es priorizar las brechas más severas sin descuidar el resto de los ejes.${deltaSentence}`

  const paragraph = hasGap
    ? `Desde una perspectiva técnico-pedagógica, se observa una brecha de transferencia: el desempeño en NÚMEROS alcanza ${formatPct(numbersPct)}, mientras que en MODELACIÓN registra ${formatPct(modelacionPct)}. Este patrón sugiere dominio de procedimientos y cálculo, pero dificultades para traducir situaciones contextualizadas a representaciones matemáticas y justificar decisiones de resolución. ${zRiskText} Con un logro global de ${formatPct(overallPct)} y nivel proyectado ${simceLevel.toUpperCase()}, el riesgo principal para SIMCE se concentra en tareas que exigen modelar, interpretar y validar resultados en contexto.${deltaSentence}`
    : multiAreaZero
      ? paragraphMultiZero
      : paragraphHomogeneous

  return {
    paragraph,
    key_gap: {
      numbers_pct: numbersPct,
      modelacion_pct: modelacionPct,
      overall_pct: overallPct,
      z_score_course: input.z_score_course,
      simce_level: input.simce_level,
    },
    delta: {
      overall_pct: input.delta_overall_pct ?? null,
      top_axis_progress: topAxisProgress ?? null,
      top_skill_progress: topSkillProgress ?? null,
    },
  }
}
