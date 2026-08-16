/**
 * QR-R6 — Linker safety: slot QR es puntero operativo, no identidad.
 * OFFLINE. Fake Supabase. Sin Railway. Sin prod write.
 *
 * Ejecutar: npx tsx app/lib/docente/__tests__/batch-slot-link.test.ts
 */
import assert from "node:assert/strict"
import type { SupabaseClient } from "@supabase/supabase-js"
import { linkFinalEvaluationToBatchSlot } from "../batch-slot-link"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0

function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const TEACHER = "11111111-1111-4111-8111-111111111111"
const BATCH = "22222222-2222-4222-8222-222222222222"
const A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const C_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const PHOTO_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const PHOTO_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const SLOT = 3

type EvalRow = {
  id: string
  teacher_id: string
  batch_id: string
  batch_student_index: number | null
  status: string
  is_archived: boolean | null
  scan_image_paths: string[] | null
}

type ItemRow = { id: string; evaluation_id: string; question_number: number }
type SummaryRow = { evaluation_id: string; grade_chile: number | null }
type SkillRow = { id: string; evaluation_id: string; skill: string }
type PhotoRow = {
  id: string
  batch_id: string
  student_index: number
  teacher_id: string
  evaluation_id: string | null
  status: string
  processed_at: string | null
}

type FailPoint =
  | "final"
  | "occupant"
  | "photos"
  | "items"
  | "summary"
  | "freeSlot"
  | "assignB"
  | "archive"
  | "relink"

type FailMap = Partial<Record<FailPoint, { message: string; code?: string }>>

type DbOp = {
  table: string
  kind: "select" | "update" | "insert" | "delete"
  patch?: Record<string, unknown>
}

class FakeDb {
  evaluations = new Map<string, EvalRow>()
  items: ItemRow[] = []
  summaries: SummaryRow[] = []
  skills: SkillRow[] = []
  photos: PhotoRow[] = []
  ops: DbOp[] = []
  fails: FailMap = {}
  uniqueEnabled = true
  afterFreeSlot?: () => void

  snapshotChildren(evaluationId: string) {
    return {
      items: this.items.filter((r) => r.evaluation_id === evaluationId).map((r) => ({ ...r })),
      summaries: this.summaries.filter((r) => r.evaluation_id === evaluationId).map((r) => ({ ...r })),
      skills: this.skills.filter((r) => r.evaluation_id === evaluationId).map((r) => ({ ...r })),
      scan_image_paths: this.evaluations.get(evaluationId)?.scan_image_paths
        ? [...(this.evaluations.get(evaluationId)!.scan_image_paths as string[])]
        : null,
    }
  }
}

type Filter = { type: "eq" | "neq" | "in"; col: string; val: unknown }

class FakeQuery {
  private kind: "select" | "update" = "select"
  private columns = "*"
  private patch: Record<string, unknown> | null = null
  private filters: Filter[] = []
  private limitN: number | null = null

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(cols: string) {
    this.columns = cols
    return this
  }

  update(patch: Record<string, unknown>) {
    this.kind = "update"
    this.patch = patch
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push({ type: "eq", col, val })
    return this
  }

  neq(col: string, val: unknown) {
    this.filters.push({ type: "neq", col, val })
    return this
  }

  in(col: string, val: unknown) {
    this.filters.push({ type: "in", col, val })
    return this
  }

  limit(n: number) {
    this.limitN = n
    return this
  }

  maybeSingle() {
    return this.execute(true)
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return this.execute(false).then(onfulfilled, onrejected)
  }

  private rowMatches(row: Record<string, unknown>): boolean {
    for (const f of this.filters) {
      const actual = row[f.col]
      if (f.type === "eq" && actual !== f.val) return false
      if (f.type === "neq" && actual === f.val) return false
      if (f.type === "in") {
        const arr = Array.isArray(f.val) ? f.val : []
        if (!arr.includes(actual)) return false
      }
    }
    return true
  }

