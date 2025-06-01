import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { 
  FailureMode, 
  RcaObservationInput, 
  RcaResult, 
  RecommendedSolution, // Kept for MOCK_FAILURE_MODES type
  RcaFactor,         // Kept for MOCK_FAILURE_MODES type
  RcaTestScenario,
  FrontendFailureMode, // Added
  FrontendRcaFactor,   // Added
  FrontendRecommendedSolution // Added
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
    // These arrays now align with FrontendFailureMode, FrontendRcaFactor, FrontendRecommendedSolution
    let failureModesForRcaResult: FrontendFailureMode[] = []; // Renamed from potentialFailureModes for clarity

    let overallConfidence = 0.75; // Default confidence, matches RcaResult.overallConfidence
    let summaryText = "Based on the provided symptoms and process variables:"; // Matches RcaResult.summary

    // Simple mock logic: if specific failure modes are detected, use their data.
    if (input.detectedFailureModeIds && input.detectedFailureModeIds.length > 0) {
      input.detectedFailureModeIds.forEach(id => {
        const fm = MOCK_FAILURE_MODES.find(m => m.id === id);
        if (fm) {
          // Transform fm (FailureMode) to FrontendFailureMode
          const frontendFm: FrontendFailureMode = {
            mode: fm.name,
            description: fm.description,
            potentialCauses: fm.typicalCauses.map(tc => ({ factor: tc.description, likelihood: 0.7, evidence: ['Symptom reported'] })),
            recommendedSolutions: fm.potentialSolutions.map(ps => ({ solution: ps.description, estimatedImpact: ps.estimatedEffectiveness || 'Medium', confidence: 0.8 }))
          };
          failureModesForRcaResult.push(frontendFm);
          summaryText += `\n- Considered ${fm.name}.`;
        }
      });
    }

    // Mock logic for high sulfur content detection
    if (input.symptom?.toLowerCase().includes('sulfur') || input.processVariables?.some(pv => pv.name.toLowerCase().includes('sulfur') && parseFloat(pv.value) > 0.02)) {
        const catalystDeac = MOCK_FAILURE_MODES.find(fm => fm.id === 'catalyst-deactivation');
        if (catalystDeac && !failureModesForRcaResult.find(ffm => ffm.mode === catalystDeac.name)) {
            const frontendFm: FrontendFailureMode = {
              mode: catalystDeac.name,
              description: catalystDeac.description,
              potentialCauses: [
                { factor: 'High sulfur content in feed leading to catalyst poisoning.', likelihood: 0.85, evidence: ['High sulfur detected'] },
                ...catalystDeac.typicalCauses.map(tc => ({ factor: tc.description, likelihood: 0.6, evidence: ['General knowledge'] }))
              ],
              recommendedSolutions: catalystDeac.potentialSolutions.map(ps => ({ solution: ps.description, estimatedImpact: ps.estimatedEffectiveness || 'Medium', confidence: 0.75 }))
            };
            failureModesForRcaResult.push(frontendFm);
            summaryText += `\n- High sulfur content detected, potentially impacting catalyst.`;
            overallConfidence = 0.85;
        }
    }

    // Mock logic for multiple simultaneous failures (example: Heat Exchanger + Compressor)
    if (input.detectedFailureModeIds?.includes('heat-exchanger-fouling') && input.detectedFailureModeIds?.includes('compressor-surge')) {
        // Add a specific note to summary, actual failure modes already added if IDs were present
        summaryText += `\n- Detected potential interaction between heat exchanger fouling and compressor surge.`;
        overallConfidence = 0.90;
        // We could also add a new "Interaction" failure mode if desired
    }


    // Fallback if no specific modes identified but symptoms exist
    if (failureModesForRcaResult.length === 0 && input.symptom) {
      summaryText += '\n- General symptom analysis suggests potential operational issues. More specific data needed for precise RCA.';
      // Add a generic failure mode
      const genericFm: FrontendFailureMode = {
        mode: 'Undefined Operational Anomaly',
        description: 'Operational issues suspected based on general symptoms.',
        potentialCauses: [{ factor: 'Undefined operational anomaly based on symptoms.', likelihood: 0.5, evidence: [input.symptom] }],
        recommendedSolutions: [{ solution: 'Conduct thorough operational review and data gathering.', estimatedImpact: 'Medium', confidence: 0.6 }]
      };
      failureModesForRcaResult.push(genericFm);
    }

    // Ensure unique failure modes by mode name
    failureModesForRcaResult = [...new Map(failureModesForRcaResult.map(item => [item.mode, item])).values()];

    const result: RcaResult = {
      analyzedNodeId: input.equipmentInvolved && input.equipmentInvolved.length > 0 ? input.equipmentInvolved.join(', ') : 'System', // Use equipment or a generic ID
      summary: summaryText,
      failureModes: failureModesForRcaResult,
      overallConfidence: overallConfidence,
      timestamp: new Date().toISOString()
      // identifiedRootCauses and recommendedSolutions are now part of each failureMode
      // confidenceScore renamed to overallConfidence
      // analysisDetails renamed to summary
    };

    return of(result).pipe(delay(1500)); // Simulate complex analysis time
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
