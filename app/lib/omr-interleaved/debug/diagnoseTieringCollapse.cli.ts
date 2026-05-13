/**
 * CLI AISLADO de replay forense para `pairLeftRightRowsIntoTiers` y
 * `clusterRowsByYIndexed`. Consume un `interleavedDebugSnapshot` real ya
 * persistido (mismo sourceExamId/hoja/variante de la corrida anterior) y
 * produce un reporte comparativo sin tocar producción.
 *
 * Uso:
 *   npx tsx app/lib/omr-interleaved/debug/diagnoseTieringCollapse.cli.ts \
 *     <input-snapshot.json> [output-report.json]
 *
 * Si el JSON de entrada es el wrapper `{ out: { interleavedDebugSnapshot: ... } }`
 * (como en `tmp/interleaved-forensic-output.json`) lo desempaqueta automáticamente.
 *
 * Reglas de oro:
 *   - Reversibilidad: este archivo se puede borrar sin efectos colaterales.
 *   - Aislamiento: no se importa desde rutas de producción.
 *   - Producción intacta: las funciones de cluster/partition/pair se invocan
 *     READ-ONLY por medio de `diagnoseTieringFromSnapshot`.
 */
import fs from "node:fs"
import path from "node:path"
import {
  diagnoseTieringFromSnapshot,
  type TieringCollapseComparison,
} from "./diagnoseTieringCollapse"
import type { InterleavedDebugSnapshot } from "./buildInterleavedDebugSnapshot"

type SnapshotEnvelope =
  | InterleavedDebugSnapshot
  | { interleavedDebugSnapshot: InterleavedDebugSnapshot }
  | { out: { interleavedDebugSnapshot: InterleavedDebugSnapshot } }
  | Record<string, unknown>

function unwrapSnapshot(parsed: SnapshotEnvelope): InterleavedDebugSnapshot {
  const candidate = parsed as Record<string, unknown>
  if (candidate.geometryDiagnostics || candidate.bands || candidate.pairings) {
    return candidate as unknown as InterleavedDebugSnapshot
  }
  if (candidate.interleavedDebugSnapshot) {
    return candidate.interleavedDebugSnapshot as InterleavedDebugSnapshot
  }
  if (candidate.out && typeof candidate.out === "object") {
    const inner = (candidate.out as Record<string, unknown>).interleavedDebugSnapshot
    if (inner) return inner as InterleavedDebugSnapshot
  }
  throw new Error(
    "No se pudo localizar interleavedDebugSnapshot en el archivo de entrada. " +
      "Acepta el snapshot directo, { interleavedDebugSnapshot } o { out: { interleavedDebugSnapshot } }.",
  )
}

