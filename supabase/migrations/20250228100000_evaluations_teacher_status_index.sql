-- Índice para listados por profesor y estado (Evaluaciones / Historial).
CREATE INDEX IF NOT EXISTS evaluations_teacher_status_idx
ON public.evaluations (teacher_id, status, evaluated_at DESC);
