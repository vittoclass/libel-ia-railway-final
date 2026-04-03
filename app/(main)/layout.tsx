import type { ReactNode } from "react"
import Link from "next/link"
import AuthHeader from "@/app/components/AuthHeader"

export default function MainShellLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-50 flex h-14 items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-page)] px-4 shadow-sm">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold text-[var(--text-accent)] hover:opacity-90">
            LibelIA
          </Link>
          <Link href="/evaluar" className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            Evaluar
          </Link>
        </div>
        <AuthHeader />
      </header>
      {children}
    </>
  )
}