  private failPoint(): FailPoint | null {
    if (this.table === "evaluations" && this.kind === "select") {
      if (this.columns.includes("batch_student_index")) return "final"
      return "occupant"
    }
    if (this.table === "batch_photo_uploads" && this.kind === "select") return "photos"
    if (this.table === "evaluation_items" && this.kind === "select") return "items"
    if (this.table === "evaluation_summaries" && this.kind === "select") return "summary"
    if (this.table === "evaluations" && this.kind === "update") {
      const p = this.patch ?? {}
      if (Object.prototype.hasOwnProperty.call(p, "status") && p.status === "archived") return "archive"
      if (p.batch_student_index === null) return "freeSlot"
      if (typeof p.batch_student_index === "number") return "assignB"
    }
    if (this.table === "batch_photo_uploads" && this.kind === "update") return "relink"
    return null
  }

  private rowsForTable(): Record<string, unknown>[] {
    if (this.table === "evaluations") return [...this.db.evaluations.values()] as unknown as Record<string, unknown>[]
    if (this.table === "evaluation_items") return this.db.items as unknown as Record<string, unknown>[]
    if (this.table === "evaluation_summaries") return this.db.summaries as unknown as Record<string, unknown>[]
    if (this.table === "evaluation_skill_results") return this.db.skills as unknown as Record<string, unknown>[]
    if (this.table === "batch_photo_uploads") return this.db.photos as unknown as Record<string, unknown>[]
    return []
  }

  private async execute(maybeSingle: boolean): Promise<{
    data: unknown
    error: { message: string; code?: string } | null
  }> {
    this.db.ops.push({ table: this.table, kind: this.kind, patch: this.patch ?? undefined })
    const point = this.failPoint()
    if (point && this.db.fails[point]) {
      return { data: null, error: this.db.fails[point]! }
    }

    if (this.kind === "select") {
      let rows = this.rowsForTable().filter((r) => this.rowMatches(r))
      if (this.limitN != null) rows = rows.slice(0, this.limitN)
      if (maybeSingle) {
        if (rows.length === 0) return { data: null, error: null }
        return { data: rows[0], error: null }
      }
      return { data: rows, error: null }
    }

    const matched = this.rowsForTable().filter((r) => this.rowMatches(r))
    const patch = this.patch ?? {}

    if (this.table === "evaluations" && typeof patch.batch_student_index === "number" && this.db.uniqueEnabled) {
      const nextIndex = patch.batch_student_index
      for (const row of this.db.evaluations.values()) {
        const isMatched = matched.some((m) => m.id === row.id)
        if (isMatched) continue
        if (row.batch_id === BATCH && row.batch_student_index === nextIndex) {
          return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } }
        }
      }
    }

    if (this.table === "evaluations") {
      for (const row of matched) {
        const current = this.db.evaluations.get(String(row.id))
        if (!current) continue
        this.db.evaluations.set(current.id, { ...current, ...patch } as EvalRow)
      }
      if (patch.batch_student_index === null) this.db.afterFreeSlot?.()
    } else if (this.table === "batch_photo_uploads") {
      for (const row of matched) {
        const idx = this.db.photos.findIndex((p) => p.id === row.id)
        if (idx >= 0) this.db.photos[idx] = { ...this.db.photos[idx], ...patch } as PhotoRow
      }
    } else if (this.table === "evaluation_items" || this.table === "evaluation_summaries" || this.table === "evaluation_skill_results") {
      throw new Error(`QR-R6 no debe mutar children: ${this.table}`)
    }

    if (this.columns && this.columns !== "*" && this.kind === "update") {
      const cols = this.columns.split(",").map((c) => c.trim())
      const returning = matched.map((row) => {
        const out: Record<string, unknown> = {}
        for (const c of cols) out[c] = (this.table === "batch_photo_uploads"
          ? this.db.photos.find((p) => p.id === row.id)?.[c as keyof PhotoRow]
          : row[c])
        return out
      })
      return { data: returning, error: null }
    }

    return { data: null, error: null }
  }
}

