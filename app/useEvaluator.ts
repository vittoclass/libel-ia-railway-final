// useEvaluator.ts
'use client';

import { useState, useCallback } from 'react';
import { buildTeacherAnswerKeyFromFormPauta } from '@/app/lib/evaluation-base';

// Tipo para la plantilla de respuestas del profesor
export interface AnswerKeyItem {
  pregunta: number;
  respuestaCorrecta: string;
  confianza: number;
  metodo: "auto" | "manual" | "mistral" | "sharp";
}

export interface AnswerKeyData {
  respuestas: AnswerKeyItem[];
  totalPreguntas: number;
  preguntasDudosas: number[];
  imagenPlantilla?: string;
  templateId?: string;
}

// 1. Parsea la pauta del profesor
function parsePauta(pautaStr: string) {
  const lines = pautaStr.split('\n').map(l => l.trim()).filter(Boolean);
  let sm: string[] = [];
  let vf: string[] = [];

  for (const line of lines) {
    if (line.startsWith('SM:')) {
      sm = line.replace('SM:', '').split(',').map(s => s.trim().toUpperCase());
    } else if (line.startsWith('VF:')) {
      vf = line.replace('VF:', '').split(',').map(s => s.trim().toUpperCase());
    }
  }
  return { sm, vf };
}

// 2. Corrige comparando con la pauta
function corregirObjetivas(
  pauta: { sm: string[]; vf: string[] },
  respuestas: { sm: string[]; vf: string[] }
) {
  const smCorregido = pauta.sm.map((correcta, i) => ({
    respuesta: respuestas.sm[i] || '',
    correcta,
    esCorrecta: (respuestas.sm[i] || '').trim().toUpperCase() === correcta
  }));

  const vfCorregido = pauta.vf.map((correcta, i) => ({
    respuesta: respuestas.vf[i] || '',
    correcta,
    esCorrecta: (respuestas.vf[i] || '').trim().toUpperCase() === correcta
  }));

  return {
    sm: smCorregido,
    vf: vfCorregido,
    smCorrectas: smCorregido.filter(r => r.esCorrecta).length,
    vfCorrectas: vfCorregido.filter(r => r.esCorrecta).length
  };
}

/** =========================
 *  OMR: memoria momentánea
 *  ========================= */
const OMR_SESSION_KEY = 'libelia_omr_session_v1';

