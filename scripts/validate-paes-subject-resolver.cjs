/**
 * Validación local read-only del resolver PAES (P4B.2).
 * Ejecutar: node scripts/validate-paes-subject-resolver.cjs
 */
const fs = require("fs")
const path = require("path")
const vm = require("vm")
const ts = require("typescript")

const resolverPath = path.join(__dirname, "../app/lib/paesSubjectResolver.ts")
const source = fs.readFileSync(resolverPath, "utf8")

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
})

const sandbox = { module: { exports: {} }, exports: {}, require }
vm.runInNewContext(
  `${transpiled.outputText}\nmodule.exports.resolvePaesSubjectFromContext = resolvePaesSubjectFromContext;`,
  sandbox,
  { filename: resolverPath }
)

const { resolvePaesSubjectFromContext } = sandbox.module.exports

const cases = [
  {
    label: "PAES Competencia Lectora 2025",
    input: { evaluation_title: "PAES Competencia Lectora 2025" },
    expectSubject: "COMPETENCIA_LECTORA",
    expectMinConfidence: "medium",
  },
  {
    label: "Ensayo PAES M1",
    input: { evaluation_title: "Ensayo PAES M1" },
    expectSubject: "MATEMATICA_M1",
    expectMinConfidence: "medium",
  },
  {
    label: "PAES Matemática M2",
    input: { evaluation_title: "PAES Matemática M2" },
    expectSubject: "MATEMATICA_M2",
    expectMinConfidence: "medium",
  },
  {
    label: "PAES Historia y Ciencias Sociales",
    input: { evaluation_title: "PAES Historia y Ciencias Sociales" },
    expectSubject: "HISTORIA",
    expectMinConfidence: "medium",
  },
  {
    label: "PAES Ciencias Biología",
    input: { evaluation_title: "PAES Ciencias Biología" },
    expectSubject: "CIENCIAS",
    expectMinConfidence: "medium",
  },
  {
    label: "Prueba de Lenguaje 8 básico (no PAES)",
    input: { evaluation_title: "Prueba de Lenguaje 8 básico" },
    expectSubject: null,
    expectConfidence: "low",
  },
  {
    label: "ENSAYO_PAES por categoría + M1 en título",
    input: {
      assessment_category: "ENSAYO_PAES",
      evaluation_title: "Simulacro M1 curso 4°M",
    },
    expectSubject: "MATEMATICA_M1",
    expectMinConfidence: "high",
  },
]

const rank = { low: 0, medium: 1, high: 2 }

let failed = 0
console.log("=== validate-paes-subject-resolver (P4B.2) ===\n")

for (const c of cases) {
  const result = resolvePaesSubjectFromContext(c.input)
  const subjectOk = result.paesSubject === c.expectSubject
  let confOk = true
  if (c.expectConfidence) {
    confOk = result.confidence === c.expectConfidence
  } else if (c.expectMinConfidence) {
    confOk = rank[result.confidence] >= rank[c.expectMinConfidence]
  }
  const ok = subjectOk && confOk
  if (!ok) failed += 1
  const mark = ok ? "OK" : "FAIL"
  console.log(`[${mark}] ${c.label}`)
  console.log(
    `     → ${result.paesSubject ?? "null"} (${result.confidence}) | ${result.reasons.join("; ")}`
  )
  if (!ok) {
    console.log(
      `     esperado: ${c.expectSubject ?? "null"} conf≥${c.expectConfidence ?? c.expectMinConfidence}`
    )
  }
  console.log()
}

if (failed > 0) {
  console.error(`${failed} caso(s) fallaron.`)
  process.exit(1)
}
console.log("Todos los casos pasaron.")
