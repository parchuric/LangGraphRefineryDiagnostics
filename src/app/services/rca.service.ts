import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { 
  FailureMode, 
  RcaObservationInput, 
  RcaResult, 
  RcaTestScenario,
  FrontendIdentifiedFailureMode, // Use this for the new structure
  FrontendSulfurAssessment,
  FrontendProcessEvaluation,
  FrontendRootCauseAnalysis,
  FrontendImmediateAction,
  FrontendRecommendation,
  FrontendPerformancePrediction,
  FrontendRegulatoryCompliance,
  FrontendDataConfidence,
  FrontendContributingFactor, // Added
  FrontendMitigationStrategy // Added
} from '../models/rca.models';

// Mock data based on the user provided failure modes
const MOCK_FAILURE_MODES: FailureMode[] = [
  {
    id: 'heat-exchanger-fouling',
    name: 'Heat Exchanger Tube Fouling',
    description: 'Accumulation of coke, scale, or contaminants on heat exchanger tube surfaces',
    typicalCauses: [
      { description: 'High-temperature coking' },
      { description: 'Catalyst fines carryover' },
      { description: 'Salt deposition' }
    ],
    impacts: [
      { description: 'Reduced heat transfer efficiency' },
      { description: 'Increased pressure drop' },
      { description: 'Potential tube rupture' }
    ],
    detectionMethods: [
      { description: 'Temperature differential monitoring' },
      { description: 'Pressure drop measurements' }
    ],
    potentialSolutions: [
      { id: 'sol-he-1', description: 'Chemical cleaning of tubes', estimatedEffectiveness: 'High', estimatedCost: 'Medium' },
      { id: 'sol-he-2', description: 'Mechanical cleaning (hydrojetting)', estimatedEffectiveness: 'High', estimatedCost: 'Medium' },
      { id: 'sol-he-3', description: 'Optimize operating conditions to reduce fouling rate', estimatedEffectiveness: 'Medium', estimatedCost: 'Low' }
    ]
  },
  {
    id: 'catalyst-deactivation',
    name: 'Catalyst Deactivation',
    description: 'Loss of catalytic activity due to poisoning, sintering, or mechanical degradation',
    typicalCauses: [
      { description: 'Metal contamination (nickel, vanadium)' },
      { description: 'Sulfur poisoning' },
      { description: 'Thermal shock' }
    ],
    impacts: [
      { description: 'Decreased conversion rates' },
      { description: 'Off-specification products' },
      { description: 'Increased coke formation' }
    ],
    detectionMethods: [
      { description: 'Activity tests' },
      { description: 'Selectivity analysis' },
      { description: 'Regeneration frequency monitoring' }
    ],
    potentialSolutions: [
      { id: 'sol-cd-1', description: 'Catalyst regeneration process', estimatedEffectiveness: 'High', estimatedCost: 'High' },
      { id: 'sol-cd-2', description: 'Implement guard beds to remove contaminants', estimatedEffectiveness: 'Medium', estimatedCost: 'Medium' },
      { id: 'sol-cd-3', description: 'Optimize reactor conditions to minimize deactivation', estimatedEffectiveness: 'Medium', estimatedCost: 'Low' }
    ]
  },
  {
    id: 'compressor-surge',
    name: 'Compressor Surge',
    description: 'Flow reversal and pressure oscillations in centrifugal compressors',
    typicalCauses: [
      { description: 'Reduced throughput' },
      { description: 'Blocked discharge' },
      { description: 'Control system malfunction' }
    ],
    impacts: [
      { description: 'Mechanical damage' },
      { description: 'Reduced efficiency' },
      { description: 'Potential catastrophic failure' }
    ],
    detectionMethods: [
      { description: 'Flow rate monitoring' },
      { description: 'Pressure ratio analysis' },
      { description: 'Vibration sensors' }
    ],
    potentialSolutions: [
      { id: 'sol-cs-1', description: 'Install or optimize anti-surge control system', estimatedEffectiveness: 'High', estimatedCost: 'Medium' },
      { id: 'sol-cs-2', description: 'Ensure stable operating conditions and flow rates', estimatedEffectiveness: 'Medium', estimatedCost: 'Low' },
      { id: 'sol-cs-3', description: 'Regular inspection and maintenance of compressor and associated systems', estimatedEffectiveness: 'Medium', estimatedCost: 'Medium' }
    ]
  },
  {
    id: 'corrosion-under-insulation',
    name: 'Corrosion Under Insulation (CUI)',
    description: 'External corrosion of piping and vessels beneath insulation systems',
    typicalCauses: [
      { description: 'Water ingress' },
      { description: 'Chloride contamination' },
      { description: 'Temperature cycling' }
    ],
    impacts: [
      { description: 'Structural integrity loss' },
      { description: 'Potential leaks' },
      { description: 'Safety hazards' }
    ],
    detectionMethods: [
      { description: 'Ultrasonic thickness testing' },
      { description: 'Radiographic inspection' },
      { description: 'Thermal imaging' }
    ],
    potentialSolutions: [
      { id: 'sol-cui-1', description: 'Regular inspection program for CUI', estimatedEffectiveness: 'High', estimatedCost: 'Medium' },
      { id: 'sol-cui-2', description: 'Use appropriate insulation materials and coatings', estimatedEffectiveness: 'Medium', estimatedCost: 'Medium' },
      { id: 'sol-cui-3', description: 'Ensure proper sealing of insulation to prevent water ingress', estimatedEffectiveness: 'High', estimatedCost: 'Low' }
    ]
  },
  {
    id: 'control-valve-sticking',
    name: 'Control Valve Sticking',
    description: 'Valve stem or trim binding preventing proper positioning',
    typicalCauses: [
      { description: 'Process fluid contamination' },
      { description: 'Thermal expansion' },
      { description: 'Actuator malfunction' }
    ],
    impacts: [
      { description: 'Loss of process control' },
      { description: 'Pressure excursions' },
      { description: 'Product quality issues' }
    ],
    detectionMethods: [
      { description: 'Position feedback deviation' },
      { description: 'Control loop performance monitoring' },
      { description: 'Stroke testing' }
    ],
    potentialSolutions: [
      { id: 'sol-cvs-1', description: 'Regular valve maintenance and lubrication', estimatedEffectiveness: 'High', estimatedCost: 'Medium' },
      { id: 'sol-cvs-2', description: 'Install filters to prevent process fluid contamination', estimatedEffectiveness: 'Medium', estimatedCost: 'Low' },
      { id: 'sol-cvs-3', description: 'Upgrade to more robust valve design or materials', estimatedEffectiveness: 'Medium', estimatedCost: 'High' }
    ]
  }
];