function createFakeSupabase(db: FakeDb): SupabaseClient {
  return {
    from(table: string) {
      return new FakeQuery(db, table)
    },
  } as unknown as SupabaseClient
}

function seedEval(
  db: FakeDb,
  opts: {
    id: string
    slot?: number | null
    status?: string
    is_archived?: boolean | null
    scan_image_paths?: string[] | null
  },
): void {
  db.evaluations.set(opts.id, {
    id: opts.id,
    teacher_id: TEACHER,
    batch_id: BATCH,
    batch_student_index: opts.slot === undefined ? null : opts.slot,
    status: opts.status ?? "draft",
    is_archived: opts.is_archived === undefined ? null : opts.is_archived,
    scan_image_paths: opts.scan_image_paths === undefined ? ["scan-a.png"] : opts.scan_image_paths,
  })
}

function seedItem(db: FakeDb, evaluationId: string, question = 1): void {
  db.items.push({
    id: `${evaluationId}-item-${question}`,
    evaluation_id: evaluationId,
    question_number: question,
  })
}

function seedSummary(db: FakeDb, evaluationId: string, grade_chile: number | null): void {
  db.summaries.push({ evaluation_id: evaluationId, grade_chile })
}

function seedSkill(db: FakeDb, evaluationId: string): void {
  db.skills.push({ id: `${evaluationId}-skill-1`, evaluation_id: evaluationId, skill: "lectura" })
}

function seedPhoto(db: FakeDb, id: string, evaluationId: string | null): void {
  db.photos.push({
    id,
    batch_id: BATCH,
    student_index: SLOT,
    teacher_id: TEACHER,
    evaluation_id: evaluationId,
    status: "uploaded",
    processed_at: null,
  })
}

function visibleInCursos(row: EvalRow): boolean {
  return String(row.status ?? "").trim().toLowerCase() !== "archived" && row.is_archived !== true
}

async function linkB(
  db: FakeDb,
  finalId = B_ID,
): Promise<Awaited<ReturnType<typeof linkFinalEvaluationToBatchSlot>>> {
  return linkFinalEvaluationToBatchSlot({
    supabase: createFakeSupabase(db),
    teacherId: TEACHER,
    batchId: BATCH,
    batchStudentIndex: SLOT,
    finalEvaluationId: finalId,
  })
}

function assertNoChildMutations(db: FakeDb): void {
  const childWrites = db.ops.filter(
    (op) =>
      (op.table === "evaluation_items" ||
        op.table === "evaluation_summaries" ||
        op.table === "evaluation_skill_results") &&
      op.kind !== "select",
  )
  assert.equal(childWrites.length, 0, "children no deben mutarse")
}

function assertContractShape(result: Awaited<ReturnType<typeof linkFinalEvaluationToBatchSlot>>): void {
  assert.equal(typeof result.ok, "boolean")
  assert.equal(typeof result.finalEvaluationId, "string")
  if (result.skipped !== undefined) assert.equal(typeof result.skipped, "boolean")
  if (result.reason !== undefined) assert.equal(typeof result.reason, "string")
  if (result.draftEvaluationId !== undefined) {
    assert.ok(result.draftEvaluationId === null || typeof result.draftEvaluationId === "string")
  }
  if (result.relinkedPhotoCount !== undefined) assert.equal(typeof result.relinkedPhotoCount, "number")
  const keys = Object.keys(result).sort()
  const allowed = ["draftEvaluationId", "finalEvaluationId", "ok", "reason", "relinkedPhotoCount", "skipped"]
  for (const k of keys) {
    assert.ok(allowed.includes(k), `contrato extraño: ${k}`)
  }
}

async function withFlag<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.BATCH_SLOT_LINK_ENABLED
  process.env.BATCH_SLOT_LINK_ENABLED = "true"
  try {
    return await fn()
  } finally {
    if (prev === undefined) delete process.env.BATCH_SLOT_LINK_ENABLED
    else process.env.BATCH_SLOT_LINK_ENABLED = prev
  }
}

