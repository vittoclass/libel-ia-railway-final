/**
 * Detección de esquinas y corrección de perspectiva para OMR con plantilla superpuesta.
 * Solo se usa en el flujo TemplateOverlayOMRModal; no toca APIs ni persistencia.
 * Mejora la precisión de lectura enderezando la hoja antes de aplicar el grid.
 */

const DEFAULT_THRESHOLD = 175
const MAX_SIZE_FOR_CORNER_DETECT = 640
const MIN_BOUNDARY_POINTS = 50
const MIN_QUAD_AREA_RATIO = 0.03

export type QuadCorners = [number, number][] // [tl, tr, br, bl] en (x,y)

const DX = [1, 1, 0, -1, -1, -1, 0, 1]
const DY = [0, 1, 1, 1, 0, -1, -1, -1]

function isWhite(
  data: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
  threshold: number
): boolean {
  if (x < 0 || x >= w || y < 0 || y >= h) return false
  return data[y * w + x] >= threshold
}

function getGray(data: Uint8ClampedArray, i: number): number {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
}

/**
 * Convierte ImageData a binario (0 o 255) en Uint8Array por píxel.
 */
function toBinary(
  imageData: ImageData,
  threshold: number
): { data: Uint8Array; w: number; h: number } {
  const { data, width: w, height: h } = imageData
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const g = getGray(data, i)
      out[y * w + x] = g >= threshold ? 255 : 0
    }
  }
  return { data: out, w, h }
}

/**
 * Encuentra un píxel de borde (blanco con al menos un vecino negro).
 */
function findFirstBoundaryPixel(
  data: Uint8Array,
  w: number,
  h: number,
  threshold: number
): [number, number] | null {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[y * w + x] < threshold) continue
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d]
        const ny = y + DY[d]
        if (!isWhite(data, w, h, nx, ny, threshold)) return [x, y]
      }
    }
  }
  return null
}

/**
 * Sigue el contorno 8-conexo (Moore) desde un píxel de borde.
 * Devuelve puntos ordenados en sentido horario (exterior).
 */
function traceBoundary(
  data: Uint8Array,
  w: number,
  h: number,
  startX: number,
  startY: number,
  threshold: number
): [number, number][] {
  const path: [number, number][] = []
  let x = startX
  let y = startY
  let fromDir = 4 // empezamos como si viniéramos del oeste
  const maxSteps = w * h
  for (let step = 0; step < maxSteps; step++) {
    path.push([x, y])
    let nextX = -1
    let nextY = -1
    let nextFromDir = -1
    for (let k = 1; k <= 8; k++) {
      const d = (fromDir + k) % 8
      const nx = x + DX[d]
      const ny = y + DY[d]
      if (isWhite(data, w, h, nx, ny, threshold)) {
        nextX = nx
        nextY = ny
        nextFromDir = (d + 4) % 8
        break
      }
    }
    if (nextX < 0) break
    x = nextX
    y = nextY
    fromDir = nextFromDir
    if (x === startX && y === startY && path.length > 2) break
  }
  return path
}

/**
 * A partir del contorno ordenado, obtiene 4 esquinas por sectores angulares desde el centroide.
 * Orden: [tl, tr, br, bl].
 */
function contourToQuad(boundary: [number, number][]): QuadCorners | null {
  if (boundary.length < MIN_BOUNDARY_POINTS) return null
  let cx = 0
  let cy = 0
  for (const [px, py] of boundary) {
    cx += px
    cy += py
  }
  cx /= boundary.length
  cy /= boundary.length

  const sectors: [number, number, number][][] = [[], [], [], []]
  for (const [px, py] of boundary) {
    const dx = px - cx
    const dy = py - cy
    const angle = (Math.atan2(dy, dx) * (180 / Math.PI) + 360) % 360
    const distSq = dx * dx + dy * dy
    let sector: number
    if (angle >= 315 || angle < 45) sector = 0
    else if (angle >= 45 && angle < 135) sector = 1
    else if (angle >= 135 && angle < 225) sector = 2
    else sector = 3
    sectors[sector].push([px, py, distSq])
  }

  const corners: [number, number][] = []
  for (let s = 0; s < 4; s++) {
    const pts = sectors[s]
    if (pts.length === 0) return null
    let best = pts[0]
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][2] > best[2]) best = pts[i]
    }
    corners.push([best[0], best[1]])
  }
  return [corners[2], corners[1], corners[0], corners[3]]
}