@Injectable({
  providedIn: 'root'
})
export class RcaService {

  constructor() { }

  getFailureModes(): Observable<FailureMode[]> {
    return of(MOCK_FAILURE_MODES).pipe(delay(500)); // Simulate API call delay
  }

  getFailureModeById(id: string): Observable<FailureMode | undefined> {
    const mode = MOCK_FAILURE_MODES.find(fm => fm.id === id);
    return of(mode).pipe(delay(300));
  }

  // Mock RCA processing logic
  performRca(input: RcaObservationInput): Observable<RcaResult> {
    let identifiedFailureModes: FrontendIdentifiedFailureMode[] = []; 
    let overallConfidenceNumber = 0.75; 
    let summaryText = "Based on the provided symptoms and process variables (mocked by rca.service.ts):";

    if (input.detectedFailureModeIds && input.detectedFailureModeIds.length > 0) {
      input.detectedFailureModeIds.forEach(id => {
        const fm = MOCK_FAILURE_MODES.find(m => m.id === id); 
        if (fm) {
          const newIdentifiedFm: FrontendIdentifiedFailureMode = {
            failure_mode_id: fm.id,
            description: fm.description,
            likelihood: "Medium (mock)", 
            severity: "High (mock)",
            contributing_factors: fm.typicalCauses.map((tc, index) => ({
              factor_id: `mock-cf-${fm.id}-${index}`,
              factor_description: tc.description,
              likelihood: 0.6, // mock value
              evidence_sources: ["Mock evidence from rca.service.ts"],
              impact_on_failure_mode: "Mock impact statement."
            })), 
            mitigation_strategies: fm.potentialSolutions.map((ps, index) => ({
              strategy_id: `mock-ms-${fm.id}-${index}`,
              strategy_description: ps.description,
              effectiveness_score: 0.75, // mock value
              estimated_cost_category: ps.estimatedCost || "Medium",
              implementation_priority: "Medium"
            }))
          };
          identifiedFailureModes.push(newIdentifiedFm);
          summaryText += `\n- Considered ${fm.name}.`;
        }
      });
    }

    if (input.symptom?.toLowerCase().includes('sulfur') || input.processVariables?.some(pv => pv.name.toLowerCase().includes('sulfur') && parseFloat(pv.value) > 0.02)) {
        const catalystDeac = MOCK_FAILURE_MODES.find(fm => fm.id === 'catalyst-deactivation');
        if (catalystDeac && !identifiedFailureModes.find(iffm => iffm.failure_mode_id === catalystDeac.id)) {
            const sulfurFm: FrontendIdentifiedFailureMode = {
              failure_mode_id: catalystDeac.id,
              description: catalystDeac.description,
              likelihood: "High (mock)",
              severity: "Critical (mock)",
              contributing_factors: [
                {
                  factor_id: "mock-cf-sulfur-1",
                  factor_description: 'High sulfur content in feed leading to catalyst poisoning (mock).',
                  likelihood: 0.9,
                  evidence_sources: ["Process variable: High Sulfur"],
                  impact_on_failure_mode: "Directly poisons catalyst active sites."
                },
                ...catalystDeac.typicalCauses.map((tc, index) => ({
                  factor_id: `mock-cf-${catalystDeac.id}-sulfur-${index}`,
                  factor_description: tc.description,
                  likelihood: 0.7,
                  evidence_sources: ["Domain knowledge (mock)"],
                  impact_on_failure_mode: "Contributes to overall catalyst degradation environment."
                }))
              ],
              mitigation_strategies: catalystDeac.potentialSolutions.map((ps, index) => ({
                strategy_id: `mock-ms-${catalystDeac.id}-sulfur-${index}`,
                strategy_description: ps.description,
                effectiveness_score: 0.8,
                estimated_cost_category: ps.estimatedCost || "High",
                implementation_priority: "High"
              }))
            };
            identifiedFailureModes.push(sulfurFm);
            summaryText += `\n- High sulfur content detected, potentially impacting catalyst.`;
            overallConfidenceNumber = 0.85;
        }
    }

    if (input.detectedFailureModeIds?.includes('heat-exchanger-fouling') && input.detectedFailureModeIds?.includes('compressor-surge')) {
        summaryText += `\n- Detected potential interaction between heat exchanger fouling and compressor surge.`;
        overallConfidenceNumber = 0.90;
    }

    if (identifiedFailureModes.length === 0 && input.symptom) {
      summaryText += '\n- General symptom analysis suggests potential operational issues. More specific data needed for precise RCA.';
      const genericFm: FrontendIdentifiedFailureMode = {
        failure_mode_id: 'generic-anomaly',
        description: 'Operational issues suspected based on general symptoms.',
        likelihood: "Low (mock)",
        severity: "Medium (mock)",
        contributing_factors: [{
          factor_id: "mock-cf-generic-1",
          factor_description: `Undefined operational anomaly based on symptom: ${input.symptom} (mock)`,
          likelihood: 0.3,
          evidence_sources: ["General symptom input (mock)"],
          impact_on_failure_mode: "General system instability suspected."
        }],
        mitigation_strategies: [{
          strategy_id: "mock-ms-generic-1",
          strategy_description: 'Conduct thorough operational review and data gathering (mock).',
          effectiveness_score: 0.5,
          estimated_cost_category: "Medium",
          implementation_priority: "Medium"
        }]
      };
      identifiedFailureModes.push(genericFm);
    }

    identifiedFailureModes = [...new Map(identifiedFailureModes.map(item => [item.failure_mode_id, item])).values()];

    const result: RcaResult = {
      analysis_id: `mock-${new Date().toISOString()}-${Math.random().toString(36).substring(2, 15)}`,
      analyzed_node_id: input.equipmentInvolved && input.equipmentInvolved.length > 0 ? input.equipmentInvolved.join(', ') : 'System (mock)',
      analysis_summary: summaryText,
      sulfur_assessment: { 
        assessment_details: "Mocked sulfur assessment details.", 
        mitigation_options: ["Implement enhanced sulfur scrubbing (mock)."] 
      },
      process_evaluation: { 
        evaluation_details: "Mocked process evaluation details.", 
        optimization_suggestions: ["Adjust reactor temperature profile (mock)."] 
      },
      root_cause_analysis: {
        methodology_description: "Mocked RCA methodology (from rca.service.ts)",
        identified_failure_modes: identifiedFailureModes,
        underlying_causes: identifiedFailureModes.length > 0 ? [
            "Mocked underlying cause based on identified failure modes."
        ] : []
      },
      immediate_actions: identifiedFailureModes.length > 0 ? [{
        action_id: "immediate-mock-1",
        description: "Mocked immediate action: Isolate affected unit.",
        priority: "High",
        responsible_party: "Operations",
        timeline: "End of Shift (mock)" // Added timeline
      }] : [],
      recommendations: identifiedFailureModes.length > 0 ? [{
        recommendation_id: "rec-mock-1",
        description: "Mocked recommendation: Schedule detailed inspection.",
        expected_impact: "Reduced risk of failure (mock)", // Added expected_impact
        estimated_cost: "USD 5000 (mock)",
        priority: "Medium (mock)" // Changed from priority_level
      }] : [],
      performance_predictions: {
        scenario_description: "Scenario: If no action is taken (mock).",
        predicted_outcome: "Continued degradation, potential shutdown (mock).",
        confidence_level: "0.7 (mock)"
      },
      regulatory_compliance: {
        compliance_status: "Review Needed (mock)",
        relevant_regulations: ["EPA Emission Standard XYZ (mock)"],
        corrective_actions_needed: ["Verify emission levels post-event (mock)."]
      },
      data_confidence: {
        overall_confidence_score: overallConfidenceNumber.toFixed(2),
        confidence_assessment_details: "Mocked confidence assessment based on available data (rca.service.ts).",
        data_gaps: ["Real-time sensor data for component X (mock)."]
      }
    };

    return of(result).pipe(delay(1500));
  }

