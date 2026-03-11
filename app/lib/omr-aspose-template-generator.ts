/**
 * Generador de markup JSON para Aspose.OMR Cloud a partir de la hoja estándar LibelIA.
 * Equivalente lógico: numQuestions, numOptions, 2 columnas, opciones A–D o A–E.
 * No llama a APIs; solo construye el objeto JSON que se enviará a PostGenerateTemplate.
 */

export interface AsposeMarkupOptions {
  numQuestions: number
  numOptions: number
  name?: string
}

/**
 * Construye el JSON markup de Aspose para una hoja tipo LibelIA:
 * Template → Page → Text (título) + AnswerSheet (elementos_count, columns_count: 2, answers_count, answers_list).
 */
export function buildLibelIAAsposeMarkup(opts: AsposeMarkupOptions): object {
  const { numQuestions, numOptions, name = "LibelIA" } = opts
  const answersList = "ABCDEFGH".slice(0, Math.min(26, Math.max(2, numOptions))).split("")
  return {
    element_type: "Template",
    children: [
      {
        element_type: "Page",
        children: [
          {
            element_type: "Text",
            name: `${name} OMR`,
            font_size: 14,
            font_style: "bold",
          },
          {
            element_type: "EmptyLine",
          },
          {
            element_type: "AnswerSheet",
            name: "LibelIA",
            elements_count: Math.max(1, Math.min(200, numQuestions)),
            columns_count: 2,
            answers_count: answersList.length,
            answers_list: answersList,
            bubble_size: "normal",
            vertical_margin: 8,
          },
        ],
      },
    ],
  }
}

/**
 * Devuelve el markup como string JSON (UTF-8) para codificar en base64.
 */
export function getLibelIAAsposeMarkupJson(opts: AsposeMarkupOptions): string {
  return JSON.stringify(buildLibelIAAsposeMarkup(opts), null, 0)
}
