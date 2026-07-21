/**
 * Capa multimodal Artes — aditiva, server-only, flag default OFF.
 * Camino B: sustituye rama visual bajo flag; mismo scoring oficial.
 */

export {
  MULTIMODAL_ARTS_FLAG_ENV,
  isMultimodalArtsEvaluationEnabled,
  shouldRunMultimodalArtsPath,
} from "@/app/lib/multimodal/flag"

export type {
  MultimodalArtsEvaluationInput,
  MultimodalArtsEvaluationResult,
  MultimodalArtsImageInput,
  MultimodalImageRole,
  MultimodalCriterionEvidence,
  OfficialCriterioEvaluado,
  MultimodalObservationStatus,
  MultimodalNivelLogro,
  MultimodalConfidence,
} from "@/app/lib/multimodal/types"

export {
  diagnoseImageQuality,
  diagnoseAllImages,
  qualityBlocksObservation,
} from "@/app/lib/multimodal/image-quality"
export type { ImageQualityDiagnosis } from "@/app/lib/multimodal/image-quality"

export {
  adaptMultimodalEvidenceToCriteriosEvaluados,
  projectCriteriosIntoRespuestasDesarrollo,
  criteriosEvaluadosAreValid,
  enforceNoObservableStatusInvariant,
} from "@/app/lib/multimodal/adapter-to-criterios"

export { buildMultimodalArtsPrompt } from "@/app/lib/multimodal/multimodal-prompt"

export {
  requestMultimodalArtsVision,
  selectPrimaryMultimodalImage,
} from "@/app/lib/multimodal/multimodal-vision-provider"

export {
  runMultimodalArtsEvaluation,
  mergeMultimodalIntoRespuestasDesarrollo,
} from "@/app/lib/multimodal/evaluate-multimodal-arts"
export type { RunMultimodalArtsEvaluationParams } from "@/app/lib/multimodal/evaluate-multimodal-arts"