  // Mock test scenarios based on user requirements
  getTestScenarios(): Observable<RcaTestScenario[]> {
    const scenarios: RcaTestScenario[] = [
      {
        id: 'test-sulfur',
        name: 'High Sulfur Content Detection',
        description: 'Test RCA when high sulfur is indicated in process variables.',
        observations: {
          symptom: 'Reduced product yield, off-spec product.',
          processVariables: [{ name: 'Feed Sulfur Content', value: '0.05', unit: '%' }]
        },
        expectedFailureModeIds: ['catalyst-deactivation'],
        expectedRootCauses: ['High sulfur content in feed leading to catalyst poisoning.']
      },
      {
        id: 'test-catalyst-pattern',
        name: 'Catalyst Deactivation Patterns',
        description: 'Test RCA for typical catalyst deactivation symptoms.',
        observations: {
          symptom: 'Gradual loss of conversion over weeks, increased regeneration needs.',
          detectedFailureModeIds: ['catalyst-deactivation']
        }
      },
      {
        id: 'test-he-fouling',
        name: 'Heat Exchanger Fouling',
        description: 'Test RCA for heat exchanger fouling based on temperature and pressure data.',
        observations: {
          equipmentInvolved: ['Crude Pre-heater E-101'],
          processVariables: [
            { name: 'E-101 Delta T', value: 'lower than design', unit: 'C' },
            { name: 'E-101 Pressure Drop', value: 'higher than normal', unit: 'bar' }
          ],
          detectedFailureModeIds: ['heat-exchanger-fouling']
        }
      },
      {
        id: 'test-compressor-fail',
        name: 'Compressor Failure Scenarios',
        description: 'Test RCA for compressor surge conditions.',
        observations: {
          equipmentInvolved: ['Wet Gas Compressor K-201'],
          symptom: 'Loud banging noises from compressor, fluctuating discharge pressure.',
          detectedFailureModeIds: ['compressor-surge']
        }
      },
      {
        id: 'test-multiple-failures',
        name: 'Multiple Simultaneous Failures',
        description: 'Test RCA with symptoms indicating both CUI and valve sticking.',
        observations: {
          symptom: 'Erratic temperature control in distillation column T-100, visible rust stains near insulated lines.',
          detectedFailureModeIds: ['corrosion-under-insulation', 'control-valve-sticking']
        },
        expectedRootCauses: [
            'Interaction between heat exchanger fouling (increased backpressure) and compressor surge.', // This is an example, should be CUI and valve sticking
            'Process fluid contamination', // from valve sticking
            'Water ingress' // from CUI
        ]
      }
    ];
    return of(scenarios).pipe(delay(200));
  }
}
