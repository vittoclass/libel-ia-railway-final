/**
 * Exporta el contenido de un contenedor a PDF usando html2canvas + jsPDF.
 * Solo cliente; no modifica backend ni análisis.
 */

type JsPdfInstance = InstanceType<(typeof import("jspdf"))["default"]>

async function elementToJsPdf(element: HTMLElement): Promise<{ ok: true; pdf: JsPdfInstance } | { ok: false; error: string }> {
  try {
    const html2canvas = (await import("html2canvas")).default
    const { jsPDF } = await import("jspdf")

    const canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
    })

    const imgData = canvas.toDataURL("image/png")
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgW = pageW
    const imgH = (canvas.height * imgW) / canvas.width

    if (imgH <= pageH) {
      pdf.addImage(imgData, "PNG", 0, 0, imgW, imgH)
    } else {
      let heightLeft = imgH
      let position = 0
      pdf.addImage(imgData, "PNG", 0, position, imgW, imgH)
      heightLeft -= pageH
      while (heightLeft > 0) {
        position = heightLeft - imgH
        pdf.addPage()
        pdf.addImage(imgData, "PNG", 0, position, imgW, imgH)
        heightLeft -= pageH
      }
    }

    return { ok: true, pdf }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, error }
  }
}

export async function exportElementToPdf(
  element: HTMLElement,
  filename: string
): Promise<{ ok: boolean; error?: string }> {
  const r = await elementToJsPdf(element)
  if (!r.ok) return { ok: false, error: r.error }
  const safeName = filename.replace(/[^\w\u00C0-\u024F\-]/g, "_").slice(0, 120)
  r.pdf.save(safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`)
  return { ok: true }
}

/** Misma lógica que exportElementToPdf, sin descargar (p. ej. lote ZIP en cliente). */
export async function exportElementToPdfBlob(
  element: HTMLElement
): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  const r = await elementToJsPdf(element)
  if (!r.ok) return { ok: false, error: r.error }
  const blob = r.pdf.output("blob")
  return { ok: true, blob }
}
