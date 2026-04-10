/**
 * PDF Dashboard UTP — una página A4, captura #utp-dashboard-pdf-capture-root.
 * - Espera base + espera extra 2s si aún no hay filas de habilidades en el DOM.
 * - onclone: crossOrigin en <img> para logos remotos con html2canvas.
 * Reversible: ajustar constantes o quitar onclone.
 */

const SYNC_BEFORE_CAPTURE_MS = 1500
const EXTRA_WAIT_IF_NO_SKILLS_MS = 2000

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function readPdfSkillsCount(root: HTMLElement): number {
  const el = root.querySelector("[data-pdf-skills-count]")
  if (!el) return 0
  const v = parseInt(String(el.getAttribute("data-pdf-skills-count") ?? "0"), 10)
  return Number.isFinite(v) ? v : 0
}

function addImageFitSinglePage(
  pdf: InstanceType<(typeof import("jspdf"))["default"]>,
  imgData: string,
  canvasW: number,
  canvasH: number,
  marginMm: number,
): void {
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const innerW = pageW - 2 * marginMm
  const innerH = pageH - 2 * marginMm
  const ratio = canvasW / canvasH
  let drawW = innerW
  let drawH = drawW / ratio
  if (drawH > innerH) {
    drawH = innerH
    drawW = drawH * ratio
  }
  const x = marginMm + (innerW - drawW) / 2
  /** Alineación superior: el encabezado de la ficha debe anclarse al borde superior de la hoja (no centrar verticalmente). */
  const y = marginMm
  pdf.addImage(imgData, "PNG", x, y, drawW, drawH)
}

export async function exportUtpExecutiveFichaPdf(params: {
  rootElement: HTMLElement | null
  filename: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { rootElement, filename } = params
  if (!rootElement || !rootElement.isConnected) {
    return { ok: false, error: "No se encontró el contenedor de exportación (#utp-dashboard-pdf-capture-root)." }
  }

  try {
    await nextFrame()
    await nextFrame()
    await new Promise<void>((r) => setTimeout(r, SYNC_BEFORE_CAPTURE_MS))

    if (readPdfSkillsCount(rootElement) === 0) {
      await new Promise<void>((r) => setTimeout(r, EXTRA_WAIT_IF_NO_SKILLS_MS))
      await nextFrame()
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("resize"))
      await nextFrame()
    }

    const html2canvas = (await import("html2canvas")).default
    const { jsPDF } = await import("jspdf")

    const canvas = await html2canvas(rootElement, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      logging: false,
      backgroundColor: "#ffffff",
      scrollX: 0,
      scrollY: 0,
      windowWidth: rootElement.scrollWidth,
      windowHeight: rootElement.scrollHeight,
      onclone: (clonedDoc) => {
        clonedDoc.querySelectorAll("img").forEach((img) => {
          try {
            img.crossOrigin = "anonymous"
          } catch {
            /* noop */
          }
        })
      },
    })

    const imgData = canvas.toDataURL("image/png")
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
    const marginMm = 6
    addImageFitSinglePage(pdf, imgData, canvas.width, canvas.height, marginMm)

    const safe = filename.replace(/[^\w\u00C0-\u024F\-]/g, "_").slice(0, 120)
    pdf.save(safe.endsWith(".pdf") ? safe : `${safe}.pdf`)
    return { ok: true }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { ok: false, error }
  }
}
