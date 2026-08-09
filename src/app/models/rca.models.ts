// NEW Interfaces based on the backend's RcaResult structure

export interface FrontendSulfurAssessment {
  assessment_details: string;
  mitigation_options: string[];
}

export interface FrontendProcessEvaluation {
  evaluation_details: string;
  optimization_suggestions: string[];
}

// Define interfaces for the detailed structures
export interface FrontendContributingFactor {
  factor_id: string;
  factor_description: string;
  likelihood: number | string; // Allow string if LLM might send "Medium" etc.
  evidence_sources: string[];
  impact_on_failure_mode: string;
}

export interface FrontendMitigationStrategy {
  strategy_id: string;
  strategy_description: string;
  effectiveness_score: number | string; // Allow string
  estimated_cost_category: string;
  implementation_priority?: string;
}

export interface FrontendIdentifiedFailureMode {
  failure_mode_id: string;
  description: string;
  likelihood: string;
  severity: string;
  contributing_factors: FrontendContributingFactor[]; // Updated
  mitigation_strategies: FrontendMitigationStrategy[]; // Updated
}

export interface FrontendRootCauseAnalysis {
  methodology_description: string;
  identified_failure_modes: FrontendIdentifiedFailureMode[];
  underlying_causes: string[];
}

export interface FrontendImmediateAction {
  action_id: string;
  description: string;
  priority: string;
  responsible_party: string;
  timeline: string;
}

export interface FrontendRecommendation {
  recommendation_id: string;
  description: string;
  expected_impact: string;
  estimated_cost: string;
  priority: string;
}

export interface FrontendPerformancePrediction {
  scenario_description: string;
  predicted_outcome: string;
  confidence_level: string;
}

export interface FrontendRegulatoryCompliance {
  compliance_status: string;
  relevant_regulations: string[];
  corrective_actions_needed: string[];
}

export interface FrontendDataConfidence {
  overall_confidence_score: string;
  confidence_assessment_details: string;
  data_gaps: string[];
}

// Updated RcaResult for the frontend
export interface RcaResult {
  analysis_id: string;
  analyzed_node_id: string;
  analysis_summary: string;
  sulfur_assessment: FrontendSulfurAssessment;
  process_evaluation: FrontendProcessEvaluation;
  root_cause_analysis: FrontendRootCauseAnalysis;
  immediate_actions: FrontendImmediateAction[];
  recommendations: FrontendRecommendation[];
  performance_predictions: FrontendPerformancePrediction;
  regulatory_compliance: FrontendRegulatoryCompliance;
  data_confidence: FrontendDataConfidence;
}

// --- OLDER INTERFACES (to be reviewed/removed if no longer needed) ---
// It seems the interfaces below (RcaFactor, RecommendedSolution, FailureMode, etc.)
// were part of a previous data model. They might need to be deprecated or integrated
// into the new structure if any concepts are still relevant and not covered.

export interface RcaFactor {
  description: string;
}

export interface RecommendedSolution {
  id: string;
  description: string;
  estimatedEffectiveness?: 'High' | 'Medium' | 'Low';
  estimatedCost?: 'Low' | 'Medium' | 'High';
}

export interface FailureMode {
  id: string;
  name: string;
  description: string;
  typicalCauses: RcaFactor[];
  impacts: RcaFactor[];
  detectionMethods: RcaFactor[];
  potentialSolutions: RecommendedSolution[];
}

export interface RcaObservationInput {
  symptom?: string;
  detectedFailureModeIds?: string[];
  equipmentInvolved?: string[];
  processVariables?: { name: string; value: any; unit: string }[];
}

// The following Frontend* interfaces were attempts to map to a previous backend model.
// They should be reviewed against the new RcaResult structure above.
export interface FrontendRcaFactor {
  factor: string;
  likelihood: number;
  evidence: string[];
}

export interface FrontendRecommendedSolution {
  solution: string;
  estimatedImpact: string;
  confidence: number;
}

export interface FrontendFailureMode {
  mode: string;
  description: string;
  potentialCauses: FrontendRcaFactor[];
  recommendedSolutions: FrontendRecommendedSolution[];
}

// This RcaResult was the previous version, now superseded by the one at the top.
// export interface RcaResult {
//   analyzedNodeId: string; 
//   summary: string; 
//   failureModes: FrontendFailureMode[]; 
//   overallConfidence: number; 
//   timestamp: string; 
// }

export interface RcaTestScenario {
  id: string;
  name: string;
  description: string;
  observations: RcaObservationInput;
  expectedRootCauses?: string[];
  expectedSolutions?: string[];
  expectedFailureModeIds?: string[];
}
