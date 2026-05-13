/**
 * Identificador canónico único para ítems cerrados OMR: C<n>.
 * Toda alineación entre detecciones, tabla y pauta debe usar este espacio de claves, no índices de arreglo.
 */

export type CanonicalClosedId = `C${number}`

/** Prioridad ante conflictos de alias (menor = más autoritativo). */
function aliasFormPriority(rawKeyUpper: string): number {
  const t = rawKeyUpper.trim().toUpperCase()
  if (/^C\d+$/.test(t)) return 0
  if (/^SM\d+$/.test(t)) return 1
  if (/^VF\d+$/.test(t) || /^TP\d+$/.test(t)) return 2
  if (/^\d+$/.test(t)) return 3
  return 4
}

/**
 * Normaliza ids de ítems cerrados a `C<n>`.
 * Desarrollo (P{n}, DES, etc.) → null (no participa en flujo cerrado).
 */
export function normalizeToCanonicalId(rawId: unknown): string | null {
  if (rawId == null) return null
  let t = String(rawId).trim().toUpperCase()
  if (!t) return null
  if (t.startsWith("P") && /^P\d+$/.test(t)) return null
  const idLower = t.toLowerCase()
  if (idLower.includes("DESARROLLO")) return null
  if (idLower === "DES" || idLower === "ESSAY" || idLower === "SHORT_ANSWER" || idLower === "OPEN") return null

  const c = t.match(/^C(\d+)$/)
  if (c) return `C${c[1]}`
  const sm = t.match(/^SM(\d+)$/)
  if (sm) return `C${sm[1]}`
  const vf = t.match(/^VF(\d+)$/)
  if (vf) return `C${vf[1]}`
  const tp = t.match(/^TP(\d+)$/)
  if (tp) return `C${tp[1]}`
  if (/^\d+$/.test(t)) return `C${t}`
  const anyNum = t.match(/(\d+)/)
  if (anyNum) return `C${anyNum[1]}`
  return null
}

/** Clave estable para mapas de detección (cerradas). */
export function cerradaMapKeyFromPregunta(pregunta: unknown): string {
  const c = normalizeToCanonicalId(pregunta)
  if (c) return c
  return String(pregunta ?? "").trim().toUpperCase()
}

export type DedupedAlternativasMapResult = {
  map: Map<string, string>
  warnings: string[]
}

/**
 * Colapsa pauta "SM1:A; 1:B; C1:A" a un único valor por C1, con prioridad C > SM > VF/TP > numérico.
 */
export function dedupePautaAlternativasToCanonicalMap(pautaCorrectaAlternativas: string): DedupedAlternativasMapResult {
  const warnings: string[] = []
  const map = new Map<string, string>()
  if (!pautaCorrectaAlternativas || typeof pautaCorrectaAlternativas !== "string") {
    return { map, warnings }
  }
  type Entry = { rawKey: string; canon: string; val: string; pri: number; ord: number }
  const entries: Entry[] = []
  let ord = 0
  for (const part of pautaCorrectaAlternativas.split(";")) {
    const p = part.trim()
    if (!p) continue
    const idx = p.indexOf(":")
    if (idx <= 0) continue
    const rawKey = p.slice(0, idx).trim()
    const valRaw = p.slice(idx + 1).trim()
    if (!rawKey || !valRaw) continue
    const canon = normalizeToCanonicalId(rawKey)
    if (!canon) continue
    const val = valRaw.toUpperCase()
    entries.push({
      rawKey,
      canon,
      val,
      pri: aliasFormPriority(rawKey.toUpperCase()),
      ord: ord++,
    })
  }

  const byCanon = new Map<string, Entry[]>()
  for (const e of entries) {
    const list = byCanon.get(e.canon) ?? []
    list.push(e)
    byCanon.set(e.canon, list)
  }

  for (const [canon, list] of byCanon) {
    const distinctVals = [...new Set(list.map((x) => x.val))]
    if (distinctVals.length > 1) {
      const detail = list.map((x) => `${x.rawKey}:${x.val}`).join(", ")
      warnings.push(
        `[canonical_pauta_conflict] ${canon} tiene respuestas distintas (${detail}); se aplica prioridad C > SM > numérico.`,
      )
    }
    const sorted = [...list].sort((a, b) => a.pri - b.pri || a.ord - b.ord)
    map.set(canon, sorted[0]!.val)
  }

  return { map, warnings }
}
