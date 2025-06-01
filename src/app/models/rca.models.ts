export interface RcaFactor {
  description: string;
  // We can add more properties like 'type', 'likelihood', etc., as needed.
}

export interface RecommendedSolution {
  id: string;
  description: string;
  estimatedEffectiveness?: 'High' | 'Medium' | 'Low';
  estimatedCost?: 'Low' | 'Medium' | 'High';
  // Could link to procedures or further actions.
}

export interface FailureMode {
  id: string; // e.g., 'heat-exchanger-fouling'
  name: string; // e.g., 'Heat Exchanger Tube Fouling'
  description: string;
  typicalCauses: RcaFactor[];
  impacts: RcaFactor[];
  detectionMethods: RcaFactor[];
  potentialSolutions: RecommendedSolution[]; // Solutions specific to this failure mode
}

// Input for the RCA process
export interface RcaObservationInput {
  symptom?: string; // User-described symptom
  detectedFailureModeIds?: string[]; // If specific failure modes are suspected
  equipmentInvolved?: string[]; // e.g., ['Heat Exchanger H-101']
  processVariables?: { name: string; value: any; unit: string }[]; // e.g., [{ name: 'Outlet Temperature', value: 350, unit: 'C' }]
  // We can add other relevant inputs like timestamps, operational context, etc.
}

// Corresponds to backend RcaFactor
export interface FrontendRcaFactor {
  factor: string; // Was description in original frontend model
  likelihood: number; // 0.0 to 1.0
  evidence: string[];
}

// Corresponds to backend RecommendedSolution
export interface FrontendRecommendedSolution {
  solution: string; // Was description in original frontend model
  estimatedImpact: string; // Was estimatedEffectiveness in original frontend model
  confidence: number; // 0.0 to 1.0
  // id removed
  // estimatedCost removed (not in backend model but was in original frontend)
}

// Corresponds to backend FailureMode
export interface FrontendFailureMode {
  mode: string; // Was name/id in original frontend model
  description: string;
  potentialCauses: FrontendRcaFactor[]; // Replaces typicalCauses, impacts, detectionMethods
  recommendedSolutions: FrontendRecommendedSolution[]; // Replaces potentialSolutions
}

// Corresponds to backend RcaResult and LLM output structure
export interface RcaResult {
  analyzedNodeId: string; // New, from backend
  summary: string; // Was analysisDetails in original frontend model
  failureModes: FrontendFailureMode[]; // Was potentialFailureModes
  overallConfidence: number; // Was confidenceScore, now non-optional as per backend
  timestamp: string; // New, from backend

  // Removed fields from original frontend model that are not top-level in backend:
  // - identifiedRootCauses (now nested in failureModes.potentialCauses)
  // - contributingFactors (not in backend model)
  // - recommendedSolutions (now nested in failureModes.recommendedSolutions)
  // - potentialFailureModes (renamed to failureModes)
  // - confidenceScore (renamed to overallConfidence)
  // - analysisDetails (renamed to summary)
}

// This interface can be used to structure the test scenarios you mentioned
export interface RcaTestScenario {
  id: string;
  name: string;
  description: string;
  observations: RcaObservationInput;
  expectedRootCauses?: string[]; // Descriptions or IDs
  expectedSolutions?: string[]; // Descriptions or IDs
  expectedFailureModeIds?: string[]; // IDs of failure modes expected to be identified
}