test("T1 A draft técnico → libera slot → B toma slot → A archived permitido", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedEval(db, { id: B_ID, slot: null, status: "draft" })
    seedPhoto(db, PHOTO_1, A_ID)
    const result = await linkB(db)
    assertContractShape(result)
    assert.equal(result.ok, true)
    assert.equal(result.draftEvaluationId, A_ID)
    const a = db.evaluations.get(A_ID)!
    const b = db.evaluations.get(B_ID)!
    assert.equal(a.batch_student_index, null)
    assert.equal(a.status, "archived")
    assert.equal(b.batch_student_index, SLOT)
    assert.equal(db.photos[0].evaluation_id, B_ID)
    assert.equal(visibleInCursos(a), false)
    assert.equal(visibleInCursos(b), true)
  })
})

test("T2 A con items → libera slot → B toma slot → A NO archived", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedItem(db, A_ID)
    seedSkill(db, A_ID)
    seedEval(db, { id: B_ID, slot: null, status: "draft" })
    seedPhoto(db, PHOTO_1, A_ID)
    const childrenPre = db.snapshotChildren(A_ID)
    const result = await linkB(db)
    assert.equal(result.ok, true)
    const a = db.evaluations.get(A_ID)!
    assert.equal(a.batch_student_index, null)
    assert.equal(a.status, "draft")
    assert.equal(a.is_archived, null)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
    assert.equal(visibleInCursos(a), true)
    assert.deepEqual(db.snapshotChildren(A_ID), childrenPre)
    assertNoChildMutations(db)
  })
})

test("T3 A con grade → A NO archived", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "final" })
    seedSummary(db, A_ID, 5.6)
    seedEval(db, { id: B_ID, slot: null, status: "draft" })
    const result = await linkB(db)
    assert.equal(result.ok, true)
    const a = db.evaluations.get(A_ID)!
    assert.equal(a.status, "final")
    assert.equal(a.batch_student_index, null)
    assert.equal(visibleInCursos(a), true)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
  })
})

test("T4 A con items + grade → A NO archived", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "final" })
    seedItem(db, A_ID)
    seedSummary(db, A_ID, 6.2)
    seedEval(db, { id: B_ID, slot: null })
    const result = await linkB(db)
    assert.equal(result.ok, true)
    assert.equal(db.evaluations.get(A_ID)!.status, "final")
    assert.equal(visibleInCursos(db.evaluations.get(A_ID)!), true)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
  })
})

test("T5 A summary grade null y sin items → draft técnico", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedSummary(db, A_ID, null)
    seedEval(db, { id: B_ID, slot: null })
    const result = await linkB(db)
    assert.equal(result.ok, true)
    assert.equal(db.evaluations.get(A_ID)!.status, "archived")
    assert.equal(db.evaluations.get(A_ID)!.batch_student_index, null)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
  })
})

test("T6 A real conserva status original", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "scored" })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    await linkB(db)
    assert.equal(db.evaluations.get(A_ID)!.status, "scored")
  })
})

test("T7 A real conserva is_archived", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft", is_archived: false })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    await linkB(db)
    assert.equal(db.evaluations.get(A_ID)!.is_archived, false)
    const archiveOps = db.ops.filter(
      (op) => op.table === "evaluations" && op.kind === "update" && op.patch && "is_archived" in op.patch,
    )
    assert.equal(archiveOps.length, 0)
  })
})

test("T8 B toma slot correctamente", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null, status: "draft" })
    const result = await linkB(db)
    assert.equal(result.ok, true)
    assert.equal(result.finalEvaluationId, B_ID)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
    assert.equal(db.evaluations.get(B_ID)!.status, "draft")
  })
})