function summarizeForConsole(report: TieringCollapseComparison): string {
  const c = report.current
  const p = report.previous
  const lines: string[] = []
  lines.push("=== diagnose-tiering-collapse (replay aislado) ===")
  lines.push("")
  lines.push("[input]")
  lines.push(
    `  totalItems=${c.inputSummary.totalItems} ` +
      `left=${c.inputSummary.leftItemCount} ` +
      `right=${c.inputSummary.rightItemCount} ` +
      `splitX=${c.inputSummary.splitX}`,
  )
  lines.push("")
  lines.push("[clustering]")
  lines.push(
    `  leftRows=${c.clusteringSummary.leftRowCountObserved} ` +
      `rightRows=${c.clusteringSummary.rightRowCountObserved} ` +
      `pitch≈${c.clusteringSummary.estimatedRowPitch.toFixed(5)} ` +
      `expectedRowsByPitch=${c.clusteringSummary.expectedRowCountFromPitch}`,
  )
  lines.push("")
  lines.push("[bandas]")
  lines.push(
    `  bandCount=${c.collapseEvidence.bandCount} ` +
      `bothSides=${c.collapseEvidence.bandsWithBothSides} ` +
      `onlyLeft=${c.collapseEvidence.bandsWithOnlyLeft} ` +
      `onlyRight=${c.collapseEvidence.bandsWithOnlyRight} ` +
      `thresholdTooNarrow=${c.collapseEvidence.bandsThresholdTooNarrowForBothSides}`,
  )
  lines.push("")
  lines.push("[tiers observados]")
  lines.push(
    `  totalTiers=${c.observedSummary.totalTiers} ` +
      `pairs=${c.observedSummary.pairsFormed} ` +
      `leftOrphans=${c.observedSummary.leftOrphans} ` +
      `rightOrphans=${c.observedSummary.rightOrphans} ` +
      `orphanRatio=${c.observedSummary.orphanRatio.toFixed(4)}`,
  )
  lines.push("")
  lines.push("[tiers esperados (modelo físico independiente)]")
  lines.push(
    `  total=${c.expectedSummary.totalExpectedTiers} ` +
      `bothSides=${c.expectedSummary.expectedPairsBothSides} ` +
      `onlyLeft=${c.expectedSummary.expectedLeftOnly} ` +
      `onlyRight=${c.expectedSummary.expectedRightOnly}`,
  )
  lines.push("")
  lines.push("[rerun con threshold fijo 0.024 — sólo simulación, sin tocar producción]")
  const r = c.rerunWithFixedThreshold
  lines.push(
    `  threshold=${r.threshold} pairs=${r.pairsFormed} ` +
      `leftOrphans=${r.leftOrphans} rightOrphans=${r.rightOrphans} ` +
      `orphanRatio=${r.orphanRatio.toFixed(4)} ` +
      `pairsRecoveredVsObserved=${r.pairsRecoveredVsObserved}`,
  )
  lines.push("")
  lines.push("[colapso detectado]")
  lines.push(`  fase: ${c.collapsePhase}`)
  lines.push(`  explicación: ${c.collapseExplanation}`)
  lines.push("")
  if (p) {
    lines.push("[comparación vs corrida anterior]")
    lines.push(
      `  previo: leftOrphans=${p.leftOrphans} rightOrphans=${p.rightOrphans} ` +
        `totalTiers=${p.totalTiers} orphanRatio=${p.orphanRatio?.toFixed(4) ?? "n/a"} ` +
        `appearsCollapsed=${p.appearsCollapsed}`,
    )
    lines.push(
      `  delta: leftOrphans=${report.delta.leftOrphansDelta} ` +
        `rightOrphans=${report.delta.rightOrphansDelta} ` +
        `orphanRatio=${report.delta.orphanRatioDelta?.toFixed(4) ?? "n/a"}`,
    )
    lines.push("")
  }
  lines.push("[evidencia por banda — primeras 12]")
  for (const b of c.bandsSummary.slice(0, 12)) {
    lines.push(
      `  band#${b.bandIndex} h=${b.bandHeight.toFixed(5)} ` +
        `L=${b.leftRowCount} R=${b.rightRowCount} ` +
        `dy=${b.distanceLeftRight != null ? b.distanceLeftRight.toFixed(5) : "n/a"} ` +
        `yTh=${b.thresholdComputed.toFixed(5)} ` +
        `paired=${b.pairFormedAtComputedThreshold} ` +
        `wouldPairAt0024=${b.pairWouldFormAtFixedThreshold0024} ` +
        `cause=${b.failureCauseIfNotPaired ?? "OK"}`,
    )
  }
  lines.push("")
  lines.push("[primeras 8 filas con razón de orfandad]")
  const orphans = c.perRowEvidence.filter((r) => r.isOrphanInObserved).slice(0, 8)
  for (const o of orphans) {
    lines.push(
      `  side=${o.side} idxInSide=${o.rowIndexInSide} ` +
        `meanY=${o.meanY.toFixed(5)} band=${o.bandIndex ?? "n/a"} ` +
        `expectedNeighborSide=${o.expectedNeighborSide ?? "n/a"} ` +
        `expectedNeighborY=${o.expectedNeighborMeanY != null ? o.expectedNeighborMeanY.toFixed(5) : "n/a"} ` +
        `expectedNeighborD=${o.expectedNeighborDistance != null ? o.expectedNeighborDistance.toFixed(5) : "n/a"} ` +
        `reason=${o.orphanReason ?? "n/a"}`,
    )
  }
  return lines.join("\n")
}

async function main(): Promise<void> {
  const inputArg = process.argv[2]
  const outputArg = process.argv[3]
  if (!inputArg) {
    console.error(
      "Uso: npx tsx app/lib/omr-interleaved/debug/diagnoseTieringCollapse.cli.ts <input-snapshot.json> [output-report.json]",
    )
    process.exit(2)
  }
  const inputAbs = path.resolve(process.cwd(), inputArg)
  if (!fs.existsSync(inputAbs)) {
    console.error(`No existe el archivo de entrada: ${inputAbs}`)
    process.exit(2)
  }
  const raw = fs.readFileSync(inputAbs, "utf8")
  const parsed = JSON.parse(raw) as SnapshotEnvelope
  const snapshot = unwrapSnapshot(parsed)
  const report = diagnoseTieringFromSnapshot(snapshot)
  const consoleSummary = summarizeForConsole(report)
  console.log(consoleSummary)
  if (outputArg) {
    const outputAbs = path.resolve(process.cwd(), outputArg)
    fs.writeFileSync(outputAbs, JSON.stringify(report, null, 2))
    console.log(`\n[reporte completo escrito en] ${outputAbs}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
