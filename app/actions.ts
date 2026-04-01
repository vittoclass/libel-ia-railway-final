'use server';

import { NextResponse } from "next/server";

interface Payload {
  fileUrls: string[];
  rubrica: string;
  pauta?: string;
  flexibilidad: number;
  tipoEvaluacion: string;
  areaConocimiento: string;
  userEmail: string;
}

export async function evaluate(payload: Payload) {
    try {
        // SNAPSHOT_NATIONAL_ANALYTICS_V1: ruta relativa para evitar dependencia de host hardcodeado
        const res = await fetch('/api/evaluate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const json = await res.json();

        if (!res.ok || json?.success === false) {
            const msg = json?.error || res.statusText || `HTTP ${res.status}`;
            console.error('API /evaluate error:', msg, json);
            return { success: false, error: msg };
        }

        return json;
    } catch (error) {
        console.error('Error in evaluate function:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}