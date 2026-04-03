-- Nombre legible en resumen (respaldo cuando evaluation_students.student_name está vacío).
ALTER TABLE evaluation_summaries
  ADD COLUMN IF NOT EXISTS student_name_raw text;

COMMENT ON COLUMN evaluation_summaries.student_name_raw IS 'Nombre del estudiante al momento del resumen (detección o confirmación); respaldo para dashboards.';
