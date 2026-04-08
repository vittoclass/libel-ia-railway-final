/**
 * Diccionario de evaluación: Habilidad (por asignatura) → Eje temático → Indicador SIMCE/PAES (referencial).
 * Referencia alineada al catálogo pedagógico sembrado en pedagogy_axes / pedagogy_skills.
 */

export type ChileSkillTrace = {
  subject: string
  skill_label: string
  eje_tematico: string
  indicador_simce_paes_code: string
  indicador_simce_paes_descriptor: string
}

function normalizeKeyPart(v: string): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** Clave interna subject|habilidad (sin acentos, minúsculas). */
export function chileDictionaryKey(subject: string, skillLabel: string): string {
  return `${normalizeKeyPart(subject)}|${normalizeKeyPart(skillLabel)}`
}

const MAP: Record<string, Omit<ChileSkillTrace, "subject" | "skill_label">> = {
  // ——— Lenguaje · Comprensión lectora ———
  "lenguaje|localizar informacion": {
    eje_tematico: "Comprensión lectora",
    indicador_simce_paes_code: "SIMCE-CL-01",
    indicador_simce_paes_descriptor: "Localiza información explícita en textos continuos.",
  },
  "lenguaje|inferir informacion": {
    eje_tematico: "Comprensión lectora",
    indicador_simce_paes_code: "SIMCE-CL-02",
    indicador_simce_paes_descriptor: "Inferencia y elaboración de significados implícitos.",
  },
  "lenguaje|interpretar": {
    eje_tematico: "Comprensión lectora",
    indicador_simce_paes_code: "SIMCE-CL-03",
    indicador_simce_paes_descriptor: "Interpretación de relaciones y propósitos en el texto.",
  },
  "lenguaje|evaluar": {
    eje_tematico: "Comprensión lectora",
    indicador_simce_paes_code: "SIMCE-CL-04",
    indicador_simce_paes_descriptor: "Evaluación crítica de contenidos y posturas del texto.",
  },
  // ——— Lenguaje · Análisis de textos ———
  "lenguaje|reconocer estructura textual": {
    eje_tematico: "Análisis de textos",
    indicador_simce_paes_code: "SIMCE-AT-01",
    indicador_simce_paes_descriptor: "Reconocimiento de estructura y organización textual.",
  },
  "lenguaje|identificar tipo de texto": {
    eje_tematico: "Análisis de textos",
    indicador_simce_paes_code: "SIMCE-AT-02",
    indicador_simce_paes_descriptor: "Identificación de género, formato y situación comunicativa.",
  },
  "lenguaje|analizar narrador o hablante": {
    eje_tematico: "Análisis de textos",
    indicador_simce_paes_code: "SIMCE-AT-03",
    indicador_simce_paes_descriptor: "Análisis de voz narrativa y punto de vista.",
  },
  "lenguaje|analizar recursos expresivos": {
    eje_tematico: "Análisis de textos",
    indicador_simce_paes_code: "SIMCE-AT-04",
    indicador_simce_paes_descriptor: "Análisis de figuras y recursos lingüísticos.",
  },
  "lenguaje|identificar proposito comunicativo": {
    eje_tematico: "Análisis de textos",
    indicador_simce_paes_code: "SIMCE-AT-05",
    indicador_simce_paes_descriptor: "Identificación de intención y destinatario.",
  },
  // ——— Lenguaje · Escritura ———
  "lenguaje|organizacion de ideas": {
    eje_tematico: "Escritura",
    indicador_simce_paes_code: "SIMCE-ES-01",
    indicador_simce_paes_descriptor: "Organización macro y microtextual de ideas.",
  },
  "lenguaje|coherencia": {
    eje_tematico: "Escritura",
    indicador_simce_paes_code: "SIMCE-ES-02",
    indicador_simce_paes_descriptor: "Coherencia semántica en la producción escrita.",
  },
  "lenguaje|cohesion": {
    eje_tematico: "Escritura",
    indicador_simce_paes_code: "SIMCE-ES-03",
    indicador_simce_paes_descriptor: "Mecanismos de cohesión textual.",
  },
  "lenguaje|adecuacion al proposito": {
    eje_tematico: "Escritura",
    indicador_simce_paes_code: "SIMCE-ES-04",
    indicador_simce_paes_descriptor: "Adecuación al propósito y contexto comunicativo.",
  },
  "lenguaje|uso de vocabulario": {
    eje_tematico: "Escritura",
    indicador_simce_paes_code: "SIMCE-ES-05",
    indicador_simce_paes_descriptor: "Precisión y riqueza léxica.",
  },
  // ——— Lenguaje · Reflexión sobre la lengua ———
  "lenguaje|gramatica en contexto": {
    eje_tematico: "Reflexión sobre la lengua",
    indicador_simce_paes_code: "SIMCE-RL-01",
    indicador_simce_paes_descriptor: "Gramática y morfosintaxis en uso.",
  },
  "lenguaje|ortografia": {
    eje_tematico: "Reflexión sobre la lengua",
    indicador_simce_paes_code: "SIMCE-RL-02",
    indicador_simce_paes_descriptor: "Ortografía y convenciones gráficas.",
  },
  "lenguaje|puntuacion": {
    eje_tematico: "Reflexión sobre la lengua",
    indicador_simce_paes_code: "SIMCE-RL-03",
    indicador_simce_paes_descriptor: "Uso de signos de puntuación.",
  },
  "lenguaje|uso de conectores": {
    eje_tematico: "Reflexión sobre la lengua",
    indicador_simce_paes_code: "SIMCE-RL-04",
    indicador_simce_paes_descriptor: "Conectores y marcadores discursivos.",
  },
  "lenguaje|uso adecuado del registro": {
    eje_tematico: "Reflexión sobre la lengua",
    indicador_simce_paes_code: "SIMCE-RL-05",
    indicador_simce_paes_descriptor: "Registro y norma lingüística.",
  },
  // ——— Matemática · Números y operaciones ———
  "matematica|operaciones basicas": {
    eje_tematico: "Números y operaciones",
    indicador_simce_paes_code: "PAES-MAT-NO-01",
    indicador_simce_paes_descriptor: "Operaciones con números racionales y enteros.",
  },
  "matematica|calculo mental": {
    eje_tematico: "Números y operaciones",
    indicador_simce_paes_code: "PAES-MAT-NO-02",
    indicador_simce_paes_descriptor: "Estrategias de cálculo mental y estimación.",
  },
  "matematica|estimacion": {
    eje_tematico: "Números y operaciones",
    indicador_simce_paes_code: "PAES-MAT-NO-03",
    indicador_simce_paes_descriptor: "Estimación y orden de magnitud.",
  },
  "matematica|proporcionalidad": {
    eje_tematico: "Números y operaciones",
    indicador_simce_paes_code: "PAES-MAT-NO-04",
    indicador_simce_paes_descriptor: "Razón, proporción y porcentaje.",
  },
  "matematica|fracciones y decimales": {
    eje_tematico: "Números y operaciones",
    indicador_simce_paes_code: "PAES-MAT-NO-05",
    indicador_simce_paes_descriptor: "Fracciones, decimales y representaciones.",
  },
  // ——— Matemática · Álgebra y funciones ———
  "matematica|identificar patrones": {
    eje_tematico: "Álgebra y funciones",
    indicador_simce_paes_code: "PAES-MAT-AF-01",
    indicador_simce_paes_descriptor: "Patrones, secuencias y regularidades.",
  },
  "matematica|resolver ecuaciones": {
    eje_tematico: "Álgebra y funciones",
    indicador_simce_paes_code: "PAES-MAT-AF-02",
    indicador_simce_paes_descriptor: "Ecuaciones e inecuaciones.",
  },
  "matematica|modelar situaciones": {
    eje_tematico: "Álgebra y funciones",
    indicador_simce_paes_code: "PAES-MAT-AF-03",
    indicador_simce_paes_descriptor: "Modelación algebraica de contextos.",
  },
  "matematica|interpretar funciones": {
    eje_tematico: "Álgebra y funciones",
    indicador_simce_paes_code: "PAES-MAT-AF-04",
    indicador_simce_paes_descriptor: "Interpretación gráfica y simbólica de funciones.",
  },
  "matematica|relaciones algebraicas": {
    eje_tematico: "Álgebra y funciones",
    indicador_simce_paes_code: "PAES-MAT-AF-05",
    indicador_simce_paes_descriptor: "Relaciones entre variables y representaciones algebraicas.",
  },
  // ——— Matemática · Geometría (catálogo sembrado) ———
  "matematica|reconocimiento de figuras": {
    eje_tematico: "Geometría",
    indicador_simce_paes_code: "PAES-MAT-GEO-01",
    indicador_simce_paes_descriptor: "Propiedades y clasificación de figuras.",
  },
  "matematica|perimetro y area": {
    eje_tematico: "Geometría",
    indicador_simce_paes_code: "PAES-MAT-GEO-02",
    indicador_simce_paes_descriptor: "Perímetro, área y unidades de medida.",
  },
  "matematica|propiedades geometricas": {
    eje_tematico: "Geometría",
    indicador_simce_paes_code: "PAES-MAT-GEO-03",
    indicador_simce_paes_descriptor: "Ángulos, paralelismo y congruencia.",
  },
  "matematica|transformaciones geometricas": {
    eje_tematico: "Geometría",
    indicador_simce_paes_code: "PAES-MAT-GEO-04",
    indicador_simce_paes_descriptor: "Transformaciones isométricas y composición.",
  },
  "matematica|visualizacion espacial": {
    eje_tematico: "Geometría",
    indicador_simce_paes_code: "PAES-MAT-GEO-05",
    indicador_simce_paes_descriptor: "Representación 2D/3D y vistas.",
  },
  // ——— Matemática · Datos y probabilidad (catálogo sembrado) ———
  "matematica|interpretar graficos": {
    eje_tematico: "Datos y probabilidad",
    indicador_simce_paes_code: "PAES-MAT-DP-01",
    indicador_simce_paes_descriptor: "Interpretación de gráficos estadísticos.",
  },
  "matematica|analizar tablas": {
    eje_tematico: "Datos y probabilidad",
    indicador_simce_paes_code: "PAES-MAT-DP-02",
    indicador_simce_paes_descriptor: "Lectura y análisis de tablas de datos.",
  },
  "matematica|probabilidad basica": {
    eje_tematico: "Datos y probabilidad",
    indicador_simce_paes_code: "PAES-MAT-DP-03",
    indicador_simce_paes_descriptor: "Probabilidad frecuentista básica.",
  },
  "matematica|analisis de tendencias": {
    eje_tematico: "Datos y probabilidad",
    indicador_simce_paes_code: "PAES-MAT-DP-04",
    indicador_simce_paes_descriptor: "Tendencia, dispersión y comparación de distribuciones.",
  },
  "matematica|toma de decisiones con datos": {
    eje_tematico: "Datos y probabilidad",
    indicador_simce_paes_code: "PAES-MAT-DP-05",
    indicador_simce_paes_descriptor: "Argumentación con evidencia estadística.",
  },
}

