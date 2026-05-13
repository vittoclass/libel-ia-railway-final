export type OmrTemplateVariantInterleaved = "odd_even_dual_column" | "sequential_dual_column" | "single_column"

export type LayoutMark = {
  state: "selected" | "unselected"
  polygonNorm: { x: number; y: number }[]
  centerX: number
  centerY: number
  confidence: number
}

export type IndexedMark = { idx: number; mark: LayoutMark }

export type OmrClosedLayoutMode = "standard" | "interleaved_development"

export type { HybridSlotDescriptor, HybridSlotTopology, HybridTopologySnapshotForensics } from "./hybrid-slot-topology"
