# Visual Verification Prevalence — analizador offline (FASE 2A-2)

Telemetría **pasiva**. Este directorio es **solo offline**: no se importa desde runtime de LibelIA.

## Flag

`LIBELIA_VISUAL_VERIFICATION_PREVALENCE`

- Únicamente el valor exacto `"1"` habilita emisión
- Ausencia / `""` / `"0"` / `"true"` / `"yes"` / `"2"` → OFF
- No usar `Boolean(env)`
- **No** activa Shadow ni APPLY
- **No** modifica respuestas, scoring ni persistencia

Configuración prevista para medir (no activar ahora):

```text
LIBELIA_AZURE_VISUAL_BLANK_RESCUE_APPLY=0
LIBELIA_AZURE_VISUAL_BLANK_RESCUE_SHADOW=1
LIBELIA_VISUAL_VERIFICATION_PREVALENCE=1
```

## Identidad de ejecución

- `diagnosticRunId`: un UUID por llamada a `executeEvaluatePostBody` (`crypto.randomUUID()`)
- No se persiste, no se devuelve al frontend
- No sustituye `evaluationBatchId`
- Misma ejecución → mismo `diagnosticRunId` en todas las páginas/attempts
- Reevaluación → nuevo `diagnosticRunId`

## eventKey

**Batch** (muestra completa de lote):

```text
diagnosticRunId|evaluationBatchId|batchStudentIndex|pageIndex|attempt
```

**Direct** (carga sin `evaluationBatchId` — no se inventa batchId):

```text
diagnosticRunId|direct|pageIndex|attempt
```

`sourceMode`: `"batch"` | `"direct"`. Solo `batch` entra en clasificación de lote del Centro.

Si falta cualquier campo requerido → no hay evento válido (`[VISUAL_VERIFICATION_PREVALENCE_SKIPPED]`).

## Prefijo de log

```text
[VISUAL_VERIFICATION_PREVALENCE] {JSON de una línea}
```

Prohibido en el JSON: nombres, correos, RUT, letras sugeridas, URLs, base64, polígonos, PII.

## Attempt efectivo

Control de flujo real en `evaluation-logic.ts`:

```ts
for (let attempt = 0; attempt < 2 && !azureOfficial; attempt++)
```

Demostrable:

1. `attempt === 1` solo se invoca si `azureOfficial` sigue `null` tras el attempt 0
2. Por tanto, si en los logs existe attempt 1 para la misma página, attempt 0 **no** alimentó `azureOfficial`
3. El analizador usa el **máximo attempt** presente por `(diagnosticRunId, batch, student, page)`
4. **No** suma attempt 0 + attempt 1 como dos páginas

En el evento emitido desde el pipeline, `attemptOutcome` es `"unknown"` (en ese punto el adapter aún no confirmó consumo). El analizador resuelve used/discarded con el invariante del loop.

## Páginas no útiles

- `ignoredOrNonOmrPage`: `selectionMarksTotal === 0`
- `gridIncompleteUsefulPage`: grilla incompleta con marcas
- Excluidas de la tasa de casos revisables; contadas como `nonUsablePage`
- No se les atribuyen siete revisiones

## Clasificación de zonas

- **ZONA_A**: ≥85% estudiantes con 0 revisión; ≤20% con alguna; ≤2 revisiones/estudiante; ≤8 preguntas revisables; sin degradación masiva
- **ZONA_B**: 20–40% con revisión, o >2 casos en algún estudiante, o 9–20 revisables; sin alcanzar C
- **ZONA_C**: ≥40% revisables; o ≥10 revisables en lote ≤25; o >20 preguntas revisables; o >5 casos en una página/estudiante; o degradación masiva

Una página con seis candidatos = problema degradado, no seis excepciones normales.

## Uso del analizador

```bash
node scripts/visual-verification-prevalence/analyze-prevalence.mjs logs-export.txt
```

Fixtures sintéticos (FASE 2A-3 — no son prevalencia real):

```bash
node scripts/visual-verification-prevalence/analyze-prevalence.mjs --synthetic scripts/visual-verification-prevalence/fixtures/zone-a.log
```

`--synthetic` marca la muestra como INSUFICIENTE / no representativa de producción.
`--json` omite el resumen ejecutivo y deja solo JSON.

Varias ventanas:

```bash
node scripts/visual-verification-prevalence/analyze-prevalence.mjs window1.txt window2.txt
```

Tests:

```bash
node scripts/visual-verification-prevalence/analyze-prevalence.test.mjs
```

## Deduplicación

1. Solo líneas con prefijo exacto
2. Parse JSON fail-soft
3. Descartar incompletos
4. Deduplicar por `eventKey` (idénticos → 1)
5. Misma `eventKey` con payload distinto → **COLLISION**, no contar
6. Resolver attempt efectivo
7. Filtrar `sourceMode:"batch"` para zona de lote

## Rollback

Eliminar:

- `app/lib/diagnostics/visual-verification-prevalence-recorder.ts`
- tests asociados
- este directorio `scripts/visual-verification-prevalence/`
- llamadas en `azure-layout-omr-pipeline.ts` y `diagnosticRunId` en `evaluation-logic.ts`

Sin commit/push/deploy en esta fase.
