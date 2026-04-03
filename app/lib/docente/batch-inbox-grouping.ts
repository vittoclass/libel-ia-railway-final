/**
 * Agrupación del buzón híbrido (batch_photo_uploads) por alumno.
 * Solo utilidades de lectura; no invoca evaluación ni OMR.
 */

export type BatchPhotoInboxRow = {
  id: string
  storage_path: string
  student_index: number
  page_index: number
  created_at?: string | null
  content_type?: string | null
  processed_at?: string | null
}

export type StudentPhotoGroup = {
  student_index: number
  pages: BatchPhotoInboxRow[]
}

/**
 * Orden estable: por alumno, luego por página dentro del alumno, luego por tiempo.
 */
export function groupBatchPhotosByStudent(photos: BatchPhotoInboxRow[]): StudentPhotoGroup[] {
  const byStudent = new Map<number, BatchPhotoInboxRow[]>()
  for (const p of photos) {
    const si = Number.isFinite(p.student_index) ? Math.max(1, Math.floor(p.student_index)) : 1
    const arr = byStudent.get(si) ?? []
    arr.push(p)
    byStudent.set(si, arr)
  }
  const keys = [...byStudent.keys()].sort((a, b) => a - b)
  return keys.map((student_index) => {
    const pages = (byStudent.get(student_index) ?? []).sort((a, b) => {
      const pa = Number.isFinite(a.page_index) ? a.page_index : 0
      const pb = Number.isFinite(b.page_index) ? b.page_index : 0
      if (pa !== pb) return pa - pb
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return ta - tb
    })
    return { student_index, pages }
  })
}
