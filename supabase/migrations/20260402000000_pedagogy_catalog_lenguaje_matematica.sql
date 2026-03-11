-- Catálogo pedagógico completo: Lenguaje y Matemática (ejes y habilidades SIMCE/PAES).
-- Idempotente: solo inserta si no existen (por subject+name / axis_id+name).

-- ========== LENGUAJE: Ejes ==========
INSERT INTO pedagogy_axes (subject, name)
SELECT 'Lenguaje', 'Comprensión lectora'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Lenguaje' AND name = 'Comprensión lectora');

INSERT INTO pedagogy_axes (subject, name)
SELECT 'Lenguaje', 'Análisis de textos'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Lenguaje' AND name = 'Análisis de textos');

INSERT INTO pedagogy_axes (subject, name)
SELECT 'Lenguaje', 'Escritura'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Lenguaje' AND name = 'Escritura');

INSERT INTO pedagogy_axes (subject, name)
SELECT 'Lenguaje', 'Reflexión sobre la lengua'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Lenguaje' AND name = 'Reflexión sobre la lengua');

-- ========== MATEMÁTICA: Ejes ==========
INSERT INTO pedagogy_axes (subject, name)
SELECT 'Matemática', 'Números y operaciones'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Matemática' AND name = 'Números y operaciones');

INSERT INTO pedagogy_axes (subject, name)
SELECT 'Matemática', 'Álgebra y funciones'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Matemática' AND name = 'Álgebra y funciones');

INSERT INTO pedagogy_axes (subject, name)
SELECT 'Matemática', 'Geometría'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Matemática' AND name = 'Geometría');

INSERT INTO pedagogy_axes (subject, name)
SELECT 'Matemática', 'Datos y probabilidad'
WHERE NOT EXISTS (SELECT 1 FROM pedagogy_axes WHERE subject = 'Matemática' AND name = 'Datos y probabilidad');

-- ========== LENGUAJE: Habilidades por eje ==========

-- Comprensión lectora
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Localizar información' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Comprensión lectora' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Localizar información');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Inferir información' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Comprensión lectora' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Inferir información');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Interpretar' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Comprensión lectora' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Interpretar');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Evaluar' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Comprensión lectora' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Evaluar');

-- Análisis de textos
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Reconocer estructura textual' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Análisis de textos' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Reconocer estructura textual');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Identificar tipo de texto' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Análisis de textos' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Identificar tipo de texto');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Analizar narrador o hablante' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Análisis de textos' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Analizar narrador o hablante');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Analizar recursos expresivos' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Análisis de textos' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Analizar recursos expresivos');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Identificar propósito comunicativo' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Análisis de textos' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Identificar propósito comunicativo');

-- Escritura
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Organización de ideas' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Escritura' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Organización de ideas');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Coherencia' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Escritura' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Coherencia');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Cohesión' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Escritura' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Cohesión');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Adecuación al propósito' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Escritura' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Adecuación al propósito');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Uso de vocabulario' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Escritura' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Uso de vocabulario');

-- Reflexión sobre la lengua
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Gramática en contexto' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Reflexión sobre la lengua' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Gramática en contexto');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Ortografía' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Reflexión sobre la lengua' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Ortografía');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Puntuación' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Reflexión sobre la lengua' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Puntuación');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Uso de conectores' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Reflexión sobre la lengua' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Uso de conectores');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Uso adecuado del registro' FROM pedagogy_axes a WHERE a.subject = 'Lenguaje' AND a.name = 'Reflexión sobre la lengua' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Uso adecuado del registro');

-- ========== MATEMÁTICA: Habilidades por eje ==========

-- Números y operaciones
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Operaciones básicas' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Números y operaciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Operaciones básicas');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Cálculo mental' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Números y operaciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Cálculo mental');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Estimación' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Números y operaciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Estimación');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Proporcionalidad' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Números y operaciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Proporcionalidad');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Fracciones y decimales' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Números y operaciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Fracciones y decimales');

-- Álgebra y funciones
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Identificar patrones' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Álgebra y funciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Identificar patrones');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Resolver ecuaciones' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Álgebra y funciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Resolver ecuaciones');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Modelar situaciones' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Álgebra y funciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Modelar situaciones');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Interpretar funciones' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Álgebra y funciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Interpretar funciones');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Relaciones algebraicas' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Álgebra y funciones' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Relaciones algebraicas');

-- Geometría
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Reconocimiento de figuras' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Geometría' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Reconocimiento de figuras');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Perímetro y área' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Geometría' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Perímetro y área');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Propiedades geométricas' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Geometría' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Propiedades geométricas');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Transformaciones geométricas' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Geometría' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Transformaciones geométricas');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Visualización espacial' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Geometría' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Visualización espacial');

-- Datos y probabilidad
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Interpretar gráficos' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Datos y probabilidad' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Interpretar gráficos');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Analizar tablas' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Datos y probabilidad' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Analizar tablas');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Probabilidad básica' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Datos y probabilidad' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Probabilidad básica');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Análisis de tendencias' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Datos y probabilidad' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Análisis de tendencias');
INSERT INTO pedagogy_skills (axis_id, name) SELECT a.id, 'Toma de decisiones con datos' FROM pedagogy_axes a WHERE a.subject = 'Matemática' AND a.name = 'Datos y probabilidad' AND NOT EXISTS (SELECT 1 FROM pedagogy_skills s WHERE s.axis_id = a.id AND s.name = 'Toma de decisiones con datos');

NOTIFY pgrst, 'reload schema';
