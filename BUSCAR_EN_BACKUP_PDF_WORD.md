# Dónde buscar en un backup donde PDF y Word SÍ funcionaban

Usa esta lista cuando revises una **copia antigua del proyecto** (carpeta, zip o commit anterior) donde la evaluación aceptaba PDF y Word además de imágenes.

---

## 1. Archivos que suelen tener la lógica de PDF/Word

Busca estos nombres de archivo en el backup:

| Archivo | Para qué sirve |
|---------|----------------|
| `app/api/evaluate/route.ts` | Ruta que recibe los archivos y llama a la conversión. |
| `app/api/azureProcess/route.ts` | A veces la visión/OCR estaba aquí. |
| Cualquier archivo en `app/lib/` que contenga `pdf` o `pdfToImages` o `pdf-img` en el nombre | Conversión PDF → imágenes. |
| `lib/pdfToImages.ts` o `utils/pdfToImages.js` | Módulo de conversión PDF (si existía con otro nombre). |
| `package.json` | Dependencias que se usaban para PDF/Word (ver sección 2). |

---

## 2. Términos para buscar en el contenido (grep / buscar en archivos)

Abre la carpeta del backup en el editor o usa “Buscar en archivos” y busca estas cadenas:

- **`pdf-img-convert`** – Paquete que convertía PDF a imágenes (antes lo usabas).
- **`pdfToImages`** o **`pdfToImage`** – Nombre típico de la función que convierte PDF a imágenes.
- **`mammoth`** – Paquete para convertir Word (.docx) a HTML o texto.
- **`docx`** o **`word`** – Donde se detectaba o procesaba Word.
- **`getDocument`** o **`pdfjs-dist`** – Uso de PDF.js para leer el PDF.
- **`fileToImageBase64List`** o **`resolveToImageBase64List`** – Función que unifica archivos (imagen/PDF/Word) en lista de imágenes base64.
- **`application/pdf`** o **`application/vnd.openxmlformats`** – Donde se aceptaban esos tipos MIME al subir archivos.

---

## 3. Qué copiar o anotar del backup

Cuando encuentres la versión que funcionaba:

1. **De `package.json`**  
   - Anota o copia las líneas de `dependencies` donde aparezcan:  
     `pdf-img-convert`, `pdfjs-dist`, `mammoth`, `canvas` (y versiones si las ves).

2. **Del archivo que convierte PDF a imágenes**  
   - Copia el archivo completo (p. ej. `app/lib/pdfToImages.ts` o el que tenga `pdfToImages` / `pdf-img-convert`).  
   - O al menos la función que hace la conversión (nombre de la función y cómo llama al paquete: `require('pdf-img-convert')` o `import ... from 'pdfjs-dist'`).

3. **De la ruta de evaluación**  
   - En `app/api/evaluate/route.ts` (o equivalente):  
     - Cómo se reciben los archivos (body, `fileUrls`, `fileMimeTypes`).  
     - Cómo se llama a la función que convierte PDF/Word a imágenes (nombre de la función y parámetros).  
     - Si hay un `if (es PDF)` / `if (es Word)` y qué se hace en cada caso.

4. **Si había script externo**  
   - Si existe una carpeta `scripts/` con algo como `pdfToImagesRunner.mjs` o `.js`, copia ese script también.

---

## 4. Cómo pasarme la información

Cuando tengas el backup a mano, puedes:

- **Opción A:** Pegar aquí el contenido del archivo que convierte PDF (y, si es otro, el que convierte Word).  
- **Opción B:** Decir: “En el backup uso el paquete X en el archivo Y” y pegar solo las 20–40 líneas donde se hace la conversión.  
- **Opción C:** Subir o pegar las líneas relevantes de `package.json` (dependencias) y de `app/api/evaluate/route.ts` donde se procesan los archivos.

Con eso se puede replicar en este proyecto la forma en que antes aceptabas PDF y Word además de imágenes.
