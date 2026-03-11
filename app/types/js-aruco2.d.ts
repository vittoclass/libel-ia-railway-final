/**
 * Declaración de tipos para js-aruco2 (sin @types publicados).
 */
declare module "js-aruco2" {
  interface ARMarker {
    id: number
    corners: Array<{ x: number; y: number }>
  }
  interface ARDetectorConfig {
    dictionaryName?: string
    maxHammingDistance?: number
  }
  interface ARDetector {
    detect(image: ImageData | { width: number; height: number; data: Uint8ClampedArray }): ARMarker[]
  }
  interface ARDictionary {
    generateSVG(id: number): string
  }
  interface ARStatic {
    Dictionary: new (name: string) => ARDictionary
    Detector: new (config?: ARDetectorConfig) => ARDetector
  }
  const AR: ARStatic
  export { AR }
}