/**
 * Resuelve traza curricular para una habilidad mostrada en reportes (etiqueta visible).
 * `subject` típico: Lenguaje | Matemática.
 */
export function resolveChileSkillTrace(subject: string, skillLabel: string): ChileSkillTrace | null {
  const key = chileDictionaryKey(subject, skillLabel)
  const row = MAP[key]
  if (!row) return null
  return {
    subject: subject.trim() || "—",
    skill_label: skillLabel.trim() || "—",
    ...row,
  }
}

/**
 * Código compacto ministerial para tablas ejecutivas (ej: LE03, MA04).
 * Se deriva del indicador SIMCE/PAES del diccionario.
 */
export function resolveChileMinisterialSkillCode(subject: string, skillLabel: string): string | null {
  const trace = resolveChileSkillTrace(subject, skillLabel)
  if (!trace) return null
  const subjectNorm = normalizeKeyPart(subject)
  const prefix = subjectNorm.includes("mat") ? "MA" : "LE"
  const n = trace.indicador_simce_paes_code.match(/(\d{2})$/)?.[1]
  if (!n) return null
  return `${prefix}${n}`
}

/**
 * Asignatura principal inferida para lookup (sin romper otras asignaturas).
 */
export function inferSubjectForChileDictionary(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().toLowerCase()
  if (s.includes("mat")) return "Matemática"
  if (s.includes("leng")) return "Lenguaje"
  return raw?.trim() || "Lenguaje"
}
