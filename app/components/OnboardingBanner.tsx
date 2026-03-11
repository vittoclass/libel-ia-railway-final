"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import EvaluatorClient from "@/app/EvaluatorClient"

export default function EvaluarPageWrapper() {
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null)

  useEffect(() => {
    fetch("/api/evaluations/list", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setNeedsOnboarding(data.reason === "PROFILE_NOT_ONBOARDED"))
      .catch(() => setNeedsOnboarding(false))
  }, [])

  return (
    <>
      {needsOnboarding === true && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-amber-700 dark:text-amber-400 mx-4 mt-2">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <p className="flex-1 text-sm">
            Para guardar y ver historial, completa tu perfil.
          </p>
          <Link href="/perfil">
            <Button variant="outline" size="sm">Completar perfil</Button>
          </Link>
        </div>
      )}
      <EvaluatorClient />
    </>
  )
}
