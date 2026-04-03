/**
 * Tras `next build` con output: 'standalone', Next no copia public ni .next/static
 * dentro de .next/standalone. Este script lo hace (recomendación oficial Next.js).
 */
const fs = require("fs")
const path = require("path")

const root = path.join(__dirname, "..")
const standalone = path.join(root, ".next", "standalone")

if (!fs.existsSync(standalone)) {
  console.error(
    "[copy-standalone-assets] No existe .next/standalone. Ejecute primero: next build (con output standalone).",
  )
  process.exit(1)
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn("[copy-standalone-assets] Origen ausente, se omite:", src)
    return
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.cpSync(src, dest, { recursive: true })
  console.log("[copy-standalone-assets]", path.relative(root, src), "→", path.relative(root, dest))
}

copyDir(path.join(root, "public"), path.join(standalone, "public"))
copyDir(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"))