function loadOmrSession() {
  try {
    return JSON.parse(sessionStorage.getItem(OMR_SESSION_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveOmrSession(obj: any) {
  try {
    sessionStorage.setItem(OMR_SESSION_KEY, JSON.stringify(obj));
  } catch {
    // si storage está bloqueado, no pasa nada
  }
}

/** Evita /api/omr en cliente cuando la evaluación es solo desarrollo o asignaturas sin lectura OMR típica (Arte, etc.). */
function shouldSkipClientOmr(payload: any): boolean {
  const tipo = String(payload?.tipoPrueba ?? '');
  if (tipo === 'solo_desarrollo') return true;
  const subj = String(payload?.evaluation_subject ?? payload?.asignatura ?? '').trim().toLowerCase();
  if (!subj) return false;
  if (/\bartes?\b/i.test(subj)) return true;
  if (subj.includes('desarrollo personal')) return true;
  if (subj.includes('educación en el desarrollo') || subj.includes('educacion en el desarrollo')) return true;
  return false;
}

/** Modo diagnóstico temporal: pantalla completa en el cliente con detalle del fetch a /api/evaluate */
export type EvaluateDiagnosticPayload = Record<string, unknown> & {
  mode?: 'LIBELIA_EVALUATE_DEBUG_V1';
  timestamp?: string;
};

function serializeUnknown(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

/** Detecta URLs/imagenes en el payload sin asumir un nombre único */
function getPayloadFileUrls(payload: any): string[] | null {
  const candidates = [
    payload?.fileUrls,
    payload?.filesUrls,
    payload?.imageUrls,
    payload?.imagenesUrls,
    payload?.imagenes,
    payload?.images
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0 && typeof c[0] === 'string') return c;
  }
  return null;
}

export const useEvaluator = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [answerKey, setAnswerKey] = useState<AnswerKeyData | null>(null);
  const [evaluateDiagnostic, setEvaluateDiagnostic] = useState<EvaluateDiagnosticPayload | null>(null);

  const clearEvaluateDiagnostic = useCallback(() => {
    setEvaluateDiagnostic(null);
  }, []);

  const reportEvaluateDiagnostic = useCallback((partial: EvaluateDiagnosticPayload) => {
    setEvaluateDiagnostic({
      mode: 'LIBELIA_EVALUATE_DEBUG_V1',
      timestamp: new Date().toISOString(),
      ...partial,
    });
  }, []);

  // Funcion para guardar la plantilla del profesor (memorizada por el sistema)
  const saveAnswerKey = useCallback((data: AnswerKeyData) => {
    setAnswerKey(data);
    try {
      sessionStorage.setItem('libelia_answer_key_v1', JSON.stringify(data));
      // Persistir también en localStorage para que sobreviva al cierre del navegador
      localStorage.setItem('libelia_answer_key_v1', JSON.stringify(data));
    } catch {
      // Si storage esta bloqueado, no pasa nada
    }
  }, []);

  // Funcion para cargar la plantilla guardada (prioridad: estado > session > localStorage)
  const loadAnswerKey = useCallback((): AnswerKeyData | null => {
    if (answerKey) return answerKey;
    try {
      let stored = sessionStorage.getItem('libelia_answer_key_v1');
      if (!stored) stored = localStorage.getItem('libelia_answer_key_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        setAnswerKey(parsed);
        return parsed;
      }
    } catch {
      // Si falla, retornamos null
    }
    return null;
  }, [answerKey]);

  // Funcion para limpiar la plantilla
  const clearAnswerKey = useCallback(() => {
    setAnswerKey(null);
    try {
      sessionStorage.removeItem('libelia_answer_key_v1');
      localStorage.removeItem('libelia_answer_key_v1');
    } catch {
      // Si falla, no pasa nada
    }
  }, []);

  // Funcion para convertir la plantilla a formato de pauta texto
  const answerKeyToPauta = useCallback((key: AnswerKeyData): string => {
    // Genera formato compatible: "SM1:A; SM2:B; SM3:C; ..."
    // Usamos prefijo SM para seleccion multiple
    return key.respuestas
      .filter(r => r.respuestaCorrecta && r.respuestaCorrecta.trim() !== "")
      .map(r => `SM${r.pregunta}:${r.respuestaCorrecta}`)
      .join('; ');
  }, []);

  const evaluate = useCallback(async (payload: any): Promise<any> => {
    setIsLoading(true);
    setEvaluateDiagnostic(null);
    const urlAttempted =
      typeof window !== 'undefined' ? `${window.location.origin}/api/evaluate` : '/api/evaluate';

    const requestSummary = (p: any) => ({
      fileUrlsCount: Array.isArray(p?.fileUrls) ? p.fileUrls.length : 0,
      firstUrlKind:
        Array.isArray(p?.fileUrls) && typeof p.fileUrls[0] === 'string'
          ? p.fileUrls[0].startsWith('data:')
            ? 'data_url'
            : /^https?:\/\//i.test(p.fileUrls[0])
              ? 'http_s'
              : 'other_string'
          : null,
      firstUrlPreview:
        Array.isArray(p?.fileUrls) && typeof p.fileUrls[0] === 'string'
          ? String(p.fileUrls[0]).slice(0, 240)
          : null,
    });

    try {
      // ✅ No mutar el payload original
      const payloadFinal: any = { ...payload };

      // Plantilla del profesor: se inyecta SOLO como CLAVE de corrección (respuestas correctas).
      // NUNCA se usa como respuestas del estudiante: la extracción del estudiante viene de sus propias imágenes.
      const currentAnswerKey = loadAnswerKey();
      if (currentAnswerKey && currentAnswerKey.respuestas.length > 0) {
        payloadFinal.answerKeyFromTemplate = currentAnswerKey;
        payloadFinal.pautaPlantilla = answerKeyToPauta(currentAnswerKey);
        if (currentAnswerKey.imagenPlantilla) {
          payloadFinal.templateImageUrl = currentAnswerKey.imagenPlantilla;
        }
        if (currentAnswerKey.templateId) {
          payloadFinal.templateId = currentAnswerKey.templateId;
        }
      } else {
        const bodyLen = Array.isArray(payloadFinal.answerKeyFromTemplate?.respuestas)
          ? payloadFinal.answerKeyFromTemplate.respuestas.length
          : 0;
        if (bodyLen === 0) {
          const syn = buildTeacherAnswerKeyFromFormPauta(
            String(payloadFinal.pautaEstructurada ?? ''),
            String(payloadFinal.pautaCorrectaAlternativas ?? ''),
            payloadFinal.tipoPrueba,
          );
          if (syn?.respuestas?.length) {
            payloadFinal.answerKeyFromTemplate = syn;
            payloadFinal.pautaPlantilla = syn.respuestas
              .map((r) => `SM${r.pregunta}:${r.respuestaCorrecta}`)
              .join('; ');
          }
        }
      }

      /** ======================================
       *  BLOQUE NUEVO (OPCIONAL): OMR Pro
       *  ======================================
       *  - Si /api/omr NO existe o falla: NO rompe nada.
       *  - Si existe y devuelve respuestasAlternativas: se inyecta y tu backend la usará.
       */
      const fileUrls = getPayloadFileUrls(payloadFinal);

      if (fileUrls && fileUrls.length > 0 && !shouldSkipClientOmr(payloadFinal)) {
        const omrSession = loadOmrSession();
        const templateId = payloadFinal.templateId || omrSession.templateId || 'auto';
        const captureMode = payloadFinal.captureMode || 'X'; // cruces

        try {
          const omrResp = await fetch('/api/omr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileUrls,
              templateId,
              captureMode,
              sessionCalibration: omrSession.calibration || null
            }),
          });

          // fetch no lanza error por 404, por eso verificamos ok:
          if (omrResp.ok) {
            const omrData = await omrResp.json();

            // Si el OMR trae alternativas, las adjuntamos
            if (omrData?.success && omrData?.respuestasAlternativas) {
              payloadFinal.respuestasAlternativas = omrData.respuestasAlternativas;

              // memoria momentánea (solo si viene algo)
              if (omrData?.templateId || omrData?.calibration) {
                saveOmrSession({
                  templateId: omrData.templateId || templateId,
                  calibration: omrData.calibration || omrSession.calibration || null,
                  updatedAt: Date.now(),
                });
              }
            }
          }
        } catch (e) {
          // IMPORTANTÍSIMO: si el OMR falla, seguimos igual con evaluate
          console.warn('[OMR] No disponible/falló. Continuando evaluación normal.', e);
        }
      }

      // Llama a tu API para procesar imágenes y extraer texto (tu flujo actual)
      let bodyStr: string;
      try {
        bodyStr = JSON.stringify(payloadFinal);
      } catch (serErr) {
        const diagnostic: EvaluateDiagnosticPayload = {
          phase: 'serialize_request_body',
          urlAttempted,
          method: 'POST',
          responseStatus: null,
          responseStatusText: null,
          responseBodyFromServer: null,
          requestBodyBytes: null,
          requestSummary: requestSummary(payloadFinal),
          errorSerialized: serializeUnknown(serErr),
          note: 'JSON.stringify(payloadFinal) falló (referencia circular, BigInt, etc.).',
        };
        setEvaluateDiagnostic({
          mode: 'LIBELIA_EVALUATE_DEBUG_V1',
          timestamp: new Date().toISOString(),
          ...diagnostic,
        });
        const msg =
          serErr instanceof Error ? serErr.message : 'No se pudo serializar el cuerpo para /api/evaluate';
        return { success: false, error: msg, diagnostic };
      }

      let response: Response;
      try {
        response = await fetch('/api/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
        });
      } catch (netErr) {
        const diagnostic: EvaluateDiagnosticPayload = {
          phase: 'fetch_network_or_cors',
          urlAttempted,
          method: 'POST',
          fetchPathUsed: '/api/evaluate',
          responseStatus: null,
          responseStatusText: null,
          responseBodyFromServer: null,
          requestBodyBytes: bodyStr.length,
          requestSummary: requestSummary(payloadFinal),
          errorSerialized: serializeUnknown(netErr),
          hint: 'TypeError "fetch failed": red, CORS, TLS, proxy o cuerpo demasiado grande.',
        };
        setEvaluateDiagnostic({
          mode: 'LIBELIA_EVALUATE_DEBUG_V1',
          timestamp: new Date().toISOString(),
          ...diagnostic,
        });
        const msg = netErr instanceof Error ? netErr.message : 'fetch failed';
        return { success: false, error: msg, diagnostic };
      }

      const rawBody = await response.text();
      let data: any = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch (parseErr) {
        const diagnostic: EvaluateDiagnosticPayload = {
          phase: 'parse_response_json',
          urlAttempted,
          method: 'POST',
          responseStatus: response.status,
          responseStatusText: response.statusText,
          responseBodyFromServer: rawBody.slice(0, 120_000),
          requestBodyBytes: bodyStr.length,
          requestSummary: requestSummary(payloadFinal),
          errorSerialized: serializeUnknown(parseErr),
        };
        setEvaluateDiagnostic({
          mode: 'LIBELIA_EVALUATE_DEBUG_V1',
          timestamp: new Date().toISOString(),
          ...diagnostic,
        });
        return {
          success: false,
          error: `Error parseando JSON de /api/evaluate (status ${response.status}).`,
          diagnostic,
        };
      }

      // SNAPSHOT_NATIONAL_ANALYTICS_V1: trazabilidad para inspeccionar payload real en navegador
      console.log("DEBUG - Respuesta completa:", data);
      if (!response.ok || !data?.success) {
        const diagnostic: EvaluateDiagnosticPayload = {
          phase: 'api_returned_error',
          urlAttempted,
          method: 'POST',
          responseStatus: response.status,
          responseStatusText: response.statusText,
          responseBodyFromServer: rawBody.slice(0, 120_000),
          parsedJson: data,
          serverErrorMessage: data?.error ?? null,
          requestBodyBytes: bodyStr.length,
          requestSummary: requestSummary(payloadFinal),
        };
        setEvaluateDiagnostic({
          mode: 'LIBELIA_EVALUATE_DEBUG_V1',
          timestamp: new Date().toISOString(),
          ...diagnostic,
        });
        const msg = data?.error || `Error en la evaluación (status ${response.status}).`;
        return { success: false, error: msg, diagnostic };
      }

      // Si hay pauta y respuestas extraídas, corrige autom��ticamente (tu lógica actual)
      if (payloadFinal?.pauta && data?.respuestasExtraidas && typeof data.respuestasExtraidas === "object") {
        const pauta = parsePauta(payloadFinal.pauta);
        const respuestasExtraidasSeguras = {
          sm: Array.isArray((data as any)?.respuestasExtraidas?.sm) ? (data as any).respuestasExtraidas.sm : [],
          vf: Array.isArray((data as any)?.respuestasExtraidas?.vf) ? (data as any).respuestasExtraidas.vf : [],
        };
        const correccion = corregirObjetivas(pauta, respuestasExtraidasSeguras);

        data.retroalimentacion = {
          ...(data?.retroalimentacion ?? {}),
          correccion_objetiva: correccion
        };
      }

      return data;
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Fallo inesperado en cliente al procesar /api/evaluate";
      const diagnostic: EvaluateDiagnosticPayload = {
        phase: 'unexpected_catch',
        urlAttempted,
        method: 'POST',
        errorSerialized: serializeUnknown(err),
        requestSummary: requestSummary(payload),
      };
      setEvaluateDiagnostic({
        mode: 'LIBELIA_EVALUATE_DEBUG_V1',
        timestamp: new Date().toISOString(),
        ...diagnostic,
      });
      return { success: false, error: msg, diagnostic };
    } finally {
      setIsLoading(false);
    }
  }, [loadAnswerKey, answerKeyToPauta]);

