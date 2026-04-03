#!/usr/bin/env node
"use strict";

/**
 * PHASE_6_NORMATIVE_ENGINE_V1
 * Seed normativo:
 * - DEMRE PAES Competencia Lectora (2024, 2025) Regular.
 * - Cortes Agencia (Insuficiente/Elemental/Adecuado) para 2M y 8B.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-pedagogical-parameters.cjs
 */

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRole) {
  console.error("Faltan SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const DEMRE_2024_LECTORA_0_60 = [
  [0,100],[1,116],[2,142],[3,164],[4,184],[5,205],[6,225],[7,244],[8,261],[9,276],
  [10,290],[11,304],[12,319],[13,336],[14,352],[15,366],[16,377],[17,386],[18,396],[19,407],
  [20,421],[21,436],[22,451],[23,465],[24,474],[25,482],[26,490],[27,498],[28,508],[29,521],
  [30,537],[31,551],[32,565],[33,574],[34,583],[35,590],[36,598],[37,609],[38,622],[39,638],
  [40,653],[41,667],[42,677],[43,687],[44,697],[45,709],[46,724],[47,740],[48,756],[49,772],
  [50,786],[51,801],[52,817],[53,835],[54,856],[55,876],[56,898],[57,920],[58,946],[59,974],[60,1000],
];

const DEMRE_2025_LECTORA_0_60 = [
  [0,100],[1,186],[2,210],[3,232],[4,253],[5,271],[6,288],[7,304],[8,322],[9,339],
  [10,355],[11,369],[12,380],[13,391],[14,402],[15,415],[16,430],[17,446],[18,460],[19,471],
  [20,479],[21,486],[22,494],[23,502],[24,514],[25,528],[26,543],[27,557],[28,569],[29,577],
  [30,583],[31,589],[32,596],[33,605],[34,617],[35,631],[36,647],[37,660],[38,671],[39,680],
  [40,687],[41,694],[42,703],[43,715],[44,730],[45,746],[46,761],[47,773],[48,785],[49,795],
  [50,808],[51,823],[52,840],[53,858],[54,876],[55,893],[56,911],[57,931],[58,954],[59,978],[60,1000],
];

function expandTo65(baseRows) {
  const out = baseRows.map(([correctas, score]) => ({ correctas, score }));
  // En Competencia Lectora oficial publicada se reporta 0..60.
  // Para compatibilidad con cargas 0..65, se saturan 61..65 en 1000.
  for (let c = 61; c <= 65; c++) out.push({ correctas: c, score: 1000 });
  return out;
}

function agencyCutsPayload() {
  return {
    cuts: [
      { label: "INSUFICIENTE", min: 0, max: 49.99 },
      { label: "ELEMENTAL", min: 50, max: 69.99 },
      { label: "ADECUADO", min: 70, max: 100 },
    ],
  };
}

async function upsertParameter(row) {
  const { error } = await supabase
    .from("pedagogical_parameters")
    .upsert(row, {
      onConflict: "parameter_key,year,organization_id",
      ignoreDuplicates: false,
    });
  if (error) throw error;
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const common = {
    organization_id: null,
    is_active: true,
    effective_from: today,
    source_org: "DEMRE",
  };

  await upsertParameter({
    ...common,
    parameter_type: "DEMRE_PAES_TABLE",
    parameter_key: "PAES_2024_REGULAR_COMPETENCIA_LECTORA",
    year: 2024,
    subject: "COMPETENCIA_LECTORA",
    exam_name: "PAES",
    application: "REGULAR",
    source_url: "https://demre.cl/paes/factores-seleccion/tabla-transformacion-puntajes-paes-regular-p2024-competencia-lectora",
    source_document: "Tabla de Transformación de Puntajes PAES Regular 2024 - Competencia Lectora",
    source_version: "ADMISION_2024",
    parameter_payload: {
      max_correctas_oficial: 60,
      score_min: 100,
      score_max: 1000,
      rows: expandTo65(DEMRE_2024_LECTORA_0_60),
    },
  });

  await upsertParameter({
    ...common,
    parameter_type: "DEMRE_PAES_TABLE",
    parameter_key: "PAES_2025_REGULAR_COMPETENCIA_LECTORA",
    year: 2025,
    subject: "COMPETENCIA_LECTORA",
    exam_name: "PAES",
    application: "REGULAR",
    source_url: "https://demre.cl/paes/factores-seleccion/tabla-transformacion-puntajes-paes-regular-p2025-competencia-lectora",
    source_document: "Tabla de Transformación de Puntajes PAES Regular 2025 - Competencia Lectora",
    source_version: "ADMISION_2025",
    parameter_payload: {
      max_correctas_oficial: 60,
      score_min: 100,
      score_max: 1000,
      rows: expandTo65(DEMRE_2025_LECTORA_0_60),
    },
  });

  const agencyCommon = {
    organization_id: null,
    parameter_type: "AGENCY_LEVEL_CUTS",
    year: 2025,
    subject: "GENERAL",
    exam_name: "SIMCE",
    application: null,
    source_org: "AGENCIA",
    source_url: "https://www.curriculumnacional.cl/portal/Evaluacion/Estandares-y-otros-indicadores/Estandares-de-Aprendizaje/",
    source_document: "Estándares de Aprendizaje (niveles de logro)",
    source_version: "REFERENCIAL_2025",
    effective_from: today,
    is_active: true,
  };

  await upsertParameter({
    ...agencyCommon,
    parameter_key: "AGENCY_LEVEL_CUTS_2M_GENERAL_2025",
    grade_level: "2M",
    parameter_payload: agencyCutsPayload(),
  });

  await upsertParameter({
    ...agencyCommon,
    parameter_key: "AGENCY_LEVEL_CUTS_8B_GENERAL_2025",
    grade_level: "8B",
    parameter_payload: agencyCutsPayload(),
  });

  console.log("Seed pedagógico completado: DEMRE 2024/2025 + cortes Agencia 2M/8B.");
}

main().catch((e) => {
  console.error("Error en seed pedagógico:", e?.message || e);
  process.exit(1);
});