function polygonArea(pts: [number, number][]): number {
  let a = 0
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]
  }
  return Math.abs(a) / 2
}

/**
 * Detecta las 4 esquinas de la hoja a partir de ImageData (RGBA, umbral sobre gris).
 */
export function findSheetCornersFromImageData(
  imageData: ImageData,
  threshold: number = DEFAULT_THRESHOLD
): QuadCorners | null {
  const { data: bin, w, h } = toBinary(imageData, threshold)
  const first = findFirstBoundaryPixel(bin, w, h, threshold)
  if (!first) return null
  const [sx, sy] = first
  const boundary = traceBoundary(bin, w, h, sx, sy, threshold)
  const quad = contourToQuad(boundary)
  if (!quad) return null
  const area = polygonArea(quad)
  if (area < w * h * MIN_QUAD_AREA_RATIO) return null
  return quad
}

/**
 * Calcula la matriz de homografía 3x3 que mapea srcCorners -> destCorners.
 */
export function getPerspectiveTransform(
  srcCorners: QuadCorners,
  destCorners: QuadCorners
): number[] {
  const A: number[] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const sx = srcCorners[i][0]
    const sy = srcCorners[i][1]
    const dx = destCorners[i][0]
    const dy = destCorners[i][1]
    A.push(sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy)
    b.push(dx)
    A.push(0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy)
    b.push(dy)
  }
  const h = solve8(A, b)
  return [...h, 1]
}

function solve8(A: number[], b: number[]): number[] {
  const M: number[][] = []
  for (let row = 0; row < 8; row++) {
    M.push([
      A[row * 8],
      A[row * 8 + 1],
      A[row * 8 + 2],
      A[row * 8 + 3],
      A[row * 8 + 4],
      A[row * 8 + 5],
      A[row * 8 + 6],
      A[row * 8 + 7],
      b[row],
    ])
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row
    }
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    const div = M[col][col]
    if (Math.abs(div) < 1e-10) return [1, 0, 0, 0, 1, 0, 0, 0]
    for (let j = 0; j <= 8; j++) M[col][j] /= div
    for (let row = 0; row < 8; row++) {
      if (row === col) continue
      const f = M[row][col]
      for (let j = 0; j <= 8; j++) M[row][j] -= f * M[col][j]
    }
  }
  return M.map((r) => r[8])
}

function inverse3x3(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H
  const det =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const inv = 1 / det
  return [
    (e * i - f * h) * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    (f * g - d * i) * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    (d * h - e * g) * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ]
}

function applyHomography(H: number[], u: number, v: number): [number, number] {
  const x = H[0] * u + H[1] * v + H[2]
  const y = H[3] * u + H[4] * v + H[5]
  const w = H[6] * u + H[7] * v + H[8]
  if (Math.abs(w) < 1e-12) return [0, 0]
  return [x / w, y / w]
}

function sampleBilinear(
  imageData: ImageData,
  x: number,
  y: number
): [number, number, number, number] {
  const { data, width: w, height: h } = imageData
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)))
  const x1 = Math.max(0, Math.min(w - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(h - 1, y0 + 1))
  const fx = x - x0
  const fy = y - y0
  const i00 = (y0 * w + x0) * 4
  const i10 = (y0 * w + x1) * 4
  const i01 = (y1 * w + x0) * 4
  const i11 = (y1 * w + x1) * 4
  const r =
    (1 - fx) * (1 - fy) * data[i00] +
    fx * (1 - fy) * data[i10] +
    (1 - fx) * fy * data[i01] +
    fx * fy * data[i11]
  const g =
    (1 - fx) * (1 - fy) * data[i00 + 1] +
    fx * (1 - fy) * data[i10 + 1] +
    (1 - fx) * fy * data[i01 + 1] +
    fx * fy * data[i11 + 1]
  const b =
    (1 - fx) * (1 - fy) * data[i00 + 2] +
    fx * (1 - fy) * data[i10 + 2] +
    (1 - fx) * fy * data[i01 + 2] +
    fx * fy * data[i11 + 2]
  const a =
    (1 - fx) * (1 - fy) * data[i00 + 3] +
    fx * (1 - fy) * data[i10 + 3] +
    (1 - fx) * fy * data[i01 + 3] +
    fx * fy * data[i11 + 3]
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)]
}

