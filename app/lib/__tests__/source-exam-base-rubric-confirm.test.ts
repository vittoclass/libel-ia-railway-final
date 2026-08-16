/**
 * BASE-RUBRIC-R1 — Confirmación de borradores (prueba / rúbrica / ambos).
 * OFFLINE. Fixtures genéricos. Sin Azure/IA/Railway/Supabase prod.
 *
 * Ejecutar: npx tsx app/lib/__tests__/source-exam-base-rubric-confirm.test.ts
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "path"
import type { ParsedLine } from "@/app/lib/parse-bulk-items"
import {
  applyBulkConfirmToDrafts,
  buildDraftFromParsedLines,
  confirmDraftItem,
  draftRowToParsedLine,
  draftsApplyMergeOverlay,
  formatBulkConfirmMissingDescription,
  getDraftRowConfirmability,
  isDraftRowCompleteForBulkConfirm,
  teacherFacingRowStatus,
  type MergeDraftOverlayByItem,
  type SourceExamItemDraft,
} from "@/app/lib/source-exam-validation-draft"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = path.resolve(__dirname, "../../..")
const DRAFT_SRC = path.resolve(__dirname, "../source-exam-validation-draft.ts")
const DIALOG_SRC = path.resolve(__dirname, "../../components/SourceExamItemsImportDialog.tsx")

function line(partial: Partial<ParsedLine> & { item_text?: string; item_number?: number }): ParsedLine {
  return {
    item_number: partial.item_number ?? 1,
    item_text: partial.item_text ?? "Criterio evaluable genérico",
    axis_label: partial.axis_label ?? null,
    skill_label: partial.skill_label ?? null,
    cognitive_level: partial.cognitive_level ?? null,
    competence: partial.competence ?? null,
    difficulty: partial.difficulty ?? null,
    question_type: partial.question_type ?? null,
    correct_answer: partial.correct_answer ?? null,
    max_score: partial.max_score ?? null,
    rubric_text: partial.rubric_text ?? null,
  }
}

function draft(partial: Partial<ParsedLine> = {}): SourceExamItemDraft {
  return buildDraftFromParsedLines([line(partial)])[0]
}

function assertConfirmable(d: SourceExamItemDraft, expected: boolean): void {
  const c = getDraftRowConfirmability(d)
  assert.equal(c.confirmable, expected)
  assert.equal(isDraftRowCompleteForBulkConfirm(d), expected)
  if (teacherFacingRowStatus(d) === "Completo") {
    assert.equal(c.confirmable, true, "Completo debe implicar confirmable")
  }
  if (!c.confirmable) {
    assert.notEqual(teacherFacingRowStatus(d), "Completo")
  }
}

test("T1: rúbrica como archivo principal con criterio válido → confirmable", () => {
  const d = draft({
    item_text: "Argumenta con evidencias pertinentes",
    question_type: null,
    max_score: null,
    axis_label: null,
    skill_label: null,
    cognitive_level: null,
    correct_answer: null,
    rubric_text: "Nivel 3: evidencia pertinente y suficiente",
  })
  assertConfirmable(d, true)
  const r = applyBulkConfirmToDrafts([d])
  assert.equal(r.confirmedCount, 1)
  assert.equal(r.skippedCount, 0)
  assert.equal(r.next[0].itemConfirmed, true)
  assert.equal(r.next[0].item_text.value, "Argumenta con evidencias pertinentes")
  assert.equal(r.next[0].question_type.value, null)
  assert.equal(r.next[0].max_score.value, null)
})

test("T2: misma rúbrica en main + supplement no duplica ni bloquea confirmación", () => {
  const main = draft({
    item_number: 1,
    item_text: "Organiza ideas con cohesión",
    rubric_text: "Organiza ideas con cohesión",
    question_type: "essay",
  })
  const overlay = new Map<number, MergeDraftOverlayByItem>([
    [
      1,
      {
        rubric_text: {
          status: "needs_review",
          conflict_note: "Texto de rúbrica distinto entre prueba y documento de rúbrica.",
        },
      },
    ],
  ])
  const merged = draftsApplyMergeOverlay([main], overlay)
  assert.equal(merged.length, 1)
  assertConfirmable(merged[0], true)
  const r = applyBulkConfirmToDrafts(merged)
  assert.equal(r.next.length, 1)
  assert.equal(r.confirmedCount, 1)
  assert.equal(r.next[0].itemConfirmed, true)
})

test("T3: prueba + rúbrica → confirmable", () => {
  const d = draft({
    item_text: "Explica el conflicto central del texto",
    question_type: "essay",
    max_score: 4,
    axis_label: "Lectura",
    skill_label: "Interpretar",
    cognitive_level: "analizar",
    rubric_text: "Usa evidencia del texto y cohesión.",
  })
  assertConfirmable(d, true)
  assert.equal(applyBulkConfirmToDrafts([d]).confirmedCount, 1)
})

test("T4: rúbrica suplementaria sola sin main no inventa extracción", () => {
  const empty: SourceExamItemDraft[] = []
  const r = applyBulkConfirmToDrafts(empty)
  assert.equal(r.next.length, 0)
  assert.equal(r.confirmedCount, 0)
  assert.equal(r.skippedCount, 0)
  const dialogSrc = fs.readFileSync(DIALOG_SRC, "utf8")
  assert.match(dialogSrc, /Falta la prueba/)
  assert.match(dialogSrc, /pendingSmartMainFile/)
  assert.doesNotMatch(dialogSrc, /inventa.*ítem|inventar.*filas/i)
})

test("T5: item_text vacío → no confirmable", () => {
  const d = draft({ item_text: "   " })
  assertConfirmable(d, false)
  assert.deepEqual(getDraftRowConfirmability(d).missingRequiredFields, ["item_text"])
  assert.equal(applyBulkConfirmToDrafts([d]).confirmedCount, 0)
})

test("T6: MC sin correct_answer → no confirmable", () => {
  const d = draft({
    item_text: "¿Cuál es el resultado?",
    question_type: "multiple_choice",
    correct_answer: null,
  })
  assertConfirmable(d, false)
  assert.deepEqual(getDraftRowConfirmability(d).missingRequiredFields, ["correct_answer"])
  assert.equal(teacherFacingRowStatus(d), "Sin respuesta")
})

test("T7: MC con clave → confirmable", () => {
  const d = draft({
    item_text: "¿Cuál es el resultado?",
    question_type: "multiple_choice",
    correct_answer: "C",
  })
  assertConfirmable(d, true)
  assert.equal(applyBulkConfirmToDrafts([d]).confirmedCount, 1)
})

test("T8: VF sin clave → no confirmable", () => {
  const d = draft({
    item_text: "El agua hierve a 100 °C al nivel del mar.",
    question_type: "true_false",
    correct_answer: null,
  })
  assertConfirmable(d, false)
  assert.equal(teacherFacingRowStatus(d), "Sin respuesta")
})

test("T9: desarrollo sin correct_answer → confirmable", () => {
  const d = draft({
    item_text: "Fundamenta tu postura con dos razones.",
    question_type: "essay",
    correct_answer: null,
    max_score: 6,
    axis_label: "Escritura",
    skill_label: "Argumentar",
    cognitive_level: "evaluar",
  })
  assertConfirmable(d, true)
})

test("T10: question_type null → confirmable (no se inventa tipo)", () => {
  const d = draft({ item_text: "Descriptor de desempeño", question_type: null })
  assertConfirmable(d, true)
  assert.equal(getDraftRowConfirmability(d).warnings.includes("question_type"), true)
  const after = applyBulkConfirmToDrafts([d]).next[0]
  assert.equal(after.question_type.value, null)
})

test("T11: max_score null → confirmable (no se inventa puntaje)", () => {
  const d = draft({ item_text: "Resuelve el problema planteado", max_score: null })
  assertConfirmable(d, true)
  assert.equal(teacherFacingRowStatus(d), "Sin puntaje")
  const after = applyBulkConfirmToDrafts([d]).next[0]
  assert.equal(after.max_score.value, null)
  assert.equal(after.itemConfirmed, true)
})

test("T12: cognitive_level null → confirmable", () => {
  const d = draft({
    item_text: "Compara dos fuentes históricas",
    cognitive_level: null,
    max_score: 2,
    axis_label: "Historia",
    skill_label: "Comparar",
  })
  assertConfirmable(d, true)
  assert.equal(teacherFacingRowStatus(d), "Completo")
})

test("T13: axis null → confirmable con aviso visual", () => {
  const d = draft({
    item_text: "Identifica la figura literaria",
    axis_label: null,
    skill_label: "Identificar",
    max_score: 1,
  })
  assertConfirmable(d, true)
  assert.equal(teacherFacingRowStatus(d), "Falta revisar")
})

test("T14: skill null → confirmable con aviso visual", () => {
  const d = draft({
    item_text: "Calcula el perímetro",
    axis_label: "Geometría",
    skill_label: null,
    max_score: 1,
  })
  assertConfirmable(d, true)
  assert.equal(teacherFacingRowStatus(d), "Falta revisar")
})

test("T15: difficulty null no bloquea", () => {
  const d = draft({ item_text: "Completa la oración", difficulty: null, question_type: "completion" })
  assertConfirmable(d, true)
})

test("T16: competence null no bloquea", () => {
  const d = draft({ item_text: "Describe el proceso", competence: null, question_type: "short_answer" })
  assertConfirmable(d, true)
})

test("T17: teacherFacingRowStatus y bulkConfirmability coherentes", () => {
  const rows = [
    draft({ item_text: "Criterio A" }),
    draft({ item_text: "", question_type: "essay" }),
    draft({ item_text: "MC", question_type: "multiple_choice", correct_answer: "A", max_score: 1, axis_label: "Números", skill_label: "Calcular" }),
    draft({ item_text: "MC sin clave", question_type: "multiple_choice" }),
  ]
  for (const d of rows) {
    const c = getDraftRowConfirmability(d)
    if (teacherFacingRowStatus(d) === "Completo") assert.equal(c.confirmable, true)
    if (!c.confirmable) assert.notEqual(teacherFacingRowStatus(d), "Completo")
  }
})

test("T18: toast lista missing fields reales", () => {
  const rows = [
    draft({ item_text: "   " }),
    draft({ item_text: "MC", question_type: "multiple_choice" }),
    draft({ item_text: "VF", question_type: "true_false" }),
  ]
  const r = applyBulkConfirmToDrafts(rows)
  assert.equal(r.confirmedCount, 0)
  const desc = formatBulkConfirmMissingDescription(r.missingFieldCounts)
  assert.match(desc, /enunciado en 1 fila/)
  assert.match(desc, /respuesta correcta en 2 filas/)
  assert.doesNotMatch(desc, /puntaje|nivel cognitivo|eje|habilidad/)
})

test("T19: 0 itemDrafts → botón sin acción", () => {
  const r = applyBulkConfirmToDrafts([])
  assert.equal(r.confirmedCount, 0)
  assert.equal(r.skippedCount, 0)
  assert.equal(r.next.length, 0)
  const dialogSrc = fs.readFileSync(DIALOG_SRC, "utf8")
  assert.match(dialogSrc, /if \(!itemDrafts\?\.length\) return/)
})

test("T20: 1 válida + 1 inválida → confirma válida; inválida queda pendiente", () => {
  const ok = draft({ item_text: "Criterio válido de rúbrica" })
  const bad = draft({ item_text: "Alternativa sin clave", question_type: "multiple_choice" })
  const r = applyBulkConfirmToDrafts([ok, bad])
  assert.equal(r.confirmedCount, 1)
  assert.equal(r.skippedCount, 1)
  assert.equal(r.next[0].itemConfirmed, true)
  assert.equal(r.next[1].itemConfirmed, false)
  assert.equal(r.next[1].item_text.value, "Alternativa sin clave")
})

test("T21: fixture PDF genérico → confirmable no depende del mime", () => {
  const d = draft({ item_text: "Criterio extraído de PDF genérico", rubric_text: "Descriptor nivel 2" })
  const payload = draftRowToParsedLine(d)
  assert.equal("mime" in payload, false)
  assertConfirmable(d, true)
})

test("T22: fixture Word genérico → confirmable no depende del mime", () => {
  const d = draft({ item_text: "Criterio extraído de DOCX genérico", rubric_text: "Descriptor nivel 4" })
  assertConfirmable(d, true)
})

test("T23: Lenguaje — confirmación no hardcodea asignatura", () => {
  const d = draft({
    item_text: "Infiere el propósito del hablante",
    axis_label: "Lectura",
    skill_label: "Inferir",
  })
  assertConfirmable(d, true)
})

test("T24: Matemática — confirmación no hardcodea asignatura", () => {
  const d = draft({
    item_text: "Determina el valor de x",
    question_type: "multiple_choice",
    correct_answer: "B",
    axis_label: "Álgebra",
    skill_label: "Resolver",
  })
  assertConfirmable(d, true)
})

test("T25: Artes sin canonical subject → no crash / no bloqueo artificial", () => {
  const d = draft({
    item_text: "Justifica la elección de materiales en la obra",
    axis_label: "Artes visuales",
    skill_label: "Justificar",
    question_type: null,
  })
  assertConfirmable(d, true)
  const src = fs.readFileSync(DRAFT_SRC, "utf8")
  assert.doesNotMatch(src, /toCanonicalSubjectLabel/)
  assert.doesNotMatch(src, /Lenguaje|Matemática|Historia|Ciencias|Inglés|Artes/)
})

test("T26: error Smart Extract → no false complete", () => {
  const r = applyBulkConfirmToDrafts([])
  assert.equal(r.confirmedCount, 0)
  const emptyText = draft({ item_text: "" })
  assert.equal(teacherFacingRowStatus(emptyText), "Falta revisar")
  assertConfirmable(emptyText, false)
})

test("T27: reupload recalcula sobre el draft actual", () => {
  const first = draft({ item_text: "Criterio A" })
  const r1 = applyBulkConfirmToDrafts([first])
  assert.equal(r1.next[0].itemConfirmed, true)
  const reuploaded = draft({ item_text: "Criterio B re-extraído" })
  assert.equal(reuploaded.itemConfirmed, false)
  assertConfirmable(reuploaded, true)
})

test("T28: cambio de base recalcula (función pura del draft vigente)", () => {
  const a = draft({ item_number: 1, item_text: "Ítem base A" })
  const b = draft({ item_number: 1, item_text: "Ítem base B distinta" })
  assert.notEqual(a.item_text.value, b.item_text.value)
  assertConfirmable(a, true)
  assertConfirmable(b, true)
})

test("T29: R4/QR-R4/QR-R6 no afectan este flujo", () => {
  const draftSrc = fs.readFileSync(DRAFT_SRC, "utf8")
  const dialogSrc = fs.readFileSync(DIALOG_SRC, "utf8")
  for (const src of [draftSrc, dialogSrc]) {
    assert.doesNotMatch(src, /shouldEnqueueSelectiveRetry/)
    assert.doesNotMatch(src, /linkFinalEvaluationToBatchSlot/)
    assert.doesNotMatch(src, /runAzureVisualBlankRescue/)
    assert.doesNotMatch(src, /persist-evaluation/)
  }
})

test("T30: import payload PRE≡POST salvo estado confirmed", () => {
  const before = draft({
    item_text: "Compara dos obras",
    question_type: "essay",
    max_score: 3,
    axis_label: "Artes",
    skill_label: "Comparar",
    cognitive_level: "analizar",
    competence: null,
    difficulty: null,
    correct_answer: null,
    rubric_text: "Usa vocabulario disciplinar",
  })
  const payloadBefore = draftRowToParsedLine(before)
  const after = confirmDraftItem(before)
  const payloadAfter = draftRowToParsedLine(after)
  assert.deepEqual(payloadAfter, payloadBefore)
  assert.equal(before.itemConfirmed, false)
  assert.equal(after.itemConfirmed, true)
  const bulk = applyBulkConfirmToDrafts([before])
  assert.deepEqual(draftRowToParsedLine(bulk.next[0]), payloadBefore)
})

test("Historia / Ciencias / Inglés / asignatura desconocida: sin hardcode", () => {
  const subjects = [
    { item_text: "Explica una causa de la independencia", axis_label: "Historia" },
    { item_text: "Describe el ciclo del agua", axis_label: "Ciencias" },
    { item_text: "Choose the correct tense", axis_label: "Inglés", question_type: "multiple_choice" as const, correct_answer: "A" },
    { item_text: "Criterio de una asignatura no listada", axis_label: "Tecnología" },
  ]
  for (const s of subjects) {
    assertConfirmable(draft(s), true)
  }
})

test("Confirmar no inventa datos en ningún campo opcional", () => {
  const d = draft({
    item_text: "Descriptor abierto",
    question_type: null,
    max_score: null,
    axis_label: null,
    skill_label: null,
    cognitive_level: null,
    competence: null,
    difficulty: null,
    correct_answer: null,
  })
  const after = applyBulkConfirmToDrafts([d]).next[0]
  assert.equal(after.question_type.value, null)
  assert.equal(after.max_score.value, null)
  assert.equal(after.axis_label.value, null)
  assert.equal(after.skill_label.value, null)
  assert.equal(after.cognitive_level.value, null)
  assert.equal(after.competence.value, null)
  assert.equal(after.difficulty.value, null)
  assert.equal(after.correct_answer.value, null)
})

test("Import mínimo: item_number + item_text bastan para payload", () => {
  const d = draft({ item_number: 7, item_text: "Criterio importable" })
  const payload = draftRowToParsedLine(d)
  assert.equal(payload.item_number, 7)
  assert.equal(payload.item_text.trim().length > 0, true)
})

async function run(): Promise<void> {
  void ROOT
  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`PASS ${t.name}`)
    } catch (err) {
      failed += 1
      console.error(`FAIL ${t.name}`)
      console.error(err)
    }
  }
  console.log(`\nBASE-RUBRIC-R1: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void run()
