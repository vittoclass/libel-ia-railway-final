// SNAPSHOT_NATIONAL_ANALYTICS_V1
/**
 * Exportador CSV UTF-8 (BOM) para uso en navegador.
 * Data-only: sin formato visual ni etiquetas UI.
 */

function escapeCsvValue(value: unknown): string {
  const raw = value == null ? "" : String(value)
  const escaped = raw.replace(/"/g, "\"\"")
  return `"${escaped}"`
}

export function downloadCsvFile(params: {
  filename: string
  headers: string[]
  rows: Array<Array<unknown>>
  delimiter?: "," | ";"
}): void {
  const delimiter = params.delimiter ?? ","
  const headerLine = params.headers.map(escapeCsvValue).join(delimiter)
  const rowLines = params.rows.map((row) => row.map(escapeCsvValue).join(delimiter))
  const csvContent = [headerLine, ...rowLines].join("\r\n")
  const bom = "\uFEFF"
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = params.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