/**
 * Aplica la transformación de perspectiva: cuadrilátero origen -> rectángulo destino.
 * Devuelve dataUrl del canvas con la imagen enderezada.
 */
export function warpPerspectiveToDataUrl(
  srcDataUrl: string,
  srcCorners: QuadCorners,
  destWidth: number,
  destHeight: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        reject(new Error("Canvas no disponible"))
        return
      }
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      const destCorners: QuadCorners = [
        [0, 0],
        [destWidth, 0],
        [destWidth, destHeight],
        [0, destHeight],
      ]
      const H = getPerspectiveTransform(srcCorners, destCorners)
      const Hinv = inverse3x3(H)

      const outCanvas = document.createElement("canvas")
      outCanvas.width = destWidth
      outCanvas.height = destHeight
      const outCtx = outCanvas.getContext("2d")
      if (!outCtx) {
        reject(new Error("Canvas salida no disponible"))
        return
      }
      const outData = outCtx.createImageData(destWidth, destHeight)

      for (let v = 0; v < destHeight; v++) {
        for (let u = 0; u < destWidth; u++) {
          const [x, y] = applyHomography(Hinv, u, v)
          const [r, g, b, a] = sampleBilinear(imageData, x, y)
          const i = (v * destWidth + u) * 4
          outData.data[i] = r
          outData.data[i + 1] = g
          outData.data[i + 2] = b
          outData.data[i + 3] = a
        }
      }
      outCtx.putImageData(outData, 0, 0)
      resolve(outCanvas.toDataURL("image/jpeg", 0.92))
    }
    img.onerror = () => reject(new Error("Error al cargar la imagen"))
    img.src = srcDataUrl
  })
}

/**
 * Detecta esquinas en la imagen, aplica corrección de perspectiva y devuelve la imagen enderezada.
 * Si algo falla, devuelve null (el llamador debe usar la imagen original).
 */
export async function findSheetCornersAndWarp(
  dataUrl: string,
  templateAspectRatio: number,
  threshold: number = DEFAULT_THRESHOLD
): Promise<{ correctedDataUrl: string; corners: QuadCorners } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => {
      try {
        const w = img.width
        const h = img.height
        const scale = Math.min(1, MAX_SIZE_FOR_CORNER_DETECT / Math.max(w, h))
        const workW = Math.round(w * scale)
        const workH = Math.round(h * scale)

        const canvas = document.createElement("canvas")
        canvas.width = workW
        canvas.height = workH
        const ctx = canvas.getContext("2d")
        if (!ctx) {
          resolve(null)
          return
        }
        ctx.drawImage(img, 0, 0, w, h, 0, 0, workW, workH)
        const imageData = ctx.getImageData(0, 0, workW, workH)

        const cornersLow = findSheetCornersFromImageData(imageData, threshold)
        if (!cornersLow || cornersLow.length !== 4) {
          resolve(null)
          return
        }

        const scaleBack = 1 / scale
        const cornersFull: QuadCorners = cornersLow.map(([x, y]) => [
          x * scaleBack,
          y * scaleBack,
        ])

        const destWidth = Math.max(400, Math.round(w * 0.9))
        const destHeight = Math.round(destWidth / templateAspectRatio)

        warpPerspectiveToDataUrl(
          dataUrl,
          cornersFull,
          destWidth,
          destHeight
        )
          .then((correctedDataUrl) => {
            resolve({ correctedDataUrl, corners: cornersFull })
          })
          .catch(() => resolve(null))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}
