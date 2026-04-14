/**
 * SmartBaseParser — motor de extracción asistida por IA para prueba base.
 * Módulo aislado: no altera OMR, importadores legacy ni esquema Supabase.
 * La ruta /api/source-exams/smart-extract consume este archivo.
 *
 * Política global del extractor (cualquier PDF/DOCX: prueba, pauta, rúbrica, instrumento mixto):
 * 1) Pasada 1: máxima completitud de ítems (preguntas, criterios, filas evaluables) — formato JSON compacto.
 * 2) Pasada 2: enriquecimiento pedagógico anclado a asignatura (subject en BD o heurística); sin etiquetas genéricas inútiles; null si no hay evidencia.
 * 3) No descartar ítems por falta de metadatos pedagógicos; ítems siguen completos aunque eje/habilidad queden null.
 */


/** Umbral de confianza en servidor: por debajo, el campo se anula (pilotaje 0.75). */
export const SMART_EXTRACT_CONFIDENCE_THRESHOLD = 0.75

/** Llaves alineadas a columnas persistibles de `source_exam_items` (sin id, source_exam_id, timestamps). */
export type SmartExtractItemPublic = {
  item_number: number | null
  item_text: string | null
  axis_id: string | null
  skill_id: string | null
  axis_label: string | null
  skill_label: string | null
  cognitive_level: string | null
  competence: string | null
  difficulty: string | null
  question_type: string | null
  correct_answer: string | null
  max_score: number | null
  rubric_text: string | null
  /** True si eje/habilidad/nivel cognitivo vinieron de la 2.ª pasada (inferencia). */
  pedagogy_inferred?: boolean
}

type FieldConfidenceKey =
  | "item_text"
  | "correct_answer"
  | "axis_label"
  | "skill_label"
  | "cognitive_level"
  | "competence"
  | "difficulty"
  | "question_type"
  | "max_score"
  | "rubric_text"
  | "axis_id"
  | "skill_id"

const ALLOWED_QUESTION_TYPES = new Set([
  "multiple_choice",
  "true_false",
  "short_answer",
  "essay",
  "completion",
])

/** Pasada 1 (compacta): prioridad = extraer todos los ítems evaluables; sin confidence ni metadatos pedagógicos. */
export const SMART_EXTRACT_STAGE1_SYSTEM_PROMPT = `Eres un extractor de documentos educativos. Recibirás TEXTO extraído de PDF o Word (posible ruido OCR).

Tarea: listar TODOS los ítems evaluables del archivo: preguntas, subpreguntas, ítems de pauta/gabarito, criterios o descriptores de rúbrica, filas de instrumentos mixtos, etc. Prioridad absoluta: COMPLETITUD del conjunto real del documento (no omitas ítems para acortar la respuesta).

Devuelve SOLO un JSON válido (sin markdown, sin texto fuera del JSON).

Formato OBLIGATORIO (por ítem solo estas claves; omite claves que serían null para ahorrar tokens):
{
  "items": [
    {
      "item_number": <entero >= 1>,
      "item_text": "<texto completo del ítem: enunciado, criterio, descriptor o alternativas A/B/C… si van en el mismo bloque>",
      "correct_answer": "<una letra A-E, o V/F, solo si hay pauta/gabarito explícito en el documento; si no, omite la clave>",
      "question_type": "<multiple_choice | true_false | short_answer | essay | completion; omite si no está claro; para criterios de rúbrica suele ser essay o short_answer>",
      "max_score": <entero >= 0 solo si aparece puntaje o ponderación; si no, omite>,
      "rubric_text": "<fragmento de rúbrica o escala asociada al ítem si aplica; si no, omite>"
    }
  ]
}

REGLAS:
1) Un único objeto con clave "items" (arreglo). Incluye TODOS los ítems en orden de aparición (numeración del documento, o 1,2,3… si no hay números).
2) NO incluyas: confidence, axis_id, skill_id, axis_label, skill_label, cognitive_level, competence, difficulty.
3) Si el documento mezcla prueba + pauta + rúbrica, extrae cada unidad evaluable como un ítem; no fusiones dos preguntas distintas en una sola fila.
4) item_text: fiel al documento; no inventes enunciados que no estén sustentados en el texto.
5) correct_answer solo con evidencia explícita en el texto (clave, gabarito, pauta).
6) JSON compacto (sin comentarios; evita espacios innecesarios si puedes).

Responde únicamente con el JSON.`

