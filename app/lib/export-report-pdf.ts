/**
 * Exporta el contenido de un contenedor a PDF usando html2canvas + jsPDF.
 * Solo cliente; no modifica backend ni análisis.
 */

export async function exportElementToPdf(
  element: HTMLElement,
  filename: string
): Promise<{ ok: boolean; error?: string }> {
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

    const safeName = filename.replace(/[^\w\u00C0-\u024F\-]/g, "_").slice(0, 120)
    pdf.save(safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`)
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, error }
  }
}