// Nueva funcion: Comparar respuestas del estudiante con la plantilla del profesor
  const compareWithAnswerKey = useCallback(async (studentAnswers: { pregunta: string | number; respuesta: string; confianza: number }[]) => {
    const currentKey = loadAnswerKey();
    if (!currentKey || currentKey.respuestas.length === 0) {
      return { success: false, error: "No hay plantilla del profesor cargada" };
    }

    try {
      const response = await fetch('/api/omr/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answerKey: currentKey.respuestas,
          studentAnswers,
          exigencia: 0.6 // 60% para nota 4.0
        }),
      });

      const rawBody = await response.text();
      let data: any = {};
      try {
        data = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        return {
          success: false,
          error: `Error parseando JSON de /api/omr/compare (status ${response.status}).`,
        };
      }
      console.log("DEBUG - Respuesta completa:", data);
      return data;
    } catch (err: any) {
      return {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : "Fallo de red o parsing en cliente al procesar /api/omr/compare",
      };
    }
  }, [loadAnswerKey]);

  return { 
    evaluate, 
    isLoading,
    evaluateDiagnostic,
    clearEvaluateDiagnostic,
    reportEvaluateDiagnostic,
    // Funciones para manejar la plantilla del profesor
    answerKey,
    saveAnswerKey,
    loadAnswerKey,
    clearAnswerKey,
    answerKeyToPauta,
    // Nueva funcion de comparacion
    compareWithAnswerKey,
  };
};