/** Pasada 2: inferir eje, habilidad y nivel cognitivo; asignatura y ejes de referencia vienen en el JSON de usuario. */
export const SMART_EXTRACT_ENRICH_SYSTEM_PROMPT = `Eres un asistente pedagógico para evaluación escolar en español (Chile, aula). Recibirás un JSON con:
- document_subject: asignatura declarada o inferida (puede ser null).
- subject_source: "source_exams" | "metadata" | "heuristic" | "none".
- axis_hints: lista de ejes típicos para esa asignatura (puede estar vacía).
- items: cada uno con item_number, question_type, item_text (puede ir truncado por límite técnico) y a veces rubric_context.

Decisión obligatoria (criterio docente):
Debes asignar axis_label, skill_label y cognitive_level a CADA ítem usando la mejor categoría posible según el contenido. Aunque la evidencia no sea perfecta, elige la opción más razonable. Evita dejar esos campos en null salvo que el ítem sea ilegible, esté vacío o sea totalmente ininterpretable.

Guía obligatoria por asignatura:
- Usa document_subject como marco: el eje y la habilidad deben ser coherentes con esa disciplina. Si document_subject es null, infiere con el texto del ítem y las pistas del documento.
- Si axis_hints no está vacío, prioriza elegir uno de esos ejes cuando encaje; si ninguno encaja del todo, elige el más cercano o, solo entonces, otro eje específico de la misma asignatura (nunca genérico prohibido).

Campos por fila en enrichments:
- axis_label: eje o bloque temático concreto (p. ej. Matemática: Números y operaciones, Álgebra, Geometría).
- skill_label: proceso observable y específico (p. ej. calcular, resolver un problema, interpretar un gráfico, argumentar).
- cognitive_level: exactamente uno de: recordar | comprender | aplicar | analizar | evaluar | crear — el nivel Bloom más razonable para la tarea, sin exigir cita textual en el documento.
- pedagogy_inferred: true cuando los tres campos anteriores son strings no vacíos (caso esperado). false solo si debiste usar null en alguno por ítem ilegible o imposible de interpretar.

PROHIBIDO como axis_label o skill_label (usa en su lugar una etiqueta concreta de la asignatura, no null por pereza): "General", "Análisis del ítem", "Otros", "Otro", "N/A", "Varios", "Contenido general", "Ítem", placeholders o equivalentes obvios.

REGLAS:
1) No devuelvas los tres null por precaución: la consigna es inferir lo más sensato posible.
2) null solo en un campo (o en varios) cuando el ítem realmente no permita interpretación; nunca como atajo ante duda leve.
3) Una entrada por cada item_number recibido; mismo conjunto y cantidad.

Salida: SOLO JSON válido:
{
  "enrichments": [
    {
      "item_number": <entero>,
      "axis_label": <string o null>,
      "skill_label": <string o null>,
      "cognitive_level": <string o null>,
      "pedagogy_inferred": <boolean>
    }
  ]
}

Sin markdown.`

/** @deprecated Flujo monolítico anterior (mucho volumen de tokens). Conservado por compatibilidad/reversión. */
export const SMART_EXTRACT_LEGACY_SYSTEM_PROMPT = `Eres un extractor pedagógico para pruebas escolares en Chile. Recibirás TEXTO extraído de un PDF o Word (puede incluir ruido de OCR).

Tarea: identificar cada PREGUNTA o ítem numerado y devolver SOLO un JSON válido (sin markdown, sin comentarios, sin explicación antes ni después del JSON).

Formato exacto de salida (obligatorio):
{
  "items": [
    {
      "item_number": <entero >= 1 o null si no hay número claro>,
      "item_text": <string: enunciado completo incluyendo alternativas A/B/C… si están en el mismo bloque, o null>,
      "correct_answer": <string: una letra A-E, o V/F, o null>,
      "axis_label": <string o null>,
      "skill_label": <string o null>,
      "cognitive_level": <string corto en español o null>,
      "competence": <string o null>,
      "difficulty": <string o null>,
      "question_type": <uno de: multiple_choice | true_false | short_answer | essay | completion | null>,
      "max_score": <entero >= 0 o null>,
      "rubric_text": <string o null>,
      "axis_id": null,
      "skill_id": null,
      "confidence": {
        "item_text": <número 0 a 1>,
        "correct_answer": <0 a 1>,
        "axis_label": <0 a 1>,
        "skill_label": <0 a 1>,
        "cognitive_level": <0 a 1>,
        "competence": <0 a 1>,
        "difficulty": <0 a 1>,
        "question_type": <0 a 1>,
        "max_score": <0 a 1>,
        "rubric_text": <0 a 1>
      }
    }
  ]
}

REGLAS (obligatorias):

1) Salida estructurada: la respuesta DEBE ser un único objeto JSON con la clave "items" cuyo valor es un arreglo de ítems. No devuelva solo párrafos de análisis sin "items".

2) Eje y habilidad — análisis por ítem: para cada pregunta, analice el enunciado y el contexto (asignatura, formulación típica SIMCE/aula chilena). Si el documento no nombra explícitamente eje u habilidad, deduzca "axis_label" y "skill_label" en español (etiquetas cortas y profesionales, p. ej. "Números y operaciones", "Resolución de problemas", "Lectura", "Inferencia") cuando la inferencia sea razonable a partir del contenido. Si no hay base suficiente, use null y ponga confidence(axis_label) o confidence(skill_label) por debajo de 0.75.

3) Evidencia por campo: si un campo (salvo deducción razonable de eje/habilidad) carece de sustento en el texto, valor null y confidence de ese campo < 0.75.

4) correct_answer solo si la pauta o gabarito aparece en el documento; si no, null y confidence baja.

5) item_text debe copiar o reconstruir fielmente el texto del documento; si es ilegible o muy dudoso, confidence(item_text) < 0.75 (el servidor descartará el ítem).

6) axis_id y skill_id siempre null.

7) Muchos ítems: priorice los que tengan numeración explícita.

Responde únicamente con el objeto JSON, sin texto adicional.`