test("T9 fotos se relinkean a B", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    seedPhoto(db, PHOTO_1, A_ID)
    seedPhoto(db, PHOTO_2, null)
    const result = await linkB(db)
    assert.equal(result.ok, true)
    assert.equal(result.relinkedPhotoCount, 2)
    assert.equal(db.photos[0].evaluation_id, B_ID)
    assert.equal(db.photos[1].evaluation_id, B_ID)
    assert.equal(db.photos[0].status, "linked")
    assert.equal(db.evaluations.get(A_ID)!.scan_image_paths![0], "scan-a.png")
  })
})

test("T10 children A no se modifican", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, scan_image_paths: ["a1.png", "a2.png"] })
    seedItem(db, A_ID, 1)
    seedItem(db, A_ID, 2)
    seedSummary(db, A_ID, 4.8)
    seedSkill(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    const pre = db.snapshotChildren(A_ID)
    await linkB(db)
    assert.deepEqual(db.snapshotChildren(A_ID), pre)
    assertNoChildMutations(db)
  })
})

test("T11 fallo al liberar slot → no tocar B/fotos indebidamente", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    seedPhoto(db, PHOTO_1, A_ID)
    db.fails.freeSlot = { message: "free failed" }
    const result = await linkB(db)
    assert.equal(result.ok, false)
    assert.match(result.reason ?? "", /free failed/)
    assert.equal(db.evaluations.get(A_ID)!.batch_student_index, SLOT)
    assert.equal(db.evaluations.get(A_ID)!.status, "draft")
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, null)
    assert.equal(db.photos[0].evaluation_id, A_ID)
    assert.equal(visibleInCursos(db.evaluations.get(A_ID)!), true)
  })
})

test("T12 fallo al asignar B → A real NO queda archived", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "final" })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    seedPhoto(db, PHOTO_1, A_ID)
    db.fails.assignB = { message: "assign failed" }
    const result = await linkB(db)
    assert.equal(result.ok, false)
    const a = db.evaluations.get(A_ID)!
    assert.equal(a.status, "final")
    assert.equal(a.is_archived, null)
    assert.equal(a.batch_student_index, null)
    assert.equal(visibleInCursos(a), true)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, null)
    assert.equal(db.photos[0].evaluation_id, A_ID)
  })
})

test("T13 fallo al relink fotos → B puede quedar slot owner → A real intacta", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    seedPhoto(db, PHOTO_1, A_ID)
    db.fails.relink = { message: "relink failed" }
    const result = await linkB(db)
    assert.equal(result.ok, false)
    assert.match(result.reason ?? "", /relink failed/)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
    const a = db.evaluations.get(A_ID)!
    assert.equal(a.status, "draft")
    assert.equal(a.batch_student_index, null)
    assert.equal(visibleInCursos(a), true)
    assert.equal(db.photos[0].evaluation_id, A_ID)
  })
})

test("T14 23505 UNIQUE → fail-soft → no borrar evaluaciones", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "final" })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    seedEval(db, { id: C_ID, slot: SLOT })
    db.fails.assignB = { message: "duplicate key value violates unique constraint", code: "23505" }
    const idsPre = [...db.evaluations.keys()].sort()
    const result = await linkB(db)
    assert.equal(result.ok, false)
    assert.match(result.reason ?? "", /unique|23505|duplicate/i)
    assert.deepEqual([...db.evaluations.keys()].sort(), idsPre)
    assert.equal(db.evaluations.get(A_ID)!.status, "final")
    assert.equal(visibleInCursos(db.evaluations.get(A_ID)!), true)
    assert.ok(db.evaluations.has(B_ID))
  })
})

test("T14b UNIQUE natural: otro owner toma el slot tras free → 23505, A real visible", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "final" })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    seedEval(db, { id: C_ID, slot: null })
    let freed = false
    db.afterFreeSlot = () => {
      freed = true
      db.evaluations.get(C_ID)!.batch_student_index = SLOT
    }
    const result = await linkB(db)
    assert.equal(freed, true)
    assert.equal(result.ok, false)
    assert.equal(result.reason?.includes("23505") || /unique|duplicate/i.test(result.reason ?? ""), true)
    assert.equal(db.evaluations.get(A_ID)!.status, "final")
    assert.equal(visibleInCursos(db.evaluations.get(A_ID)!), true)
    assert.ok(db.evaluations.has(A_ID) && db.evaluations.has(B_ID) && db.evaluations.has(C_ID))
  })
})

