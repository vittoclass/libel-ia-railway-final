/**
 * S3.11 — Estación QR en nueva pestaña cuando Course Contexts está ON.
 * OFF debe ser idéntico a PRE (mismo href, sin target, sin rel).
 * Ejecutar: npx tsx app/lib/__tests__/course-contexts-s3-11-qr-new-tab.test.ts
 */
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { isCourseContextsEnabled } from "../course-contexts/flag"

type TestFn = () => void | Promise<void>
const tests: Array<{ name: string; fn: TestFn }> = []
let passed = 0
let failed = 0
function test(name: string, fn: TestFn): void {
  tests.push({ name, fn })
}

const ROOT = process.cwd()
const PANEL = path.join(ROOT, "app", "components", "teacher-wizard", "SessionConfigPanel.tsx")
const EVALUATOR = path.join(ROOT, "app", "EvaluatorClient.tsx")
const SWITCHER = path.join(ROOT, "app", "components", "evaluator", "CourseContextSwitcher.tsx")
const STORE = path.join(ROOT, "app", "lib", "course-contexts", "store.ts")
const FLAG = path.join(ROOT, "app", "lib", "course-contexts", "flag.ts")
const ESTACION = path.join(ROOT, "app", "(main)", "docente", "estacion", "DocenteEstacionClient.tsx")
const ACTIVE_BATCH = path.join(ROOT, "app", "lib", "docente", "active-batch-id.ts")
const MOVIL = path.join(ROOT, "app", "(main)", "docente", "movil-scan", "MovilScanClient.tsx")
const USE_EVAL = path.join(ROOT, "app", "useEvaluator.ts")
const HOME = path.join(ROOT, "app", "components", "HomeDashboardSection.tsx")

function srcOf(p: string): string {
  return fs.readFileSync(p, "utf8")
}

function gitDiff(rel: string): string {
  return execFileSync("git", ["diff", "--", rel], { cwd: ROOT, encoding: "utf8" })
}