/** Alias histórico; usar SMART_EXTRACT_STAGE1_SYSTEM_PROMPT en rutas nuevas. */
export const SMART_EXTRACT_SYSTEM_PROMPT = SMART_EXTRACT_LEGACY_SYSTEM_PROMPT

/** Caracteres máx. de item_text enviados a la pasada 2 (contexto). */
export const SMART_EXTRACT_ENRICH_ITEM_TEXT_MAX = 2800

/** Fragmento máx. de rubric_text por ítem en el JSON de pasada 2 (solo contexto). */
const SMART_EXTRACT_ENRICH_RUBRIC_CONTEXT_MAX = 500

function numOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === "number" ? v : parseInt(String(v), 10)
  if (!Number.isFinite(n)) return null
  return Math.floor(n)
}

function strOrNull(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

function clamp01(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined
  return Math.max(0, Math.min(1, v))
}

/** Quita fences markdown (```json / ```) y espacios; reversible y seguro para el flujo de parseo. */
function stripMarkdownJsonFences(raw: string): string {
  let s = String(raw ?? "").trim()
  for (let i = 0; i < 6; i++) {
    const next = s
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim()
    if (next === s) break
    s = next
  }
  return s.trim()
}

/** Elimina comas colgantes típicas del LLM antes de } o ]. */
function fixTrailingCommas(s: string): string {
  let prev = ""
  let out = s
  while (out !== prev) {
    prev = out
    out = out.replace(/,(\s*[}\]])/g, "$1")
  }
  return out
}

