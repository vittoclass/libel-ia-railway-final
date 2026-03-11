"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, CheckCircle } from "lucide-react"

export default function PerfilPage() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null)
  const [profileOnboarded, setProfileOnboarded] = useState<boolean | null>(null)
  const [fullName, setFullName] = useState("")
  const [schoolName, setSchoolName] = useState("")
  const [department, setDepartment] = useState("")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const router = useRouter()
  const supabase = createClientComponentClient()

  useEffect(() => {
    const check = async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      setUser(u ?? null)
      if (!u) {
        setProfileOnboarded(null)
        return
      }
      const res = await fetch("/api/evaluations/list", { credentials: "include" })
      const data = await res.json()
      setProfileOnboarded(!data.reason || data.reason !== "PROFILE_NOT_ONBOARDED")
    }
    check()
  }, [supabase.auth])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage(null)
    setLoading(true)
    try {
      const res = await fetch("/api/profile/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          full_name: fullName,
          school_name: schoolName,
          department: department || undefined,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setMessage({ type: "success", text: data.message ?? "Perfil completado." })
        setProfileOnboarded(true)
        router.refresh()
      } else {
        setMessage({ type: "error", text: data.error ?? "Error al guardar." })
      }
    } catch {
      setMessage({ type: "error", text: "Error de conexión." })
    } finally {
      setLoading(false)
    }
  }

  if (user === null && profileOnboarded === null) {
    return (
      <main className="min-h-screen p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--text-muted)]" />
      </main>
    )
  }

  if (!user) {
    return (
      <main className="min-h-screen p-6">
        <div className="max-w-md mx-auto text-center">
          <p className="text-[var(--text-muted)] mb-4">Debes iniciar sesión para ver tu perfil.</p>
          <Link href="/login">
            <Button>Iniciar sesión</Button>
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold text-[var(--text-accent)]">Perfil</h1>
        <p className="text-[var(--text-muted)]">Correo: {user.email}</p>

        {profileOnboarded ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                Perfil completado
              </CardTitle>
              <CardDescription>
                Puedes guardar evaluaciones y ver tu historial. Si quieres cambiar colegio o nombre, contacta soporte.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/evaluar">
                <Button>Ir a evaluar</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Completar perfil</CardTitle>
              <CardDescription>
                Para guardar evaluaciones y ver tu historial en LibelIA, completa los siguientes datos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="full_name">Nombre del profesor *</Label>
                  <Input
                    id="full_name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Ej. Juan Pérez"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="school_name">Colegio / Establecimiento *</Label>
                  <Input
                    id="school_name"
                    value={schoolName}
                    onChange={(e) => setSchoolName(e.target.value)}
                    placeholder="Ej. Liceo San José"
                    required
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="department">Departamento (opcional)</Label>
                  <Input
                    id="department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="Ej. Matemática"
                    className="mt-1"
                  />
                </div>
                {message && (
                  <p className={message.type === "success" ? "text-green-600" : "text-red-600"}>
                    {message.text}
                  </p>
                )}
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar perfil"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
