"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import type { User } from "@supabase/supabase-js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { LogIn, User as UserIcon, ClipboardList, LogOut, Loader2 } from "lucide-react"

export default function AuthHeader() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClientComponentClient()

  useEffect(() => {
    const getSession = async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      setUser(u ?? null)
      setLoading(false)
    }
    getSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [supabase.auth])

  const handleSignOut = async () => {
    console.info(
      "[AUTH_REDIRECT_DIAG]",
      JSON.stringify({
        tag: "AuthHeader:signOut",
        host: typeof window !== "undefined" ? window.location.host : "(ssr)",
        origin: typeof window !== "undefined" ? window.location.origin : "(ssr)",
        nextPush: "/login",
      })
    )
    await supabase.auth.signOut()
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch (_) {}
    router.push("/login")
    router.refresh()
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Cargando...</span>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-md border border-[var(--border-color)] bg-[var(--bg-card)] px-3 py-2 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
        >
          <LogIn className="h-4 w-4" />
          Iniciar sesión
        </Link>
        <Link
          href="/login?signup=1"
          className="inline-flex items-center rounded-md bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Crear cuenta
        </Link>
      </div>
    )
  }

  const email = user.email ?? "Usuario"
  const displayEmail = email.length > 28 ? `${email.slice(0, 25)}…` : email

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center gap-2 border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
        >
          <UserIcon className="h-4 w-4" />
          <span className="max-w-[180px] truncate" title={email}>
            {displayEmail}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/evaluaciones" className="flex items-center gap-2 cursor-pointer">
            <ClipboardList className="h-4 w-4" />
            Evaluaciones
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/perfil" className="flex items-center gap-2 cursor-pointer">
            <UserIcon className="h-4 w-4" />
            Perfil
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleSignOut}
          className="flex items-center gap-2 text-red-600 focus:text-red-600 cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