function tryJsonParse(s: string): unknown | null {
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

/**
 * Cierra objetos/arrays abiertos al final del fragmento (respuestas truncadas).
 * Respeta comillas y escapes para no contar { } [ ] dentro de strings.
 */
function balanceOpenBrackets(fragment: string): string {
  const stack: Array<"{" | "["> = []
  let inStr = false
  let esc = false
  for (let i = 0; i < fragment.length; i++) {
    const ch = fragment[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === "\\") {
        esc = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === "{") {
      stack.push("{")
      continue
    }
    if (ch === "[") {
      stack.push("[")
      continue
    }
    if (ch === "}") {
      if (stack.length > 0 && stack[stack.length - 1] === "{") stack.pop()
      continue
    }
    if (ch === "]") {
      if (stack.length > 0 && stack[stack.length - 1] === "[") stack.pop()
      continue
    }
  }
  let suffix = ""
  while (stack.length > 0) {
    const c = stack.pop()
    suffix += c === "{" ? "}" : "]"
  }
  return fragment + suffix
}

function extractJsonStringCandidates(cleaned: string): string[] {
  const start = cleaned.indexOf("{")
  if (start < 0) return []
  const rest = cleaned.slice(start)
  const lastBrace = rest.lastIndexOf("}")
  if (lastBrace < 0) return [rest]
  const trimmedToBrace = rest.slice(0, lastBrace + 1)
  if (trimmedToBrace === rest) return [rest]
  return [trimmedToBrace, rest]
}

/**
 * Parseo tolerante: limpia fences, intenta JSON.parse y reparaciones mínimas (comas, cierre de llaves).
 * No altera prompts ni el resto del sistema.
 */
export function extractJsonObjectFromModelText(text: string): unknown {
  const raw = String(text ?? "").trim()
  const cleaned = stripMarkdownJsonFences(raw).trim()

  console.log(
    "[smart-base-parser] JSON prep",
    JSON.stringify(
      {
        length: raw.length,
        starts_with_json_fence: /^\s*```(?:json)?/i.test(raw),
        ends_with_brace_or_bracket: /[\]}]\s*$/.test(cleaned),
        cleaned_length: cleaned.length,
      },
      null,
      2,
    ),
  )

  const candidates = extractJsonStringCandidates(cleaned)
  if (candidates.length === 0) {
    throw new Error("Respuesta sin JSON reconocible (sin objeto raíz {)")
  }

  let lastErr = "JSON.parse falló"
  for (const base of candidates) {
    const variants = [
      fixTrailingCommas(base.trim()),
      balanceOpenBrackets(fixTrailingCommas(base.trim())),
      fixTrailingCommas(balanceOpenBrackets(base.trim())),
    ]
    for (const v of variants) {
      const parsed = tryJsonParse(v)
      if (parsed != null) {
        return parsed
      }
    }
    try {
      JSON.parse(base)
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }

  throw new Error(`Respuesta sin JSON válido (${lastErr})`)
}

function confidenceFor(
  conf: Record<string, unknown> | undefined,
  key: FieldConfidenceKey,
  strictMissing: boolean
): number {
  if (!conf || typeof conf !== "object") return strictMissing ? 0 : 1
  const c = clamp01(conf[key])
  if (c === undefined) return strictMissing ? 0 : 1
  return c
}

/** Estadísticas del JSON parseado antes del filtro por confianza (diagnóstico / avisos). */
export function getSmartExtractRawItemStats(parsed: unknown): {
  hasItemsKey: boolean
  itemsIsArray: boolean
  rawCount: number
} {
  if (!parsed || typeof parsed !== "object") {
    return { hasItemsKey: false, itemsIsArray: false, rawCount: 0 }
  }
  const o = parsed as Record<string, unknown>
  if (!("items" in o)) {
    return { hasItemsKey: false, itemsIsArray: false, rawCount: 0 }
  }
  const items = o.items
  if (!Array.isArray(items)) {
    return { hasItemsKey: true, itemsIsArray: false, rawCount: 0 }
  }
  const rawCount = items.filter((x) => x != null && typeof x === "object").length
  return { hasItemsKey: true, itemsIsArray: true, rawCount }
}

/**
 * Pasada 1: ítems compactos del modelo (sin confidence). Solo descarta filas sin item_text.
 */
export function finalizeSlimStage1Items(parsed: unknown): SmartExtractItemPublic[] {
  if (!parsed || typeof parsed !== "object") return []
  const items = (parsed as { items?: unknown }).items
  if (!Array.isArray(items)) return []

  const out: SmartExtractItemPublic[] = []
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const itemText = strOrNull(r.item_text)
    if (!itemText) continue

    let itemNum = numOrNull(r.item_number)
    if (itemNum == null || itemNum < 1) itemNum = out.length + 1

    let qt = strOrNull(r.question_type)
    if (qt && !ALLOWED_QUESTION_TYPES.has(qt)) qt = null

    let correct = strOrNull(r.correct_answer)
    if (correct) {
      const u = correct.toUpperCase()
      if (/^[A-E]$/.test(u)) correct = u
      else if (u === "V" || u === "F") correct = u
      else correct = null
    }

    const ms = numOrNull(r.max_score)
    const max_score = ms != null && ms >= 0 ? ms : null

    out.push({
      item_number: itemNum,
      item_text: itemText,
      axis_id: null,
      skill_id: null,
      axis_label: null,
      skill_label: null,
      cognitive_level: null,
      competence: null,
      difficulty: null,
      question_type: qt,
      correct_answer: correct,
      max_score,
      rubric_text: strOrNull(r.rubric_text),
      pedagogy_inferred: false,
    })
  }

  out.sort((a, b) => (a.item_number ?? 0) - (b.item_number ?? 0))
  return out
}

function normalizeSubjectHeuristicKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * Heurística ligera sobre texto del documento (solo respaldo si `source_exams.subject` está vacío).
 * Devuelve etiquetas canónicas para alinear con `getAxisHintsForSubject`.
 */
export function inferSubjectHeuristicFromText(documentSample: string): string | null {
  const t = normalizeSubjectHeuristicKey(documentSample.slice(0, 18_000))
  if (t.length < 40) return null

  const hitCount = (keywords: readonly string[]) =>
    keywords.reduce((acc, kw) => (kw.length >= 2 && t.includes(kw) ? acc + 1 : acc), 0)

  const scoreMate = hitCount([
    "ecuacion",
    "fraccion",
    "algebra",
    "geometria",
    "triangulo",
    "perimetro",
    "area",
    "porcentaje",
    "grafico",
    "multiplic",
    "multiplica",
    "division",
    "divide",
    "logaritmo",
    "potencia",
    "angulo",
    "teorema",
    "simce",
    "matematica",
    "matematicas",
    "numero",
    "numeros",
    "entero",
    "racional",
    "proporcion",
    "calcula",
    "calculo",
    "resuelve",
    "resolucion",
    "determina",
    "demuestra",
    "planteamiento",
    "funcion",
    "ecuaciones",
  ])
  const scoreLeng = hitCount([
    "comprension",
    "lectora",
    "lectura",
    "lector",
    "texto",
    "textual",
    "sinonimo",
    "antonimo",
    "ortografia",
    "parrafo",
    "poema",
    "literatura",
    "vocabulario",
    "inferencia",
    "explicito",
    "implicito",
    "metafora",
    "lenguaje",
    "comunicacion",
    "escritura",
    "oracion",
    "significado",
    "titulo",
    "autor",
  ])
  const scoreCien = hitCount([
    "biologia",
    "fisica",
    "quimica",
    "ciencias",
    "naturales",
    "ecosistema",
    "celula",
    "atomo",
    "energia",
    "experimento",
    "hipotesis",
    "variable",
    "cientifica",
    "fotosintesis",
    "evolucion",
    "organismo",
    "molecula",
    "reaccion",
  ])

  const ranked = [
    { n: scoreMate, label: "Matemática" as const },
    { n: scoreLeng, label: "Lenguaje" as const },
    { n: scoreCien, label: "Ciencias" as const },
  ].sort((a, b) => b.n - a.n)

  if (ranked[0].n < 1) return null
  if (ranked[0].n >= 2) {
    if (ranked.length >= 2 && ranked[0].n === ranked[1].n) return null
    return ranked[0].label
  }
  // Una sola coincidencia: solo aceptar si las otras áreas van en cero (evita empates 1–1).
  if (ranked[1].n < 1) return ranked[0].label
  return null
}

/**
 * Infiere asignatura canónica desde título o curso (p. ej. "Prueba SIMCE Matemática 4°").
 * Usado cuando `source_exams.subject` está vacío pero el docente sí dejó pistas en metadatos.
 */
export function inferSubjectFromTitleOrCourse(
  title: string | null | undefined,
  courseLabel: string | null | undefined,
): string | null {
  const combined = normalizeSubjectHeuristicKey(`${title ?? ""} ${courseLabel ?? ""}`)
  if (combined.length < 3) return null

  const scoreMate = ["matematica", "matematicas", "matem", "algebra", "geometria", "calculo", "simce mat", "paes mat"].some(
    (kw) => combined.includes(kw),
  )
    ? 1
    : 0
  const scoreLeng = [
    "lenguaje",
    "lengua",
    "comunicacion",
    "lectura",
    "literatura",
    "simce len",
    "paes len",
  ].some((kw) => combined.includes(kw))
    ? 1
    : 0
  const scoreCien = ["ciencias", "naturales", "biologia", "fisica", "quimica", "ciencia"].some((kw) =>
    combined.includes(kw),
  )
    ? 1
    : 0

  const ranked = [
    { n: scoreMate, label: "Matemática" as const },
    { n: scoreLeng, label: "Lenguaje" as const },
    { n: scoreCien, label: "Ciencias" as const },
  ].sort((a, b) => b.n - a.n)
  if (ranked[0].n < 1) return null
  if (ranked[1].n >= 1) return null
  return ranked[0].label
}

export function resolveDocumentSubjectForEnrichment(args: {
  sourceExamSubject: string | null | undefined
  documentTextSample: string
  title?: string | null
  courseLabel?: string | null
}): { subject: string | null; source: "source_exams" | "metadata" | "heuristic" | "none" } {
  const db = typeof args.sourceExamSubject === "string" ? args.sourceExamSubject.trim() : ""
  if (db.length >= 2) return { subject: db, source: "source_exams" }

  const meta = inferSubjectFromTitleOrCourse(args.title, args.courseLabel)
  if (meta) return { subject: meta, source: "metadata" }

  const h = inferSubjectHeuristicFromText(args.documentTextSample)
  if (h) return { subject: h, source: "heuristic" }
  return { subject: null, source: "none" }
}

const AXIS_HINTS_BY_CANON: Record<string, string[]> = {
  Matemática: [
    "Números y operaciones",
    "Álgebra",
    "Geometría",
    "Medición",
    "Datos y probabilidades",
  ],
  Lenguaje: ["Comprensión lectora", "Léxico", "Inferencia", "Producción escrita", "Literatura"],
  Ciencias: [
    "Biología",
    "Física",
    "Química",
    "Ciencias de la Tierra e historia natural",
    "Indagación científica",
  ],
}

/** Pistas de ejes para el prompt de pasada 2; vacío si la asignatura no coincide con un perfil conocido. */
export function getAxisHintsForSubject(subjectLabel: string | null | undefined): string[] {
  if (subjectLabel == null) return []
  const s = normalizeSubjectHeuristicKey(subjectLabel)
  if (!s) return []
  if (/matem/.test(s)) return [...AXIS_HINTS_BY_CANON.Matemática]
  if (/lenguaje|^lengua\b|comunicacion|lectura\s+y\s+escritura/.test(s)) return [...AXIS_HINTS_BY_CANON.Lenguaje]
  if (/ciencias?(\s+naturales)?|biolog|fisica|quimica/.test(s)) return [...AXIS_HINTS_BY_CANON.Ciencias]
  return []
}

export type SmartExtractEnrichmentContext = {
  document_subject: string | null
  subject_source: "source_exams" | "metadata" | "heuristic" | "none"
  axis_hints: string[]
}

export function buildEnrichmentUserJson(
  items: SmartExtractItemPublic[],
  ctx?: Partial<SmartExtractEnrichmentContext>,
): string {
  const textMax = SMART_EXTRACT_ENRICH_ITEM_TEXT_MAX
  const rubMax = SMART_EXTRACT_ENRICH_RUBRIC_CONTEXT_MAX
  const slim = items.map((it) => {
    const row: Record<string, unknown> = {
      item_number: it.item_number,
      question_type: it.question_type,
      item_text: String(it.item_text ?? "").slice(0, textMax),
    }
    const rub = String(it.rubric_text ?? "").trim()
    if (rubMax > 0 && rub.length > 0) {
      row.rubric_context = rub.length > rubMax ? `${rub.slice(0, rubMax)}…` : rub
    }
    return row
  })
  const document_subject = ctx?.document_subject ?? null
  const subject_source = ctx?.subject_source ?? "none"
  const axis_hints = Array.isArray(ctx?.axis_hints) ? ctx.axis_hints : []
  return JSON.stringify({
    document_subject,
    subject_source,
    axis_hints,
    items: slim,
  })
}

const MERGE_PEDAGOGY_LOG = "[smart-base-parser] mergePedagogyEnrichments"

/**
 * Etiquetas tratadas como "débiles": la pasada 2 puede sustituirlas por inferencia.
 * Conservador: solo placeholders y valores demasiado genéricos; no invalida textos largos del docente.
 */
const WEAK_PEDAGOGY_NORMALIZED = new Set([
  "-",
  "—",
  "--",
  "...",
  ".",
  "..",
  "n/a",
  "na",
  "s/n",
  "sn",
  "x",
  "xx",
  "?",
  "??",
  "ninguno",
  "ninguna",
  "sin eje",
  "sin datos",
  "pendiente",
  "general",
  "otro",
  "otros",
])

function normalizePedagogyCompare(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** True si el valor actual puede completarse con la inferencia (vacío o claramente débil). */
function isPedagogyFieldFillable(current: string | null | undefined): boolean {
  const raw = current == null ? "" : String(current).trim()
  if (raw.length === 0) return true
  if (raw.length < 2) return true
  const key = normalizePedagogyCompare(raw)
  if (WEAK_PEDAGOGY_NORMALIZED.has(key)) return true
  return false
}

type PedagogyMergeField = "axis_label" | "skill_label" | "cognitive_level"

type PedagogyFieldLog = {
  field: PedagogyMergeField
  action: "filled" | "maintained" | "ignored"
  previous?: string | null
  applied?: string | null
  kept?: string | null
  model_proposed?: string | null
  /** Solo cuando se mantiene vacío/débil y el modelo no aportó valor útil */
  reason?: "no_model_proposal"
}

function mergeOnePedagogyField(args: {
  field: PedagogyMergeField
  current: string | null
  proposed: string | null
}): { value: string | null; filledFromModel: boolean; log: PedagogyFieldLog } {
  const { field, current, proposed } = args
  const fillable = isPedagogyFieldFillable(current)
  const prop = proposed != null && String(proposed).trim().length > 0 ? String(proposed).trim() : null

  if (fillable && prop != null) {
    return {
      value: prop,
      filledFromModel: true,
      log: {
        field,
        action: "filled",
        previous: current,
        applied: prop,
      },
    }
  }

  if (!fillable) {
    const cur = current != null && String(current).trim().length > 0 ? String(current).trim() : null
    if (prop != null && cur != null && normalizePedagogyCompare(cur) !== normalizePedagogyCompare(prop)) {
      return {
        value: cur,
        filledFromModel: false,
        log: {
          field,
          action: "ignored",
          kept: cur,
          model_proposed: prop,
        },
      }
    }
    return {
      value: cur,
      filledFromModel: false,
      log: {
        field,
        action: "maintained",
        kept: cur,
        ...(prop != null ? { model_proposed: prop } : {}),
      },
    }
  }

  // Vacío/débil y sin propuesta del modelo: se deja como está
  const left = current != null && String(current).trim().length > 0 ? String(current).trim() : null
  return {
    value: left,
    filledFromModel: false,
    log: {
      field,
      action: "maintained",
      kept: left,
      reason: "no_model_proposal",
    },
  }
}

/** Aplica enriquecimientos de la pasada 2 por item_number. Solo rellena vacíos/débiles; no pisa valores confiables. */
export function mergePedagogyEnrichments(
  items: SmartExtractItemPublic[],
  parsed: unknown,
): SmartExtractItemPublic[] {
  if (!parsed || typeof parsed !== "object") return items
  const arr = (parsed as Record<string, unknown>).enrichments
  if (!Array.isArray(arr)) return items

  const byNum = new Map<
    number,
    { axis_label: string | null; skill_label: string | null; cognitive_level: string | null }
  >()
  for (const row of arr) {
    if (!row || typeof row !== "object") continue
    const r = row as Record<string, unknown>
    const n = numOrNull(r.item_number)
    if (n == null || n < 1) continue
    byNum.set(n, {
      axis_label: strOrNull(r.axis_label),
      skill_label: strOrNull(r.skill_label),
      cognitive_level: strOrNull(r.cognitive_level),
    })
  }

  return items.map((it) => {
    const n = it.item_number
    if (n == null || n < 1) return it
    const m = byNum.get(n)
    if (!m) return it

    const ax = mergeOnePedagogyField({ field: "axis_label", current: it.axis_label, proposed: m.axis_label })
    const sk = mergeOnePedagogyField({ field: "skill_label", current: it.skill_label, proposed: m.skill_label })
    const cg = mergeOnePedagogyField({
      field: "cognitive_level",
      current: it.cognitive_level,
      proposed: m.cognitive_level,
    })

    const anyFilled = ax.filledFromModel || sk.filledFromModel || cg.filledFromModel
    console.log(
      MERGE_PEDAGOGY_LOG,
      JSON.stringify({
        item_number: n,
        fields: [ax.log, sk.log, cg.log],
        pedagogy_inferred_after_merge: anyFilled,
      }),
    )

    return {
      ...it,
      axis_label: ax.value,
      skill_label: sk.value,
      cognitive_level: cg.value,
      pedagogy_inferred: anyFilled ? true : Boolean(it.pedagogy_inferred),
    }
  })
}

/** Taxonomía Bloom acordada con el prompt de pasada 2 (solo estas formas pasan el saneo). */
const CANONICAL_COGNITIVE_LEVELS = ["recordar", "comprender", "aplicar", "analizar", "evaluar", "crear"] as const

type CanonicalCognitive = (typeof CANONICAL_COGNITIVE_LEVELS)[number]

/** Sinónimos frecuentes del modelo (es/en); mapeo conservador a la taxonomía fija. Reversible: quitar entradas si sobre-clasifica. */
const COGNITIVE_LEVEL_NORMALIZATION: Record<string, CanonicalCognitive> = {
  // — recordar —
  recordar: "recordar",
  memorizar: "recordar",
  reproducir: "recordar",
  reconocer: "recordar",
  recordacion: "recordar",
  memoria: "recordar",
  remember: "recordar",
  recall: "recordar",
  // — comprender —
  comprender: "comprender",
  entender: "comprender",
  interpretar: "comprender",
  explicar: "comprender",
  comprension: "comprender",
  entendimiento: "comprender",
  understand: "comprender",
  understanding: "comprender",
  // — aplicar —
  aplicar: "aplicar",
  aplicacion: "aplicar",
  usar: "aplicar",
  emplear: "aplicar",
  practicar: "aplicar",
  ejecutar: "aplicar",
  transferir: "aplicar",
  apply: "aplicar",
  application: "aplicar",
  // — analizar —
  analizar: "analizar",
  analisis: "analizar",
  comparar: "analizar",
  clasificar: "analizar",
  diferenciar: "analizar",
  examinar: "analizar",
  relacionar: "analizar",
  organizar: "analizar",
  analyze: "analizar",
  analysis: "analizar",
  // — evaluar —
  evaluar: "evaluar",
  evaluacion: "evaluar",
  juzgar: "evaluar",
  criticar: "evaluar",
  justificar: "evaluar",
  evaluate: "evaluar",
  evaluation: "evaluar",
  // — crear —
  crear: "crear",
  disenar: "crear",
  diseno: "crear",
  planificar: "crear",
  producir: "crear",
  sintetizar: "crear",
  sintesis: "crear",
  create: "crear",
  creation: "crear",
  design: "crear",
  diseñar: "crear",
  diseño: "crear",
}

const EXTRA_GENERIC_PEDAGOGY_NORMALIZED = new Set([
  "analisis del item",
  "variado",
  "varios",
  "contenido general",
  "sin especificar",
  "desconocido",
  "miscelanea",
  "no aplica",
  "n.a.",
  "s.d.",
  "item",
  "ítem",
])

function sanitizePedagogyAxisOrSkillValue(raw: unknown): string | null {
  const s = strOrNull(raw)
  if (!s) return null
  const key = normalizePedagogyCompare(s)
  if (WEAK_PEDAGOGY_NORMALIZED.has(key)) return null
  if (EXTRA_GENERIC_PEDAGOGY_NORMALIZED.has(key)) return null
  if (key.includes("analisis del") && key.includes("item")) return null
  return s
}

function sanitizePedagogyCognitiveValue(raw: unknown): string | null {
  const s = strOrNull(raw)
  if (!s) return null
  const key = normalizePedagogyCompare(s)
  const mapped = COGNITIVE_LEVEL_NORMALIZATION[key]
  if (mapped) return mapped
  for (const c of CANONICAL_COGNITIVE_LEVELS) {
    if (key === normalizePedagogyCompare(c)) return c
  }
  return null
}

/**
 * Antes de mergePedagogyEnrichments: anula etiquetas genéricas/prohibidas y niveles fuera de taxonomía.
 * No modifica ítems ya persistidos; solo la propuesta JSON del modelo.
 */
export function sanitizePedagogyEnrichmentsParsed(parsed: unknown): unknown {
  if (parsed == null || typeof parsed !== "object") return parsed
  const root = parsed as Record<string, unknown>
  const arr = root.enrichments
  if (!Array.isArray(arr)) return parsed

  const enrichments = arr.map((row) => {
    if (row == null || typeof row !== "object") return row
    const r = row as Record<string, unknown>
    return {
      ...r,
      axis_label: sanitizePedagogyAxisOrSkillValue(r.axis_label),
      skill_label: sanitizePedagogyAxisOrSkillValue(r.skill_label),
      cognitive_level: sanitizePedagogyCognitiveValue(r.cognitive_level),
    }
  })
  return { ...root, enrichments }
}

/**
 * Convierte la respuesta cruda del modelo en ítems públicos (sin confidence),
 * aplicando umbral SMART_EXTRACT_CONFIDENCE_THRESHOLD y saneamiento de tipos.
 *
 * Filtro de confianza: aquí se descartan ítems si `item_text` vacío o
 * `confidence.item_text` &lt; umbral (salvo `bypassConfidenceFilter`).
 */
export function finalizeSmartExtractItems(
  parsed: unknown,
  options?: {
    confidenceThreshold?: number
    /** Omite el filtro por confidence; solo exige `item_text` no vacío tras saneo. */
    bypassConfidenceFilter?: boolean
    /** Logs por ítem descartado y resumen (servidor). */
    logConfidenceDecisions?: boolean
  },
): SmartExtractItemPublic[] {
  const bypass = options?.bypassConfidenceFilter === true
  const threshold = options?.confidenceThreshold ?? SMART_EXTRACT_CONFIDENCE_THRESHOLD
  const log = options?.logConfidenceDecisions !== false

  if (!parsed || typeof parsed !== "object") return []
  const items = (parsed as { items?: unknown }).items
  if (!Array.isArray(items)) return []

  const out: SmartExtractItemPublic[] = []
  const stats = {
    posiciones_en_array: items.length,
    objetos_crudos: 0,
    descartado_no_objeto: 0,
    descartado_item_text_vacio: 0,
    descartado_item_text_confianza: 0,
    conservados: 0,
  }

  for (let slot = 0; slot < items.length; slot++) {
    const raw = items[slot]
    if (!raw || typeof raw !== "object") {
      stats.descartado_no_objeto++
      if (log) {
        console.log(
          "[smart-base-parser] confidence drop",
          JSON.stringify({ slot: slot + 1, reason: "no_es_objeto" }),
        )
      }
      continue
    }
    stats.objetos_crudos++

    const r = raw as Record<string, unknown>
    const conf = r.confidence as Record<string, unknown> | undefined

    const cText = confidenceFor(conf, "item_text", true)
    const itemText = strOrNull(r.item_text)
    if (!itemText) {
      stats.descartado_item_text_vacio++
      if (log) {
        console.log(
          "[smart-base-parser] confidence drop",
          JSON.stringify({
            slot: slot + 1,
            reason: "item_text_vacio_o_null",
            item_number_raw: r.item_number,
          }),
        )
      }
      continue
    }
    if (!bypass && cText < threshold) {
      stats.descartado_item_text_confianza++
      if (log) {
        console.log(
          "[smart-base-parser] confidence drop",
          JSON.stringify({
            slot: slot + 1,
            reason: "item_text_confianza_inferior_umbral",
            item_number_raw: r.item_number,
            c_item_text: cText,
            umbral: threshold,
          }),
        )
      }
      continue
    }

    let itemNum = numOrNull(r.item_number)
    if (itemNum == null || itemNum < 1) itemNum = out.length + 1

    const apply = (key: FieldConfidenceKey, value: unknown): string | null => {
      if (bypass) return strOrNull(value)
      if (confidenceFor(conf, key, true) < threshold) return null
      return strOrNull(value)
    }

    const applyNum = (key: FieldConfidenceKey, value: unknown): number | null => {
      if (bypass) {
        const n = numOrNull(value)
        if (n == null || n < 0) return null
        return n
      }
      if (confidenceFor(conf, key, true) < threshold) return null
      const n = numOrNull(value)
      if (n == null || n < 0) return null
      return n
    }

    let questionType = apply("question_type", r.question_type)
    if (questionType && !ALLOWED_QUESTION_TYPES.has(questionType)) questionType = null

    let correct = apply("correct_answer", r.correct_answer)
    if (correct) {
      const u = correct.toUpperCase()
      if (/^[A-E]$/.test(u)) correct = u
      else if (u === "V" || u === "F") correct = u
      else correct = null
    }

    // Zero-Edition: nunca persistir UUIDs inferidos por el LLM; resolución vía import existente si aplica.
    out.push({
      item_number: itemNum,
      item_text: itemText,
      axis_id: null,
      skill_id: null,
      axis_label: apply("axis_label", r.axis_label),
      skill_label: apply("skill_label", r.skill_label),
      cognitive_level: apply("cognitive_level", r.cognitive_level),
      competence: apply("competence", r.competence),
      difficulty: apply("difficulty", r.difficulty),
      question_type: questionType,
      correct_answer: correct,
      max_score: applyNum("max_score", r.max_score),
      rubric_text: apply("rubric_text", r.rubric_text),
    })
    stats.conservados++
  }

  if (log) {
    console.log(
      "[smart-base-parser] confidence resumen",
      JSON.stringify({
        ...stats,
        modo: bypass ? "sin_filtro_confianza_fallback" : "umbral",
        umbral_aplicado: bypass ? null : threshold,
        entran_objetos_crudos: stats.objetos_crudos,
        salen_conservados: stats.conservados,
      }),
    )
  }

  out.sort((a, b) => (a.item_number ?? 0) - (b.item_number ?? 0))
  return out
}

/** Trunca documento para límite de contexto del modelo (caracteres). */
export function truncateDocumentForLlm(text: string, maxChars: number): { text: string; truncated: boolean } {
  const t = String(text ?? "")
  if (t.length <= maxChars) return { text: t, truncated: false }
  return {
    text: t.slice(0, maxChars) + "\n\n[… documento truncado por límite de tamaño …]",
    truncated: true,
  }
}
