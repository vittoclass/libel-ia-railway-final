import { type NextRequest, NextResponse } from "next/server"
import { parseNameListFromForm, runExtractNamePipeline } from "@/app/lib/extract-name-core"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const files = formData.getAll("files") as File[]
    const nameListJson = formData.get("nameList") as string | null
    const includeAudit = formData.get("includeAudit") === "1" || formData.get("includeAudit") === "true"

    const { nameList, parseError: nameListParseError } = parseNameListFromForm(nameListJson)

    console.log(`[API /extract-name] Nombres en lista de clase disponibles: ${nameList.length > 0}`)

    const fileBuffers: Array<{ name: string; buffer: Buffer }> = []
    for (const file of files) {
      fileBuffers.push({
        name: file.name || "sin-nombre",
        buffer: Buffer.from(await file.arrayBuffer()),
      })
    }

    const result = await runExtractNamePipeline({
      files: fileBuffers,
      nameList,
      nameListParseError,
      includeAudit,
    })

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 })
    }

    console.log(`[API /extract-name] Sugerencias finales devueltas:`, result.suggestions)

    return NextResponse.json({
      success: true,
      suggestions: result.suggestions,
      ...(result.audit ? { audit: result.audit } : {}),
    })
  } catch (error) {
    console.error("[API /extract-name] ❌ ERROR EN EL BLOQUE POST:", error)
    return NextResponse.json({ success: true, suggestions: [] })
  }
}