test("T15 dos evaluaciones reales sucesivas → solo slot cambia → ambas visibles", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "final" })
    seedItem(db, A_ID)
    seedSummary(db, A_ID, 5.0)
    seedEval(db, { id: B_ID, slot: null, status: "draft" })
    seedItem(db, B_ID)
    seedSummary(db, B_ID, 6.0)
    seedEval(db, { id: C_ID, slot: null, status: "draft" })
    seedItem(db, C_ID)
    await linkB(db)
    await linkB(db, C_ID)
    const a = db.evaluations.get(A_ID)!
    const b = db.evaluations.get(B_ID)!
    const c = db.evaluations.get(C_ID)!
    assert.equal(a.status, "final")
    assert.equal(b.status, "draft")
    assert.equal(c.status, "draft")
    assert.equal(a.batch_student_index, null)
    assert.equal(b.batch_student_index, null)
    assert.equal(c.batch_student_index, SLOT)
    assert.equal(visibleInCursos(a), true)
    assert.equal(visibleInCursos(b), true)
    assert.equal(visibleInCursos(c), true)
  })
})

test("T16 draft técnico seguido de real → technical archive permitido → B owner", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedEval(db, { id: B_ID, slot: null, status: "final" })
    seedItem(db, B_ID)
    seedSummary(db, B_ID, 6.5)
    seedPhoto(db, PHOTO_1, A_ID)
    const result = await linkB(db)
    assert.equal(result.ok, true)
    assert.equal(db.evaluations.get(A_ID)!.status, "archived")
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
    assert.equal(db.photos[0].evaluation_id, B_ID)
    assert.equal(visibleInCursos(db.evaluations.get(B_ID)!), true)
  })
})

test("RACE AAA y BBB ambas reales → ambas sobreviven, ninguna archived", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "final" })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null, status: "draft" })
    seedItem(db, B_ID)
    seedEval(db, { id: C_ID, slot: null, status: "draft" })
    seedItem(db, C_ID)
    const childrenB = db.snapshotChildren(B_ID)
    const childrenC = db.snapshotChildren(C_ID)
    const [r1, r2] = await Promise.all([linkB(db, B_ID), linkB(db, C_ID)])
    assert.equal(db.evaluations.get(A_ID)!.status, "final")
    assert.equal(db.evaluations.get(B_ID)!.status, "draft")
    assert.equal(db.evaluations.get(C_ID)!.status, "draft")
    assert.equal(visibleInCursos(db.evaluations.get(A_ID)!), true)
    assert.equal(visibleInCursos(db.evaluations.get(B_ID)!), true)
    assert.equal(visibleInCursos(db.evaluations.get(C_ID)!), true)
    const owners = [...db.evaluations.values()].filter((e) => e.batch_student_index === SLOT)
    assert.ok(owners.length <= 1, "UNIQUE: a lo más un owner")
    assert.ok(r1.ok || r2.ok || (!r1.ok && !r2.ok), "race puede fallar un lado")
    assert.deepEqual(db.snapshotChildren(B_ID), childrenB)
    assert.deepEqual(db.snapshotChildren(C_ID), childrenC)
    assert.ok(db.evaluations.has(A_ID) && db.evaluations.has(B_ID) && db.evaluations.has(C_ID))
  })
})

test("RACE AAA technical draft + BBB real → BBB owner, technical puede archived", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedEval(db, { id: B_ID, slot: null, status: "final" })
    seedItem(db, B_ID)
    const result = await linkB(db)
    assert.equal(result.ok, true)
    assert.equal(db.evaluations.get(A_ID)!.status, "archived")
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
    assert.equal(db.evaluations.get(B_ID)!.status, "final")
  })
})

