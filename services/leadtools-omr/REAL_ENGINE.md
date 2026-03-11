# Motor real LEADTOOLS OMR — qué falta

El servicio intenta **siempre** el camino real primero. Solo usa mock si `LEADTOOLS_MOCK=true`. Opcionalmente, si el motor real falla y `LEADTOOLS_MOCK_FALLBACK=true`, se devuelve mock y se registra `[LEADTOOLS_SERVICE] mockFallbackUsed`.

Cuando el motor real no está implementado, la respuesta es:

- **Error:** `"Motor real no implementado todavía"`

Y en logs:

- `[LEADTOOLS_SERVICE] realImageProcessingStarted`
- `[LEADTOOLS_SERVICE] realImageProcessingFinished` { success: false, error: "..." }

---

## Qué falta para tener lectura real

### 1. Dependencia

LEADTOOLS para Node.js no se instala con un simple `npm install leadtools`. Opciones típicas:

- **LEADTOOLS .NET:** SDK oficial es para .NET (C#). Para Node habría que:
  - Crear un proceso hijo que ejecute un binario .NET (ej. `dotnet run` de un worker), o
  - Usar un microservicio en .NET (como en el plan) que exponga HTTP y desde Node llamar a ese servicio (ya lo hace LibelIA vía proxy).
- **LEADTOOLS con C++ / Node native addon:** Si existe un binding Node para el SDK nativo, sería algo como:
  - `npm install leadtools-omr` (o el nombre real del paquete en npm, si existe).
- **Comprobar en npm:**  
  `npm search leadtools`  
  Si no hay paquete público, el motor real se implementa en **otro lenguaje** (ej. .NET) y este servicio Node solo hace de proxy o se reemplaza por ese servicio.

### 2. Licencia

LEADTOOLS exige licencia de runtime (archivo o clave). Sin ella el SDK no procesa o marca agua.

- Variable de entorno o ruta a archivo de licencia, según documentación de LEADTOOLS.
- Ejemplo típico en .NET: `RasterSupport.SetLicense(licenseFile, key)`.

### 3. Comando / ejecución

- Si el motor real va en **este repo (Node):**  
  Ningún comando extra; al implementar `runRealOmrEngine()` en `src/read-omr.ts` y tener la dependencia + licencia, `npm run dev` o `npm start` ya usarían el motor real (y solo mock si `LEADTOOLS_MOCK=true`).

- Si el motor real va en **un servicio .NET aparte:**  
  Este servicio Node puede seguir siendo un **proxy** al mismo contrato: recibe `POST /read-omr`, reenvía al servicio .NET y devuelve la respuesta. La “conexión real” sería esa URL del servicio .NET (ya documentada en el plan).

### 4. Archivo exacto a tocar

**`services/leadtools-omr/src/read-omr.ts`**

Función a sustituir/implementar:

```ts
function runRealOmrEngine(
  imageBuffer: Buffer,
  request: ReadOmrRequest
): ReadOmrSuccessResponse
```

Hoy esa función solo hace:

```ts
throw new Error("Motor real no implementado todavía")
```

Debe:

1. Usar el SDK LEADTOOLS (o llamar al servicio .NET que sí lo use).
2. Cargar la plantilla según `request.templateId` (o usar una plantilla por defecto).
3. Ejecutar el reconocimiento OMR sobre `imageBuffer`.
4. Mapear la salida del SDK a un array con forma:
   - `{ pregunta: number, respuesta: string, confianza: number }`
   - una entrada por pregunta (1..numQuestions).
5. Devolver:

```ts
return {
  success: true,
  results: [...],
  omissions: [...],
  doubleMarks: [...],
  metadata: { engine: "leadtools", processingTimeMs },
}
```

No cambiar la firma de `handleReadOmr` ni el contrato de request/response; solo reemplazar el cuerpo de `runRealOmrEngine`.

### 5. Resumen

| Qué | Dónde |
|-----|--------|
| Dependencia SDK | npm o servicio .NET externo (ver plan). |
| Licencia | Configuración LEADTOOLS (archivo/clave). |
| Comando extra | Solo si se usa otro proceso (ej. `dotnet run`). |
| Archivo a tocar | `services/leadtools-omr/src/read-omr.ts` |
| Función a implementar | `runRealOmrEngine(imageBuffer, request)` |

Mientras no se implemente `runRealOmrEngine`, el servicio **no** usa mock a menos que `LEADTOOLS_MOCK=true`; con eso se evita cualquier mock oculto y se sabe si la lectura es real o no por el error y los logs.
