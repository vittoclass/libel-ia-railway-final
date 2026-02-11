import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "LibelIA",
  description: "Evaluación con IA",
  generator: "v0.dev",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  )
}
