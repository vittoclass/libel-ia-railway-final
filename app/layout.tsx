import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import AuthHeader from './components/AuthHeader'
import Link from 'next/link'

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'EvalúaPro - Sistema de Evaluación con OMR',
  description: 'Sistema profesional de evaluación con reconocimiento óptico de marcas (OMR) para corregir pruebas automaticamente',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className={`${inter.className} antialiased`}>
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
      </body>
    </html>
  )
}
