"use client"

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Camera, Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { BATCH_SCANS_BUCKET } from "@/app/lib/docente/batch-scans-storage"
import { MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT, MOBILE_CAPTURE_PAGE_CHOICES } from "@/app/lib/docente/mobile-scan-constants"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type ProfileIds = { teacher_id: string; school_id: string; user_id: string }

type Props = {
  initialBatchId: string
}

export function MovilScanClient({ initialBatchId }: Props) {
  const supabase = createClientComponentClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [batchId] = useState(() => initialBatchId.trim())
  const [imagesPerStudent, setImagesPerStudent] = useState(2)
  const [studentIndex, setStudentIndex] = useState(1)
  const [pageIndex, setPageIndex] = useState(1)

  const [profile, setProfile] = useState<ProfileIds | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [lastOk, setLastOk] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadProfile = useCallback(async () => {
    setProfileError(null)
    try {
      const res = await fetch("/api/profile", { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      const tid = String(j?.profile?.teacher_id ?? "").trim()
      const sid = String(j?.profile?.school_id ?? "").trim()
      const uid = String(j?.user?.id ?? "").trim()
      if (!tid || !sid || !uid) {
        setProfile(null)
        setProfileError("Complete teacher_id y school_id en su perfil (PC) antes de subir fotos.")
        return
      }
      setProfile({ teacher_id: tid, school_id: sid, user_id: uid })
    } catch {
      setProfile(null)
      setProfileError("No se pudo cargar el perfil.")
    }
  }, [])

  useEffect(() => {
    void loadProfile()
  }, [loadProfile])

  const batchOk = UUID_REGEX.test(batchId)

  const openCamera = () => {
    setError(null)
    setLastOk(null)
    fileRef.current?.click()
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !profile || !batchOk) return
    if (!file.type.startsWith("image/")) {
      setError("Seleccione un archivo de imagen.")
      return
    }

    setUploading(true)
    setError(null)
    setLastOk(null)

    try {
      const ext = file.type.includes("png") ? "png" : file.type.includes("webp") ? "webp" : "jpg"
      const objectName = `s${studentIndex}_p${pageIndex}_${crypto.randomUUID()}.${ext}`
      const storagePath = `${profile.teacher_id}/${batchId}/${objectName}`

      const { error: upErr } = await supabase.storage.from(BATCH_SCANS_BUCKET).upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || "image/jpeg",
      })
      if (upErr) {
        setError(upErr.message)
        setUploading(false)
        return
      }

      const { data: authData } = await supabase.auth.getUser()
      const uid = authData?.user?.id ?? profile.user_id

      const row = {
        batch_id: batchId,
        school_id: profile.school_id,
        teacher_id: profile.teacher_id,
        storage_path: storagePath,
        content_type: file.type,
        file_size: file.size,
        created_by: uid,
        student_index: studentIndex,
        page_index: pageIndex,
      }

      const { error: insErr } = await supabase.from("batch_photo_uploads").insert(row)
      if (insErr) {
        setError(insErr.message)
        setUploading(false)
        return
      }

      setLastOk(`Guardado: alumno ${studentIndex}, foto ${pageIndex} de ${imagesPerStudent}`)

      if (pageIndex < imagesPerStudent) {
        setPageIndex((p) => p + 1)
      } else {
        setStudentIndex((s) => s + 1)
        setPageIndex(1)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir")
    } finally {
      setUploading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-slate-950 text-slate-100 p-4 pb-10">
      <div className="max-w-md mx-auto w-full space-y-6 pt-4">
        <header className="space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-indigo-400">Paso C · Captura móvil</p>
          <h1 className="text-xl font-semibold">Carillas al lote</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Sube a <code className="text-slate-300">{BATCH_SCANS_BUCKET}</code> con orden por alumno. El PC agrupa por{" "}
            <code className="text-slate-300">student_index</code> y <code className="text-slate-300">page_index</code>{" "}
            (sin tocar OMR).
          </p>
        </header>

        {!batchOk ? (
          <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-100 flex gap-2 items-start">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>URL sin <code className="text-amber-200">batch_id</code> válido. Abra el enlace desde el QR de la estación PC.</span>
          </div>
        ) : (
          <p className="text-xs font-mono text-slate-400 break-all">Lote: {batchId}</p>
        )}

        {profileError ? (
          <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-sm text-rose-100">{profileError}</div>
        ) : null}

        <section className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3">
          <Label className="text-slate-200">Imágenes por estudiante</Label>
          <Select
            value={String(imagesPerStudent)}
            onValueChange={(v) => {
              const n = Number(v)
              if (n >= 1 && n <= MOBILE_CAPTURE_MAX_PAGES_PER_STUDENT) {
                setImagesPerStudent(n)
                setPageIndex(1)
              }
            }}
          >
            <SelectTrigger className="bg-slate-950 border-slate-700">
              <SelectValue placeholder="Cantidad" />
            </SelectTrigger>
            <SelectContent>
              {MOBILE_CAPTURE_PAGE_CHOICES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} {n === 1 ? "imagen" : "imágenes"} por estudiante
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-slate-500">
            Tras {imagesPerStudent} fotos, el sistema pasa al siguiente estudiante (índice automático).
          </p>
        </section>

        <section className="rounded-xl border border-indigo-900/60 bg-indigo-950/30 p-4 space-y-2 text-center">
          <p className="text-sm text-indigo-100">
            Ahora: <strong>Alumno {studentIndex}</strong> · Foto <strong>{pageIndex}</strong> de <strong>{imagesPerStudent}</strong>
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(ev) => void onFile(ev)}
          />
          <Button
            type="button"
            size="lg"
            className="w-full gap-2 bg-indigo-600 hover:bg-indigo-500"
            disabled={!batchOk || !profile || uploading}
            onClick={openCamera}
          >
            {uploading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Camera className="h-5 w-5" aria-hidden />}
            {uploading ? "Subiendo…" : "Tomar foto"}
          </Button>
        </section>

        {lastOk ? (
          <div className="flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            {lastOk}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-rose-800 bg-rose-950/50 px-3 py-2 text-sm text-rose-100 flex gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            {error}
          </div>
        ) : null}

        <p className="text-[10px] text-slate-500 leading-relaxed">
          Debe iniciar sesión con la misma cuenta que en el PC. La estación docente mostrará las miniaturas en vivo.
        </p>

        <Button variant="ghost" size="sm" className="text-slate-400" asChild>
          <Link href="/docente/estacion">Abrir estación PC</Link>
        </Button>
      </div>
    </main>
  )
}