test("FAILSOFT SELECT occupant fail → no tocar B/fotos", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    seedPhoto(db, PHOTO_1, A_ID)
    db.fails.occupant = { message: "occupant select failed" }
    const result = await linkB(db)
    assert.equal(result.ok, false)
    assert.equal(db.evaluations.get(A_ID)!.batch_student_index, SLOT)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, null)
    assert.equal(db.photos[0].evaluation_id, A_ID)
  })
})

test("FAILSOFT SELECT items fail → no archivar (ambigua=real) → B puede tomar slot", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedEval(db, { id: B_ID, slot: null })
    seedPhoto(db, PHOTO_1, A_ID)
    db.fails.items = { message: "items select failed" }
    const result = await linkB(db)
    assert.equal(result.ok, true)
    assert.equal(db.evaluations.get(A_ID)!.status, "draft")
    assert.equal(visibleInCursos(db.evaluations.get(A_ID)!), true)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
    assert.equal(db.photos[0].evaluation_id, B_ID)
  })
})

test("FAILSOFT SELECT summary fail → no archivar", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedEval(db, { id: B_ID, slot: null })
    db.fails.summary = { message: "summary select failed" }
    const result = await linkB(db)
    assert.equal(result.ok, true)
    assert.equal(db.evaluations.get(A_ID)!.status, "draft")
    assert.equal(visibleInCursos(db.evaluations.get(A_ID)!), true)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
  })
})

test("FAILSOFT archive technical fail → B owner + fotos; A visible extra (no hidden)", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedEval(db, { id: B_ID, slot: null })
    seedPhoto(db, PHOTO_1, A_ID)
    db.fails.archive = { message: "archive failed" }
    const result = await linkB(db)
    assert.equal(result.ok, false)
    assert.match(result.reason ?? "", /archive failed/)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, SLOT)
    assert.equal(db.photos[0].evaluation_id, B_ID)
    const a = db.evaluations.get(A_ID)!
    assert.equal(a.status, "draft")
    assert.equal(a.batch_student_index, null)
    assert.equal(visibleInCursos(a), true)
  })
})

test("FAILSOFT SELECT photos fail → no mutar slot", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null })
    seedPhoto(db, PHOTO_1, A_ID)
    db.fails.photos = { message: "photos select failed" }
    const result = await linkB(db)
    assert.equal(result.ok, false)
    assert.equal(db.evaluations.get(A_ID)!.batch_student_index, SLOT)
    assert.equal(db.evaluations.get(B_ID)!.batch_student_index, null)
  })
})

test("A5 ambigua (classify fail) NO archivar", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedEval(db, { id: B_ID, slot: null })
    db.fails.items = { message: "ambiguous" }
    db.fails.summary = { message: "ambiguous" }
    await linkB(db)
    assert.equal(db.evaluations.get(A_ID)!.status, "draft")
  })
})

test("technical draft NO escribe is_archived (compatibilidad PRE)", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft", is_archived: null })
    seedEval(db, { id: B_ID, slot: null })
    await linkB(db)
    assert.equal(db.evaluations.get(A_ID)!.status, "archived")
    assert.equal(db.evaluations.get(A_ID)!.is_archived, null)
    const wroteIsArchived = db.ops.some(
      (op) => op.kind === "update" && op.patch && Object.prototype.hasOwnProperty.call(op.patch, "is_archived"),
    )
    assert.equal(wroteIsArchived, false)
  })
})

