import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "EvalúaPro - Sistema de Evaluación con OMR",
  description:
    "Sistema profesional de evaluación con reconocimiento óptico de marcas (OMR) para corregir pruebas automaticamente",
}

/**
 * Raíz mínima: sin cabecera global. El shell con AuthHeader vive en app/(main)/layout.tsx.
 * Captura móvil (QR) usa app/(public-mobile)/ sin ese shell.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es">
      <body className={`${inter.className} antialiased`}>{children}</body>
    </html>
  )
}
