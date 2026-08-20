/**
 * S3 — Integridad: motores/B1/M8/QR no tocados; capa no importa prohibidos.
 * Ejecutar: npx tsx app/lib/__tests__/course-contexts-integrity.test.ts
 */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "path"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = path.resolve(__dirname, "../../..")
const HASHES_PRE = path.join(ROOT, "_audit_course_contexts_s3", "PRE", "HASHES-PRE.txt")

function sha256File(rel: string): string {
  const buf = fs.readFileSync(path.join(ROOT, rel))
  return createHash("sha256").update(buf).digest("hex").toUpperCase()
}

function parsePreHashes(): Map<string, string> {
  const map = new Map<string, string>()
  const text = fs.readFileSync(HASHES_PRE, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-F0-9]{64})\s+\S+\s+(.+)$/.exec(line.trim())
    if (m) map.set(m[2]!.replace(/\\/g, "/"), m[1]!)
  }
  return map
}

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8")
}

const FORBIDDEN_UNCHANGED = [
  "app/lib/persist-evaluation.ts",
  "app/useEvaluator.ts",
  "app/lib/multimodal/multimodal-prompt.ts",
  "app/lib/multimodal/multimodal-vision-provider.ts",
  "app/lib/ai-evaluation-provider.ts",
  "app/lib/multimodal/evaluate-multimodal-arts.ts",
  "app/lib/desarrollo-pipeline.ts",
  "app/api/evaluate/evaluation-logic.ts",
  "app/lib/scoring/chileanGradeEngine.ts",
  "app/lib/omr-shared/azure-visual-blank-rescue.ts",
  "app/lib/omr-shared/azure-visual-blank-rescue-n2.ts",
  "app/lib/evaluation-job-runner.ts",
  "app/lib/docente/batch-slot-link.ts",
  "app/lib/docente/active-batch-id.ts",
  "app/api/docente/batch-evaluar-sync/route.ts",
  "app/api/source-exams/smart-extract/route.ts",
  "app/components/SourceExamsSection.tsx",
  "app/components/dashboard/teacher/TeacherOverview.tsx",
  "app/lib/credits.ts",
  "package.json",
  "package-lock.json",
]

test("T29-T34 T49-T50 hashes de motores/B1/M8/QR/package = PRE", () => {
  const pre = parsePreHashes()
  for (const rel of FORBIDDEN_UNCHANGED) {
    const expected = pre.get(rel)
    assert.ok(expected, `falta hash PRE de ${rel}`)
    assert.equal(sha256File(rel), expected, `hash cambió: ${rel}`)
  }
})

test("T49 no B1 imports/changes en capa S3", () => {
  const files = [
    "app/lib/course-contexts/flag.ts",
    "app/lib/course-contexts/types.ts",
    "app/lib/course-contexts/helpers.ts",
    "app/lib/course-contexts/store.ts",
    "app/components/evaluator/CourseContextSwitcher.tsx",
  ]
  for (const rel of files) {
    const src = read(rel)
    assert.doesNotMatch(src, /persist-evaluation/)
    assert.doesNotMatch(src, /beginSelectiveRetryAttempt/)
    assert.doesNotMatch(src, /evaluation-logic/)
    assert.doesNotMatch(src, /desarrollo-pipeline/)
    assert.doesNotMatch(src, /multimodal-prompt/)
    assert.doesNotMatch(src, /ai-evaluation-provider/)
    assert.doesNotMatch(src, /azure-visual-blank-rescue/)
    assert.doesNotMatch(src, /evaluation-job-runner/)
    assert.doesNotMatch(src, /batch-slot-link/)
  }
  const client = read("app/EvaluatorClient.tsx")
  assert.doesNotMatch(client, /from ["'].*persist-evaluation["']/)
  assert.match(client, /course-contexts/)
})

test("capa S3 no llama beginSelectiveRetryAttempt", () => {
  const store = read("app/lib/course-contexts/store.ts")
  const helpers = read("app/lib/course-contexts/helpers.ts")
  assert.doesNotMatch(store, /beginSelectiveRetryAttempt/)
  assert.doesNotMatch(helpers, /beginSelectiveRetryAttempt/)
  assert.doesNotMatch(store, /ensureSelectiveRetryAttempt/)
})

async function main() {
  for (const t of tests) {
    try {
      await t.fn()
      passed += 1
      console.log(`PASS ${t.name}`)
    } catch (e) {
      failed += 1
      console.error(`FAIL ${t.name}`)
      console.error(e)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void main()