function qrLinkBlock(src: string): string {
  const re = /<Link\b[\s\S]*?href=["']\/docente\/estacion["'][\s\S]*?<\/Link>/
  const m = src.match(re)
  assert.ok(m, "No se encontró el Link href=/docente/estacion en SessionConfigPanel")
  return m[0]
}

function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

test("T1 feature OFF: href sigue siendo /docente/estacion", () => {
  assert.equal(isCourseContextsEnabled({}), false)
  const block = qrLinkBlock(srcOf(PANEL))
  assert.match(block, /href=["']\/docente\/estacion["']/)
})

test("T2 feature OFF: target NO es _blank", () => {
  assert.equal(isCourseContextsEnabled({}), false)
  const src = srcOf(PANEL)
  assert.match(src, /isCourseContextsEnabled\(\)/)
  assert.match(src, /target=\{courseContextsEnabled \? "_blank" : undefined\}/)
  const enabled = isCourseContextsEnabled({})
  const target = enabled ? "_blank" : undefined
  assert.equal(target, undefined)
})

test("T3 feature OFF: rel NO altera navegación PRE", () => {
  assert.equal(isCourseContextsEnabled({}), false)
  const src = srcOf(PANEL)
  assert.match(src, /rel=\{courseContextsEnabled \? "noopener noreferrer" : undefined\}/)
  const enabled = isCourseContextsEnabled({})
  const rel = enabled ? "noopener noreferrer" : undefined
  assert.equal(rel, undefined)
})

test("T4 feature ON: href sigue siendo /docente/estacion", () => {
  assert.equal(isCourseContextsEnabled({ NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED: "true" }), true)
  const block = qrLinkBlock(srcOf(PANEL))
  assert.match(block, /href=["']\/docente\/estacion["']/)
})

test("T5 feature ON: target = _blank", () => {
  const enabled = isCourseContextsEnabled({ NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED: "true" })
  assert.equal(enabled, true)
  const src = srcOf(PANEL)
  assert.match(src, /target=\{courseContextsEnabled \? "_blank" : undefined\}/)
  const target = enabled ? "_blank" : undefined
  assert.equal(target, "_blank")
})

test("T6 feature ON: rel contiene noopener", () => {
  const enabled = isCourseContextsEnabled({ NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED: "true" })
  const src = srcOf(PANEL)
  assert.match(src, /rel=\{courseContextsEnabled \? "noopener noreferrer" : undefined\}/)
  const rel = enabled ? "noopener noreferrer" : undefined
  assert.ok(rel && rel.split(/\s+/).includes("noopener"))
})

test("T7 feature ON: rel contiene noreferrer", () => {
  const enabled = isCourseContextsEnabled({ NEXT_PUBLIC_COURSE_CONTEXTS_ENABLED: "true" })
  const src = srcOf(PANEL)
  assert.match(src, /rel=\{courseContextsEnabled \? "noopener noreferrer" : undefined\}/)
  const rel = enabled ? "noopener noreferrer" : undefined
  assert.ok(rel && rel.split(/\s+/).includes("noreferrer"))
})

test("T8 no window.open", () => {
  const src = stripComments(srcOf(PANEL))
  assert.doesNotMatch(src, /window\.open/)
})

test("T9 no router.push nuevo", () => {
  const src = stripComments(srcOf(PANEL))
  assert.doesNotMatch(src, /useRouter/)
  assert.doesNotMatch(src, /router\.push/)
})

test("T10 onClose existente sigue conectado", () => {
  const block = qrLinkBlock(srcOf(PANEL))
  assert.match(block, /onClick=\{onClose\}/)
})

test("T11 no nuevo estado React para QR", () => {
  const src = srcOf(PANEL)
  assert.doesNotMatch(src, /useState\([^)]*qr/i)
  assert.doesNotMatch(src, /useState\([^)]*estacion/i)
  assert.doesNotMatch(src, /useState\([^)]*station/i)
  const uses = [...src.matchAll(/=\s*useState/g)]
  assert.equal(uses.length, 4, "PRE tenía 4 useState; no agregar estado QR")
})

test("T12 no escritura localStorage nueva", () => {
  const src = stripComments(srcOf(PANEL))
  assert.doesNotMatch(src, /localStorage/)
  assert.doesNotMatch(src, /writeDocenteActiveBatchId/)
})

test("T13 no UUID nuevo", () => {
  const src = stripComments(srcOf(PANEL))
  assert.doesNotMatch(src, /randomUUID/)
  assert.doesNotMatch(src, /crypto\.getRandomValues/)
})

test("T14 no modificación de activeBatch helper", () => {
  assert.equal(gitDiff("app/lib/docente/active-batch-id.ts").trim(), "")
  assert.doesNotMatch(srcOf(PANEL), /active-batch-id/)
})

test("T15 no modificación de DocenteEstacionClient", () => {
  assert.equal(gitDiff("app/(main)/docente/estacion/DocenteEstacionClient.tsx").trim(), "")
})

test("T16 no modificación de EvaluatorClient", () => {
  assert.equal(gitDiff("app/EvaluatorClient.tsx").trim(), "")
})

test("T17 no modificación de store", () => {
  assert.equal(gitDiff("app/lib/course-contexts/store.ts").trim(), "")
})

test("T18 feature OFF = comportamiento PRE", () => {
  assert.equal(isCourseContextsEnabled({}), false)
  const enabled = isCourseContextsEnabled({})
  assert.equal(enabled ? "_blank" : undefined, undefined)
  assert.equal(enabled ? "noopener noreferrer" : undefined, undefined)
  const block = qrLinkBlock(srcOf(PANEL))
  assert.match(block, /href=["']\/docente\/estacion["']/)
  assert.match(block, /onClick=\{onClose\}/)
  assert.doesNotMatch(block, /window\.open/)
})

test("T19 solo el Link auditado cambia comportamiento", () => {
  const src = srcOf(PANEL)
  const links = [...src.matchAll(/<Link\b/g)]
  assert.equal(links.length, 1, "debe existir un solo Link en SessionConfigPanel")
  assert.match(src, /from ["']@\/app\/lib\/course-contexts\/flag["']/)
  assert.match(src, /const courseContextsEnabled = isCourseContextsEnabled\(\)/)
})

test("T20 no navegación global alterada", () => {
  assert.equal(gitDiff("app/components/HomeDashboardSection.tsx").trim(), "")
  assert.equal(gitDiff("app/components/evaluator/CourseContextSwitcher.tsx").trim(), "")
  assert.equal(gitDiff("app/lib/course-contexts/flag.ts").trim(), "")
  assert.equal(gitDiff("app/useEvaluator.ts").trim(), "")
  assert.doesNotMatch(srcOf(HOME), /target=["']_blank["'][\s\S]{0,80}\/docente\/estacion|\/docente\/estacion[\s\S]{0,80}target=["']_blank["']/)
})

test("LIFECYCLE: ON declara target=_blank en el Link de producción", () => {
  const src = srcOf(PANEL)
  const block = qrLinkBlock(src)
  assert.match(block, /target=\{courseContextsEnabled \? "_blank" : undefined\}/)
  assert.match(block, /rel=\{courseContextsEnabled \? "noopener noreferrer" : undefined\}/)
})

test("ON no escribe batch ni contextos", () => {
  const src = stripComments(srcOf(PANEL))
  assert.doesNotMatch(src, /writeDocenteActiveBatchId/)
  assert.doesNotMatch(src, /setBatchId/)
  assert.doesNotMatch(src, /createContext\(/)
  assert.doesNotMatch(src, /executeSwitch/)
  assert.doesNotMatch(src, /activeContextId/)
})

test("archivos prohibidos no se tocan", () => {
  for (const rel of [
    "app/EvaluatorClient.tsx",
    "app/components/evaluator/CourseContextSwitcher.tsx",
    "app/lib/course-contexts/store.ts",
    "app/lib/course-contexts/flag.ts",
    "app/(main)/docente/estacion/DocenteEstacionClient.tsx",
    "app/lib/docente/active-batch-id.ts",
    "app/(main)/docente/movil-scan/MovilScanClient.tsx",
    "app/useEvaluator.ts",
  ]) {
    assert.equal(gitDiff(rel).trim(), "", `diff inesperado en ${rel}`)
  }
  assert.ok(fs.existsSync(EVALUATOR))
  assert.ok(fs.existsSync(SWITCHER))
  assert.ok(fs.existsSync(STORE))
  assert.ok(fs.existsSync(FLAG))
  assert.ok(fs.existsSync(ESTACION))
  assert.ok(fs.existsSync(ACTIVE_BATCH))
  assert.ok(fs.existsSync(MOVIL))
  assert.ok(fs.existsSync(USE_EVAL))
})

async function run(): Promise<void> {
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
  console.log(`\nS3.11: ${passed} passed, ${failed} failed, ${tests.length} total`)
  if (failed > 0) process.exit(1)
}

void run()