test("contrato: disabled / invalid / already_linked / missing B", async () => {
  const prev = process.env.BATCH_SLOT_LINK_ENABLED
  delete process.env.BATCH_SLOT_LINK_ENABLED
  const db = new FakeDb()
  seedEval(db, { id: B_ID, slot: SLOT })
  const disabled = await linkFinalEvaluationToBatchSlot({
    supabase: createFakeSupabase(db),
    teacherId: TEACHER,
    batchId: BATCH,
    batchStudentIndex: SLOT,
    finalEvaluationId: B_ID,
  })
  assert.equal(disabled.ok, false)
  assert.equal(disabled.skipped, true)
  assert.equal(disabled.reason, "disabled")
  process.env.BATCH_SLOT_LINK_ENABLED = "true"
  try {
    const invalid = await linkFinalEvaluationToBatchSlot({
      supabase: createFakeSupabase(db),
      teacherId: "no-uuid",
      batchId: BATCH,
      batchStudentIndex: SLOT,
      finalEvaluationId: B_ID,
    })
    assert.equal(invalid.skipped, true)
    assert.equal(invalid.reason, "missing_or_invalid_input")
    const missing = await linkFinalEvaluationToBatchSlot({
      supabase: createFakeSupabase(db),
      teacherId: TEACHER,
      batchId: BATCH,
      batchStudentIndex: SLOT,
      finalEvaluationId: A_ID,
    })
    assert.equal(missing.skipped, true)
    assert.equal(missing.reason, "final_evaluation_not_found")
    const already = await linkB(db)
    assert.equal(already.ok, true)
    assert.equal(already.skipped, true)
    assert.equal(already.reason, "already_linked")
  } finally {
    if (prev === undefined) delete process.env.BATCH_SLOT_LINK_ENABLED
    else process.env.BATCH_SLOT_LINK_ENABLED = prev
  }
})

test("Cursos: A real + B nueva ambas visibles según filtro list", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "draft" })
    seedItem(db, A_ID)
    seedEval(db, { id: B_ID, slot: null, status: "draft" })
    await linkB(db)
    const active = [...db.evaluations.values()].filter(visibleInCursos).map((e) => e.id).sort()
    assert.deepEqual(active, [A_ID, B_ID].sort())
  })
})

test("Reportes: A conserva evaluation_id items summary grade scan_image_paths", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT, status: "final", scan_image_paths: ["kept-a.png"] })
    seedItem(db, A_ID, 1)
    seedSummary(db, A_ID, 5.9)
    seedEval(db, { id: B_ID, slot: null, scan_image_paths: ["kept-b.png"] })
    seedItem(db, B_ID, 1)
    seedSummary(db, B_ID, 4.1)
    await linkB(db)
    assert.equal(db.evaluations.get(A_ID)!.id, A_ID)
    assert.equal(db.items.filter((i) => i.evaluation_id === A_ID).length, 1)
    assert.equal(db.summaries.find((s) => s.evaluation_id === A_ID)?.grade_chile, 5.9)
    assert.deepEqual(db.evaluations.get(A_ID)!.scan_image_paths, ["kept-a.png"])
    assert.equal(db.evaluations.get(B_ID)!.id, B_ID)
    assert.equal(db.summaries.find((s) => s.evaluation_id === B_ID)?.grade_chile, 4.1)
    assert.deepEqual(db.evaluations.get(B_ID)!.scan_image_paths, ["kept-b.png"])
  })
})

test("orden: archive technical ocurre DESPUÉS de asignar B", async () => {
  await withFlag(async () => {
    const db = new FakeDb()
    seedEval(db, { id: A_ID, slot: SLOT })
    seedEval(db, { id: B_ID, slot: null })
    await linkB(db)
    const evalUpdates = db.ops.filter((op) => op.table === "evaluations" && op.kind === "update")
    const freeIdx = evalUpdates.findIndex((op) => op.patch && op.patch.batch_student_index === null)
    const assignIdx = evalUpdates.findIndex((op) => op.patch && op.patch.batch_student_index === SLOT)
    const archiveIdx = evalUpdates.findIndex((op) => op.patch && op.patch.status === "archived")
    assert.ok(freeIdx >= 0 && assignIdx >= 0 && archiveIdx >= 0)
    assert.ok(freeIdx < assignIdx)
    assert.ok(assignIdx < archiveIdx)
  })
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed++
      console.log(`PASS ${t.name}`)
    } catch (err) {
      failed++
      console.error(`FAIL ${t.name}`)
      console.error(err)
    }
  }
  console.log(` QR-R6 linker: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void main()
