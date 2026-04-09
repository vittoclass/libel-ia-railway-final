import fs from "node:fs"
import path from "node:path"
import { createClient } from "@supabase/supabase-js"

const evaluationId = "038e28b1-4002-4fb7-9280-68d5bd303a93"

function loadEnvFile(envPath) {
  const text = fs.readFileSync(envPath, "utf8")
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const eqIdx = line.indexOf("=")
    if (eqIdx <= 0) continue
    const key = line.slice(0, eqIdx).trim()
    const value = line.slice(eqIdx + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

const envPath = path.join(process.cwd(), ".env.local")
if (fs.existsSync(envPath)) loadEnvFile(envPath)

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY")
}

const answersTemplate = [
  { item: 1, key: "B", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Media" } },
  { item: 2, key: "D", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Relacionar", difficulty: "Difícil" } },
  { item: 3, key: "A", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Inferir", difficulty: "Muy Difícil" } },
  { item: 4, key: "A", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Fácil" } },
  { item: 5, key: "C", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Sintetizar", difficulty: "Media" } },
  { item: 6, key: "C", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Relacionar", difficulty: "Muy Difícil" } },
  { item: 7, key: "C", points: 1.0, metadata: { skill: "Reflexionar", spec: "Evaluar", difficulty: "Muy Difícil" } },
  { item: 8, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Inferir", difficulty: "Media" } },
  { item: 9, key: "A", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Difícil" } },
  { item: 10, key: "C", points: 1.0, metadata: { skill: "Reflexionar", spec: "Juzgar", difficulty: "Difícil" } },
  { item: 11, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Relacionar", difficulty: "Muy Difícil" } },
  { item: 12, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Inferir", difficulty: "Difícil" } },
  { item: 13, key: "D", points: 1.0, metadata: { skill: "Reflexionar", spec: "Evaluar", difficulty: "Difícil" } },
  { item: 14, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Sintetizar", difficulty: "Media" } },
  { item: 15, key: "A", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Fácil" } },
  { item: 16, key: "D", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Muy Fácil" } },
  { item: 17, key: "C", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Relacionar", difficulty: "Media" } },
  { item: 18, key: "C", points: 1.0, metadata: { skill: "Reflexionar", spec: "Evaluar", difficulty: "Crítica" } },
  { item: 19, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Inferir", difficulty: "Fácil" } },
  { item: 20, key: "A", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Fácil" } },
  { item: 21, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Relacionar", difficulty: "Fácil" } },
  { item: 22, key: "D", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Inferir", difficulty: "Difícil" } },
  { item: 23, key: "A", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Fácil" } },
  { item: 24, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Sintetizar", difficulty: "Difícil" } },
  { item: 25, key: "D", points: 1.0, metadata: { skill: "Reflexionar", spec: "Evaluar", difficulty: "Muy Difícil" } },
  { item: 26, key: "B", points: 1.0, metadata: { skill: "Reflexionar", spec: "Juzgar", difficulty: "Muy Difícil" } },
  { item: 27, key: "C", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Relacionar", difficulty: "Muy Difícil" } },
  { item: 28, key: "D", points: 1.0, metadata: { skill: "Reflexionar", spec: "Evaluar", difficulty: "Media" } },
  { item: 29, key: "B", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Fácil" } },
  { item: 30, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Inferir", difficulty: "Fácil" } },
  { item: 31, key: "C", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Relacionar", difficulty: "Fácil" } },
  { item: 32, key: "C", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Sintetizar", difficulty: "Fácil" } },
  { item: 33, key: "A", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Media" } },
  { item: 34, key: "C", points: 1.0, metadata: { skill: "Reflexionar", spec: "Evaluar", difficulty: "Media" } },
  { item: 35, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Inferir", difficulty: "Media" } },
  { item: 36, key: "A", points: 1.0, metadata: { skill: "Localizar Información", spec: "Identificar", difficulty: "Difícil" } },
  { item: 37, key: "B", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Relacionar", difficulty: "Media" } },
  { item: 38, key: "C", points: 1.0, metadata: { skill: "Reflexionar", spec: "Evaluar", difficulty: "Media" } },
  { item: 39, key: "C", points: 1.0, metadata: { skill: "Reflexionar", spec: "Juzgar", difficulty: "Fácil" } },
  { item: 40, key: "C", points: 1.0, metadata: { skill: "Interpretar y Relacionar", spec: "Inferir", difficulty: "Difícil" } },
]

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data, error } = await supabase
  .from("evaluations")
  .update({
    answers_template: answersTemplate,
    total_questions: 40,
    total_points: 40.0,
  })
  .eq("id", evaluationId)
  .select("id, total_questions, total_points, answers_template")
  .maybeSingle()

if (error) throw error
if (!data) throw new Error("No se encontró la evaluación para actualizar")

console.log(
  JSON.stringify(
    {
      ok: true,
      id: data.id,
      total_questions: data.total_questions,
      total_points: data.total_points,
      answers_template_count: Array.isArray(data.answers_template) ? data.answers_template.length : null,
    },
    null,
    2
  )
)
