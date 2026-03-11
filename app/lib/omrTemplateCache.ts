/**
 * Memoria interna de la plantilla OMR: guarda la plantilla (respuestas correctas + imagen opcional)
 * para contrastarla con las hojas de los estudiantes sin re-enviar cada vez.
 * Usa Redis si REDIS_URL está definida; si no, un Map en memoria (válido hasta reinicio).
 */

const TTL_SEC = 24 * 60 * 60 // 24 horas
const PREFIX = "omr:template:"

export interface CachedTemplate {
  respuestas: { pregunta: number; respuestaCorrecta: string; confianza: number; metodo: string }[]
  totalPreguntas: number
  alternativas: string[]
  columnas: number
  tipoMarca: "X" | "burbuja"
  imageBase64?: string
  mime?: string
  createdAt: number
}

const memoryStore = new Map<string, { data: string; expires: number }>()

let _redis: import("ioredis").Redis | null = null
function getRedis(): import("ioredis").Redis | null {
  if (!process.env.REDIS_URL) return null
  if (_redis) return _redis
  try {
    // Dynamic require to avoid loading ioredis when REDIS_URL is not set
    const Redis = require("ioredis")
    _redis = new Redis(process.env.REDIS_URL)
    return _redis
  } catch {
    return null
  }
}

export async function setTemplate(templateId: string, data: CachedTemplate): Promise<void> {
  const payload = JSON.stringify(data)
  const redis = getRedis()
  if (redis) {
    try {
      await redis.setex(PREFIX + templateId, TTL_SEC, payload)
      if (data.imageBase64) {
        await redis.setex(PREFIX + "img:" + templateId, TTL_SEC, data.imageBase64)
        await redis.setex(PREFIX + "mime:" + templateId, TTL_SEC, data.mime || "image/jpeg")
      }
      return
    } catch {
      // fallback to memory
    }
  }
  const expires = Date.now() + TTL_SEC * 1000
  memoryStore.set(PREFIX + templateId, { data: payload, expires })
  if (data.imageBase64) {
    memoryStore.set(PREFIX + "img:" + templateId, { data: data.imageBase64, expires })
    memoryStore.set(PREFIX + "mime:" + templateId, { data: data.mime || "image/jpeg", expires })
  }
}

export async function getTemplate(templateId: string): Promise<CachedTemplate | null> {
  const redis = getRedis()
  if (redis) {
    try {
      const raw = await redis.get(PREFIX + templateId)
      if (!raw) return null
      return JSON.parse(raw) as CachedTemplate
    } catch {
      // fallback to memory
    }
  }
  const entry = memoryStore.get(PREFIX + templateId)
  if (!entry || entry.expires < Date.now()) {
    if (entry) memoryStore.delete(PREFIX + templateId)
    return null
  }
  return JSON.parse(entry.data) as CachedTemplate
}

export async function getTemplateImage(templateId: string): Promise<{ base64: string; mime: string } | null> {
  const redis = getRedis()
  if (redis) {
    try {
      const [base64, mime] = await Promise.all([
        redis.get(PREFIX + "img:" + templateId),
        redis.get(PREFIX + "mime:" + templateId),
      ])
      if (!base64) return null
      return { base64, mime: mime || "image/jpeg" }
    } catch {
      // fallback to memory
    }
  }
  const imgEntry = memoryStore.get(PREFIX + "img:" + templateId)
  const mimeEntry = memoryStore.get(PREFIX + "mime:" + templateId)
  if (!imgEntry || imgEntry.expires < Date.now()) return null
  return { base64: imgEntry.data, mime: mimeEntry?.data || "image/jpeg" }
}
