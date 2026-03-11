/**
 * Capa de captura/normalización con Dynamsoft Document Normalizer.
 * Detecta documento, recorta, corrige perspectiva y deskew; devuelve imagen como data URL
 * para que OpenCV OMR lea una entrada más estable.
 * NO reemplaza compare, scoring ni persistencia.
 */

const DYNAMSOFT_SCRIPT_BASE = "https://cdn.jsdelivr.net/npm"
const CORE_VERSION = "3.4.31"
const CVR_VERSION = "2.0.30"
const DDN_VERSION = "2.6.11"

/** Instancia del router de Dynamsoft (tipado explícito para evitar errores de inferencia). */
export interface DynamsoftRouterInstance {
  capture: (source: Blob | string, templateName?: string) => Promise<{
    processedDocumentResult?: {
      deskewedImageResultItems?: Array<{ toCanvas: () => HTMLCanvasElement }>
      enhancedImageResultItems?: Array<{ toCanvas: () => HTMLCanvasElement }>
    }
  }>
  dispose?: () => void
}

declare global {
  interface Window {
    Dynamsoft?: {
      License?: {
        LicenseManager?: {
          initLicense: (license: string, options?: { executeNow?: boolean }) => Promise<unknown>
        }
      }
      CVR?: {
        CaptureVisionRouter?: {
          createInstance: () => Promise<DynamsoftRouterInstance>
        }
      }
    }
  }
}

let routerInstance: DynamsoftRouterInstance | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("Document not available"))
      return
    }
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      resolve()
      return
    }
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(script)
  })
}

/**
 * Carga el SDK de Dynamsoft desde CDN (navegador únicamente).
 * Orden: core → capture-vision-router → document-normalizer.
 */
export async function loadDynamsoftSDK(): Promise<typeof window.Dynamsoft> {
  if (typeof window === "undefined") {
    throw new Error("Dynamsoft SDK solo puede cargarse en el navegador.")
  }
  const Dynamsoft = window.Dynamsoft
  if (Dynamsoft?.CVR?.CaptureVisionRouter) {
    return Dynamsoft
  }

  await loadScript(`${DYNAMSOFT_SCRIPT_BASE}/dynamsoft-core@${CORE_VERSION}/dist/core.js`)
  await loadScript(`${DYNAMSOFT_SCRIPT_BASE}/dynamsoft-capture-vision-router@${CVR_VERSION}/dist/cvr.js`)
  await loadScript(`${DYNAMSOFT_SCRIPT_BASE}/dynamsoft-document-normalizer@${DDN_VERSION}/dist/ddn.js`)

  if (!window.Dynamsoft?.CVR?.CaptureVisionRouter) {
    throw new Error("Dynamsoft Document Normalizer no se cargó correctamente.")
  }
  return window.Dynamsoft
}

/**
 * Inicializa la licencia de Dynamsoft. Debe llamarse antes de normalizar.
 */
export async function initDynamsoftLicense(license: string): Promise<void> {
  const Dynamsoft = await loadDynamsoftSDK()
  const LicenseManager = Dynamsoft?.License?.LicenseManager
  if (!LicenseManager?.initLicense) {
    throw new Error("Dynamsoft License no disponible.")
  }
  await LicenseManager.initLicense(license, { executeNow: true })
}

/**
 * Normaliza un documento desde un Blob (p. ej. captura de cámara).
 * Detecta bordes, recorta, corrige perspectiva y deskew; devuelve data URL.
 */
export async function normalizeDocumentFromBlob(blob: Blob): Promise<string> {
  const Dynamsoft = await loadDynamsoftSDK()
  const CVR = Dynamsoft?.CVR?.CaptureVisionRouter
  if (!CVR) {
    throw new Error("CaptureVisionRouter no disponible.")
  }

  if (!routerInstance) {
    routerInstance = await CVR.createInstance()
  }
  const router = routerInstance

  const result = await router.capture(blob, "DetectAndNormalizeDocument_Default")
  const processed = result?.processedDocumentResult
  const deskewed = processed?.deskewedImageResultItems
  const enhanced = processed?.enhancedImageResultItems

  const items = (deskewed && deskewed.length > 0 ? deskewed : enhanced) || []
  if (items.length === 0) {
    throw new Error("Dynamsoft no detectó un documento en la imagen.")
  }

  const first = items[0]
  const canvas = first.toCanvas?.()
  if (!canvas) {
    throw new Error("No se pudo obtener la imagen normalizada.")
  }

  return canvas.toDataURL("image/png")
}

/**
 * Normaliza un documento desde un data URL (p. ej. imagen subida).
 */
export async function normalizeDocumentFromDataUrl(dataUrl: string): Promise<string> {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  return normalizeDocumentFromBlob(blob)
}

/**
 * Comprueba si Dynamsoft está habilitado y la licencia configurada.
 */
export function isDynamsoftEnabled(): boolean {
  if (typeof window === "undefined") return false
  const enabled = process.env.NEXT_PUBLIC_DYNAMSOFT_ENABLED === "true"
  const license = process.env.NEXT_PUBLIC_DYNAMSOFT_LICENSE
  return enabled && !!license && license.length > 0
}

/**
 * Obtiene el mensaje de estado para la UI (disponible / no disponible).
 */
export function getDynamsoftStatusMessage(): string {
  if (!isDynamsoftEnabled()) {
    return "Dynamsoft no disponible. Configure NEXT_PUBLIC_DYNAMSOFT_LICENSE y DYNAMSOFT_ENABLED=true."
  }
  return "Dynamsoft listo para captura y normalización."
}
