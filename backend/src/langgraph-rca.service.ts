import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, StateGraphArgs, END, START, CompiledStateGraph } from "@langchain/langgraph";
import { RunnableLambda, RunnableConfig } from "@langchain/core/runnables";
import { HumanMessage } from "@langchain/core/messages";
import * as fs from 'fs';
import * as path from 'path';

// --- Interfaces for Graph Data (mirroring frontend) ---
interface GraphNode {
  id: string;
  label: string;
  properties?: Record<string, any>;
  type?: string;
}

interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  properties?: Record<string, any>;
}

// --- Interfaces for RCA Request and Result (mirroring frontend rca.models.ts) ---
export interface RcaRequest {
  selectedNode: GraphNode;
  adjacentNodes: GraphNode[];
  connectingEdges: GraphEdge[];
}

// Add new interfaces matching the updated LLM prompt's JSON output:
export interface SulfurAssessment {
  assessment_details: string;
  mitigation_options: string[];
}

export interface ProcessEvaluation {
  evaluation_details: string;
  optimization_suggestions: string[];
}

// New detailed interfaces for factors and strategies
export interface ContributingFactor {
  factor_id: string;
  factor_description: string;
  likelihood: number; // Assuming LLM provides number, adjust if string
  evidence_sources: string[];
  impact_on_failure_mode: string;
}

export interface MitigationStrategy {
  strategy_id: string;
  strategy_description: string;
  effectiveness_score: number; // Assuming LLM provides number
  estimated_cost_category: string; // e.g., "Low", "Medium", "High"
  implementation_priority?: string; // Optional: "High", "Medium", "Low"
}

export interface IdentifiedFailureMode {
  failure_mode_id: string; // This was mode_id in the prompt, aligning here
  description: string; // This was mode_name + description in the prompt, simplifying
  likelihood: string; // This was likelihood_score in the prompt
  severity: string; // This was severity_score in the prompt
  contributing_factors: ContributingFactor[]; // Changed from string[]
  mitigation_strategies: MitigationStrategy[]; // Changed from string[]
}

export interface RootCauseAnalysis {
  methodology_description: string;
  identified_failure_modes: IdentifiedFailureMode[];
  underlying_causes: string[];
}

export interface ImmediateAction {
  action_id: string;
  description: string;
  priority: string;
  responsible_party: string;
  timeline: string;
}

export interface Recommendation {
  recommendation_id: string;
  description: string;
  expected_impact: string;
  estimated_cost: string;
  priority: string;
}

export interface PerformancePrediction {
  scenario_description: string;
  predicted_outcome: string;
  confidence_level: string;
}

export interface RegulatoryCompliance {
  compliance_status: string;
  relevant_regulations: string[];
  corrective_actions_needed: string[];
}

export interface DataConfidence {
  overall_confidence_score: string;
  confidence_assessment_details: string;
  data_gaps: string[];
}

// Updated RcaResult interface
export interface RcaResult {
  analysis_id: string;
  analyzed_node_id: string;
  analysis_summary: string;
  sulfur_assessment: SulfurAssessment;
  process_evaluation: ProcessEvaluation;
  root_cause_analysis: RootCauseAnalysis;
  immediate_actions: ImmediateAction[];
  recommendations: Recommendation[];
  performance_predictions: PerformancePrediction;
  regulatory_compliance: RegulatoryCompliance;
  data_confidence: DataConfidence;
}

// --- Domain Specific Knowledge Interfaces ---
interface FailureModePattern {
  name: string;
  description: string;
  symptoms: string[];
  contributingFactors: string[];
  mitigationSteps: string[];
}

interface SulfurMonitoringDetail {
  parameter: string;
  normalRange: string;
  deviationImpact: string;
}

interface Checkpoint {
  id: string;
  description: string;
  expectedOutcome: string;
  failureImplication: string;
}

interface ComponentKnowledge {
  componentType: string;
  commonFailureModes: FailureModePattern[];
  sulfurMonitoring?: SulfurMonitoringDetail[];
  criticalCheckpoints?: Checkpoint[];
}

interface DomainKnowledge {
  components: ComponentKnowledge[];
}

// --- Updated State for our graph ---
interface RcaState {
  rcaRequestContext?: RcaRequest;
  rcaResult?: RcaResult;
  error?: string;
}

let domainKnowledge: DomainKnowledge = { components: [] };

function loadDomainKnowledge(): void {
  try {
    const filePath = path.join(__dirname, 'domainKnowledge.json');
    console.log(`[DomainKnowledge] Attempting to load domain knowledge from: ${filePath}`);
    if (fs.existsSync(filePath)) {
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      domainKnowledge = JSON.parse(fileContent) as DomainKnowledge;
      console.log("[DomainKnowledge] Successfully loaded and parsed domainKnowledge.json.");
      if (!domainKnowledge || !domainKnowledge.components || domainKnowledge.components.length === 0) {
        console.warn("[DomainKnowledge] domainKnowledge.json loaded but is empty or not in expected format.");
      } else {
        console.log(`[DomainKnowledge] Loaded knowledge for ${domainKnowledge.components.length} component types.`);
      }
    } else {
      console.warn(`[DomainKnowledge] domainKnowledge.json not found at ${filePath}. Proceeding without domain-specific knowledge enhancements.`);
      domainKnowledge = { components: [] }; // Ensure it's initialized
    }
  } catch (error: any) {
    console.error("[DomainKnowledge] Error loading or parsing domainKnowledge.json:", error.message);
    domainKnowledge = { components: [] }; // Fallback to empty knowledge
  }
}

loadDomainKnowledge(); // Load knowledge when the service module is loaded

console.log("[DEBUG] langgraph-rca.service.ts - Before ChatOpenAI initialization attempt:");
console.log("[DEBUG] AZURE_OPENAI_API_KEY:", process.env.AZURE_OPENAI_API_KEY ? 'Loaded' : 'NOT LOADED');
console.log("[DEBUG] AZURE_OPENAI_ENDPOINT:", process.env.AZURE_OPENAI_ENDPOINT ? 'Loaded' : 'NOT LOADED');
console.log("[DEBUG] AZURE_OPENAI_DEPLOYMENT_NAME:", process.env.AZURE_OPENAI_DEPLOYMENT_NAME ? 'Loaded' : 'NOT LOADED');
console.log("[DEBUG] AZURE_OPENAI_API_VERSION:", process.env.AZURE_OPENAI_API_VERSION ? 'Loaded' : 'NOT LOADED');
console.log("[DEBUG] OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? 'Loaded' : 'NOT LOADED');
console.log("[DEBUG] OPENAI_MODEL_NAME from env:", process.env.OPENAI_MODEL_NAME);

const azureApiKey = process.env.AZURE_OPENAI_API_KEY;
const azureEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
const azureDeploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
const azureApiVersion = process.env.AZURE_OPENAI_API_VERSION;
const standardOpenAIApiKey = process.env.OPENAI_API_KEY;
const standardOpenAIModelName = process.env.OPENAI_MODEL_NAME || "gpt-4o";

let llm: ChatOpenAI;

if (azureApiKey && azureEndpoint && azureDeploymentName && azureApiVersion) {
  let instanceName;
  try {
    const url = new URL(azureEndpoint);
    instanceName = url.hostname.split('.')[0];
    if (!instanceName) {
      throw new Error("Could not extract instance name from Azure endpoint hostname.");
    }
  } catch (e: any) {
    console.error("[ERROR] Failed to parse AZURE_OPENAI_ENDPOINT to extract instance name. Ensure it's a valid URL (e.g., https://your-instance.openai.azure.com/). Error:", e.message);
    throw new Error(`Azure OpenAI Instance Name could not be derived from AZURE_OPENAI_ENDPOINT: ${azureEndpoint}. Please check its format.`);
  }

  console.log(`[DEBUG] langgraph-rca.service.ts - Initializing ChatOpenAI with explicit Azure parameters:`);
  console.log(`[DEBUG]   azureOpenAIApiKey: ${azureApiKey ? 'Set' : 'Not Set'}`);
  console.log(`[DEBUG]   azureOpenAIApiDeploymentName: ${azureDeploymentName}`);
  console.log(`[DEBUG]   azureOpenAIApiInstanceName: ${instanceName}`);
  console.log(`[DEBUG]   azureOpenAIApiVersion: ${azureApiVersion}`);
  console.log(`[DEBUG]   modelName (set to deploymentName for Azure): ${azureDeploymentName}`);

  llm = new ChatOpenAI({
    temperature: 0,
    modelName: azureDeploymentName, 
    azureOpenAIApiKey: azureApiKey,
    azureOpenAIApiDeploymentName: azureDeploymentName,
    azureOpenAIApiInstanceName: instanceName,
    azureOpenAIApiVersion: azureApiVersion,
  });
  console.log("[INFO] ChatOpenAI client initialized with Azure configuration.");

} else if (standardOpenAIApiKey) {
  console.log("[DEBUG] langgraph-rca.service.ts - Initializing ChatOpenAI with standard OpenAI API key.");
  llm = new ChatOpenAI({
    temperature: 0,
    modelName: standardOpenAIModelName,
    apiKey: standardOpenAIApiKey,
  });
  console.log("[INFO] ChatOpenAI client initialized with standard OpenAI configuration.");
} else {
  console.error("[ERROR] langgraph-rca.service.ts - Critical OpenAI API configuration missing. Neither Azure nor standard OpenAI environment variables are sufficiently set.");
  throw new Error("OpenAI API keys/configuration (Azure or Standard) not found or incomplete. Cannot initialize LLM.");
}

// --- Helper functions for Domain Knowledge ---
function findComponentKnowledge(nodeType?: string): ComponentKnowledge | undefined {
  if (!nodeType || !domainKnowledge || !domainKnowledge.components) {
    return undefined;
  }
  return domainKnowledge.components.find(c => c.componentType.toLowerCase() === nodeType.toLowerCase());
}

function formatSulfurMonitoringForPrompt(sulfurMonitoring?: SulfurMonitoringDetail[]): string {
  if (!sulfurMonitoring || sulfurMonitoring.length === 0) {
    return "  - No specific sulfur monitoring details provided for this component type.";
  }
  return sulfurMonitoring.map(s =>
    `    - Parameter: ${s.parameter}, Normal Range: ${s.normalRange}, Deviation Impact: ${s.deviationImpact}`
  ).join('\n');
}

function formatCriticalCheckpointsForPrompt(checkpoints?: Checkpoint[]): string {
    if (!checkpoints || checkpoints.length === 0) {
        return "  - No critical checkpoints provided for this component type.";
    }
    return checkpoints.map(c =>
        `    - Checkpoint ID: ${c.id}\n` +
        `      Description: ${c.description}\n` +
        `      Expected Outcome: ${c.expectedOutcome}\n` +
        `      Failure Implication: ${c.failureImplication}`
    ).join('\n\n');
}

// Node functions
async function initializeRcaContext(state: RcaState, config?: RunnableConfig): Promise<Partial<RcaState>> {
  if (!state.rcaRequestContext) {
    console.error("[RCA Graph] Error: RCA Request context is missing in the initial state.");
    return { error: "RCA Request context is missing." };
  }
  console.log(`[RCA Graph] Initializing RCA context for node: ${state.rcaRequestContext.selectedNode.label}`);
  // The rcaRequestContext is already in the state, passed via invoke.
  // No further action needed here other than logging or initial validation if desired.
  return { rcaRequestContext: state.rcaRequestContext };
}

async function analyzeData(state: RcaState, config?: RunnableConfig): Promise<Partial<RcaState>> {
  if (!state.rcaRequestContext || !state.rcaRequestContext.selectedNode) {
    console.error("[RCA Graph] Error: RCA Request context or selected node is missing for analysis.");
    return { error: "RCA Request context or selected node is missing for analysis." };
  }
  console.log("[RCA Graph] Analyzing data for node:", state.rcaRequestContext.selectedNode.label);

  const { selectedNode, adjacentNodes, connectingEdges } = state.rcaRequestContext;

  const componentType = selectedNode.type;
  const relevantKnowledge = findComponentKnowledge(componentType);
  let domainKnowledgePromptSection = `  No specific domain knowledge found for component type "${componentType || 'N/A'}".`;

  if (relevantKnowledge) {
    domainKnowledgePromptSection = `  Relevant Domain Knowledge for Component Type "${relevantKnowledge.componentType}":\n`;
    if (relevantKnowledge.commonFailureModes && relevantKnowledge.commonFailureModes.length > 0) {
      domainKnowledgePromptSection += "    Common Failure Modes & Patterns:\n";
      relevantKnowledge.commonFailureModes.forEach(fm => {
        domainKnowledgePromptSection += `      - Mode: ${fm.name}\n`;
        domainKnowledgePromptSection += `        Description: ${fm.description}\n`;
        if (fm.symptoms && fm.symptoms.length > 0) {
          domainKnowledgePromptSection += `        Symptoms: ${fm.symptoms.join(', ')}\n`;
        }
        if (fm.contributingFactors && fm.contributingFactors.length > 0) {
          domainKnowledgePromptSection += `        Potential Contributing Factors: ${fm.contributingFactors.join(', ')}\n`;
        }
        if (fm.mitigationSteps && fm.mitigationSteps.length > 0) {
          domainKnowledgePromptSection += `        Typical Mitigation Steps: ${fm.mitigationSteps.join(', ')}\n`;
        }
      });
    } else {
      domainKnowledgePromptSection += "    - No common failure modes listed for this component type.\n";
    }

    if (relevantKnowledge.sulfurMonitoring && relevantKnowledge.sulfurMonitoring.length > 0) {
      domainKnowledgePromptSection += "\n    Sulfur Monitoring Details:\n";
      domainKnowledgePromptSection += formatSulfurMonitoringForPrompt(relevantKnowledge.sulfurMonitoring);
      domainKnowledgePromptSection += "\n";
    } else {
      domainKnowledgePromptSection += "    - No specific sulfur monitoring details provided for this component type.\n";
    }

    if (relevantKnowledge.criticalCheckpoints && relevantKnowledge.criticalCheckpoints.length > 0) {
      domainKnowledgePromptSection += "\n    Critical Checkpoints & Expected Outcomes:\n";
      domainKnowledgePromptSection += formatCriticalCheckpointsForPrompt(relevantKnowledge.criticalCheckpoints);
      domainKnowledgePromptSection += "\n";
    } else {
      domainKnowledgePromptSection += "    - No critical checkpoints provided for this component type.\n";
    }
  }

  const adjacentNodesInfo = adjacentNodes.map(n => `  - Node ID: ${n.id}, Label: ${n.label}, Type: ${n.type || 'N/A'}, Properties: ${JSON.stringify(n.properties)}`).join('\n');
  const connectingEdgesInfo = connectingEdges.map(e => `  - Edge ID: ${e.id}, From: ${e.from}, To: ${e.to}, Label: ${e.label || 'N/A'}, Properties: ${JSON.stringify(e.properties)}`).join('\n');

  const prompt = `
### System Context ###
You are an advanced AI assistant specialized in Root Cause Analysis (RCA) for complex industrial systems, specifically within oil refinery operations. Your primary function is to analyze graph-based data representing components, their states, and interconnections to identify potential failure modes, their underlying causes, and recommend actionable solutions. You must leverage provided domain-specific knowledge about component types, common failures, and operational parameters.

Your output MUST be a single, valid JSON object adhering strictly to the RESPONSE FORMAT defined below. Do not include any explanatory text, comments, or markdown formatting outside of this JSON object.

## RESPONSE FORMAT ##
\`\`\`json
{
  "analysis_id": "string", // Generate a new UUID for each analysis
  "analyzed_node_id": "string", // ID of the node being analyzed
  "analysis_timestamp": "string", // Current UTC timestamp in ISO 8601 format (e.g., "2025-06-03T12:34:56.789Z")
  "analysis_summary": {
    "overall_health_score": "number", // 0.0 (critically unhealthy) to 1.0 (perfectly healthy)
    "key_findings": ["string"], // Concise list of the most important discoveries
    "primary_concern_level": "string" // "Low", "Medium", "High", or "Critical"
  },
  "sulfur_assessment": {
    "relevant_sulfur_params": [
      {
        "parameter_name": "string", // e.g., "H2S in Crude Feed", "Total Sulfur in Product Stream X"
        "current_value": "string", // With units, e.g., "15 ppm", "0.5 wt%"
        "normal_range": "string", // Expected operational range, e.g., "<10 ppm", "0.1-0.3 wt%"
        "deviation_from_norm": "string", // Calculated or observed deviation, e.g., "+5 ppm", "+0.2 wt% (High)"
        "potential_impact_on_node": "string" // Specific impact on the analyzed_node_id (e.g., "Increased corrosion risk for carbon steel components", "Potential catalyst poisoning if node is a reactor")
      }
    ],
    "sulfur_related_observations": ["string"] // General observations about sulfur's role or impact not tied to a specific parameter, or if no specific parameters are in domain knowledge.
  },
  "process_evaluation": {
    "critical_checkpoints_status": [
      {
        "checkpoint_id": "string", // From domain knowledge if available, or a descriptive ID
        "status": "string", // "Pass", "Fail", "Warning", "Not Assessed", "N/A"
        "observation": "string", // Details if status is not "Pass" (e.g., "Temperature reading 15C above limit")
        "implication_for_node": "string" // How this checkpoint status affects the analyzed_node_id (e.g., "Indicates upstream process upset potentially starving node of feed", "Suggests downstream blockage affecting node's output")
      }
    ],
    "operational_anomalies_noted": ["string"] // Other observed operational anomalies relevant to the node (e.g., "Unstable flow rate reported by sensor X", "Intermittent pressure spikes")
  },
  "root_cause_analysis": {
    "identified_failure_modes": [
      {
        "mode_id": "string", // Unique identifier for this failure mode in this analysis (e.g., "FM-001")
        "mode_name": "string", // Clear name of the failure mode (e.g., "Corrosion Under Insulation")
        "description": "string", // Detailed description of the failure mode in context
        "likelihood_score": "number", // 0.0 to 1.0: Overall likelihood of this failure mode occurring/being active
        "severity_score": "number", // 0.0 to 1.0: Potential severity if this failure mode manifests fully
        "contributing_factors": [
          {
            "factor_id": "string", // Unique ID for this factor within this failure mode (e.g., "CF-001-A")
            "factor_description": "string", // Description of the specific cause/contributor
            "likelihood": "number", // 0.0 to 1.0: Likelihood this factor is contributing to THIS failure mode
            "evidence_sources": ["string"], // Specific evidence from input data or domain knowledge (e.g., "Selected Node property: 'last_inspection_CUI': '3 years ago'", "Domain Knowledge: CUI common with insulation damage")
            "impact_on_failure_mode": "string" // How this factor specifically contributes to or exacerbates the failure mode
          }
        ],
        "mitigation_strategies": [ // Added detailed structure for mitigation_strategies
          {
            "strategy_id": "string", // Unique ID for this strategy (e.g., "MS-001-A")
            "strategy_description": "string", // Description of the mitigation strategy
            "effectiveness_score": "number", // 0.0 to 1.0: Estimated effectiveness of this strategy
            "estimated_cost_category": "string", // e.g., "Low", "Medium", "High"
            "implementation_priority": "string" // e.g., "High", "Medium", "Low"
          }
        ]
      }
    ],
    "cross_cutting_concerns": ["string"] // Factors or observations that affect multiple failure modes or the system more broadly (e.g., "General high humidity in the unit", "Recent changes in feedstock quality")
  },
  "immediate_actions": [ // Urgent actions to take based on the analysis
    {
      "action_id": "string", // Unique ID for this action (e.g., "IA-001")
      "description": "string", // Specific, actionable step
      "priority": "string", // "Urgent", "High", "Medium"
      "responsible_team": "string", // e.g., "Maintenance", "Operations", "Inspection"
      "estimated_duration_hours": "number" // Estimated time to complete the action
    }
  ],
  "recommendations": [ // Longer-term or less urgent recommendations
    {
      "recommendation_id": "string", // Unique ID for this recommendation (e.g., "REC-001")
      "recommendation_text": "string", // Detailed recommendation
      "failure_modes_addressed": ["string"], // List of mode_id(s) this recommendation helps mitigate or resolve
      "expected_outcome": "string", // What improvement is expected (e.g., "Reduce CUI risk by 70%", "Extend equipment life by 2 years")
      "confidence_in_outcome": "number", // 0.0 to 1.0
      "implementation_priority": "string", // "High", "Medium", "Low"
      "estimated_cost_category": "string" // e.g., "$ (Low <$1k)", "$$ (Medium $1k-$10k)", "$$$ (High >$10k)"
    }
  ],
  "performance_predictions": {
    "without_intervention": { // Scenario if no actions/recommendations are implemented
      "time_to_escalation_days": "number", // Estimated days until problem worsens significantly or leads to major failure
      "potential_consequences": ["string"] // e.g., "Unplanned unit shutdown", "Safety incident (leak/fire)", "Environmental non-compliance"
    },
    "with_recommendations_implemented": { // Scenario if key recommendations are implemented
      "expected_improvement_metric": "string", // e.g., "Mean Time Between Failures (MTBF) increase by 25%", "Overall health score improvement to 0.8"
      "long_term_outlook": "string" // e.g., "Stable operation for next 12 months", "Reduced likelihood of catastrophic failure"
    }
  },
  "regulatory_compliance": {
    "potential_breaches": [ // Identify any potential regulatory breaches based on findings
      {
        "regulation_id": "string", // e.g., "EPA 40 CFR Part 60 Subpart Ja", "OSHA PSM 29 CFR 1910.119"
        "description_of_potential_breach": "string", // How the current situation might violate the regulation
        "implication": "string" // e.g., "Potential for Notice of Violation (NOV) and fines", "Increased scrutiny from regulatory bodies"
      }
    ],
    "compliance_notes": "string" // General notes on compliance or areas to monitor
  },
  "data_confidence": {
    "overall_confidence_score": "string", // Changed from overall_score (number)
    "confidence_assessment_details": "string", // Added
    "data_gaps": ["string"] // Renamed from factors_affecting_confidence
  }
}
\`\`\`

### Input Parameters for Analysis ###

1.  **Selected Node (Component of Interest):**
    - Node ID: ${selectedNode.id}
    - Label: ${selectedNode.label}
    - Type: ${selectedNode.type || 'N/A'}
    - Properties: ${JSON.stringify(selectedNode.properties)}

2.  **Adjacent Nodes (Connected Components/Environment):**
${adjacentNodesInfo || '    - None'}

3.  **Connecting Edges (Relationships):**
${connectingEdgesInfo || '    - None'}

4.  **Domain-Specific Knowledge for Component Type "${selectedNode.type || 'N/A'}":**
${domainKnowledgePromptSection}

### Required Analysis Framework & Instructions ###
You must meticulously populate every field in the JSON structure defined under "RESPONSE FORMAT".

**General Instructions:**
*   **\`analysis_id\`**: Generate a unique UUID (e.g., using a standard UUID v4 format).
*   **\`analyzed_node_id\`**: Use the ID of the \`selectedNode\` from the input.
*   **\`analysis_timestamp\`**: Provide the current Coordinated Universal Time (UTC) in full ISO 8601 format, including milliseconds if possible (e.g., "YYYY-MM-DDTHH:mm:ss.sssZ").
*   **Be Specific and Actionable**: All descriptions, findings, and recommendations should be clear, concise, and directly relevant to the provided data.
*   **Evidence-Based Reasoning**: Base your analysis on the provided "Input Parameters for Analysis" and "Domain-Specific Knowledge". Explicitly reference evidence in the \`evidence_sources\` fields.
*   **Quantitative where possible**: Use scores (0.0-1.0) for likelihoods, severities, and confidences as defined.

**Field-Specific Instructions:**

*   **\`analysis_summary\`**:
    *   \`overall_health_score\`: Synthesize all findings into a single score representing the current health of the \`analyzed_node_id\`. 1.0 is perfect health, 0.0 is critical failure.
    *   \`key_findings\`: List the 3-5 most critical insights from your entire analysis.
    *   \`primary_concern_level\`: Categorize the urgency based on your findings.

*   **\`sulfur_assessment\`**:
    *   If \`domainKnowledgePromptSection\` contains "Sulfur Monitoring Details", use that to populate \`relevant_sulfur_params\`.
    *   For each parameter, detail its \`current_value\` (infer if not directly given but related data exists), \`normal_range\`, calculate \`deviation_from_norm\`, and critically, explain its \`potential_impact_on_node\`.
    *   If no specific sulfur parameters are in domain knowledge, \`relevant_sulfur_params\` can be an empty array.
    *   \`sulfur_related_observations\`: Add any general insights about sulfur's role, especially if it's a known issue in the process (e.g., "Sour service environment known to affect this unit").

*   **\`process_evaluation\`**:
    *   If \`domainKnowledgePromptSection\` contains "Critical Checkpoints", use that to populate \`critical_checkpoints_status\`.
    *   For each checkpoint, determine its \`status\` based on available data (or "Not Assessed" if no data). Provide \`observation\` details for non-"Pass" statuses and explain the \`implication_for_node\`.
    *   If no checkpoints are in domain knowledge, \`critical_checkpoints_status\` can be an empty array.
    *   \`operational_anomalies_noted\`: List any other process deviations from the input data that could affect the node.

*   **\`root_cause_analysis\`**:
    *   \`identified_failure_modes\`:
        *   Identify 1 to 3 primary failure modes based on evidence.
        *   \`mode_id\`: Create a simple unique ID like "FM-001", "FM-002".
        *   \`likelihood_score\`: Your assessed probability that this failure mode is active or imminent.
        *   \`severity_score\`: The potential impact if this failure mode occurs (e.g., safety, environmental, production loss).
        *   \`contributing_factors\`: For each failure mode, list specific factors.
            *   \`factor_id\`: Create a simple unique ID like "CF-001-A", "CF-001-B".
            *   \`likelihood\`: How likely this specific factor contributes to *this* failure mode.
            *   \`evidence_sources\`: Pinpoint the data (e.g., "selectedNode.properties.operating_temp: 160C", "adjacentNodes[0].properties.state: Damaged", "domainKnowledge.commonFailureModes[0].symptoms[0]").
            *   \`impact_on_failure_mode\`: Explain the mechanism of contribution.
    *   \`cross_cutting_concerns\`: Note any systemic issues or factors that influence multiple identified failure modes or the overall health of the system around the node.

*   **\`immediate_actions\`**:
    *   List urgent, concrete steps to mitigate high risks or gather critical information.
    *   \`action_id\`: Create a simple unique ID like "IA-001".
    *   Assign \`priority\`, \`responsible_team\`, and \`estimated_duration_hours\`.

*   **\`recommendations\`**:
    *   Propose longer-term solutions or preventative measures.
    *   \`recommendation_id\`: Create a simple unique ID like "REC-001".
    *   \`failure_modes_addressed\`: Link to \`mode_id\`(s) that this recommendation targets.
    *   Estimate \`confidence_in_outcome\`, \`implementation_priority\`, and \`estimated_cost_category\`.

*   **\`performance_predictions\`**:
    *   \`without_intervention\`: Project the negative trajectory if issues are ignored.
    *   \`with_recommendations_implemented\`: Project the positive outcomes if key recommendations are followed.

*   **\`regulatory_compliance\`**:
    *   Consider if any findings suggest potential non-compliance with common refinery regulations (environmental, safety).
    *   If so, list them in \`potential_breaches\` with \`regulation_id\` (e.g., "API RP 570" for piping inspection, "EPA Clean Air Act") and implications.
    *   \`compliance_notes\`: Add general observations or areas for compliance review.

*   **\`data_confidence\`**:
    *   \`overall_confidence_score\`: Your assessment (as a string representing a number, e.g., "0.75") of how much the available data allows for a robust analysis.
    *   \`confidence_assessment_details\`: Provide a brief textual justification for the overall confidence score.
    *   \`data_gaps\`: List any specific missing pieces of information or data gaps that affect the confidence (e.g., "Missing sensor data for parameter X", "Recent maintenance logs unavailable").

### Few-Shot Examples (Illustrative - Adhere to the RESPONSE FORMAT for your actual output) ###

**Example 1: Pipe Corrosion**
*Input Context Snippet (for context only, not part of your output):* Selected Node: Pipe P-102 (Carbon Steel), ID: "node-p102", Type: "Pipe", Properties: { "operating_temp": "160C", "fluid_type": "Sour Gas Condensate", "last_inspection_CUI": "3 years ago", "material": "Carbon Steel", "diameter": "6 inch" }. Adjacent: Insulation I-102, ID: "node-i102", Type: "Insulation", Properties: { "condition": "Damaged", "material": "Calcium Silicate" }. Domain Knowledge for "Pipe": Common failure mode "Corrosion Under Insulation (CUI)" with symptoms like "localized pitting", "metal loss", contributing factors "moisture ingress", "high temperature", "corrosive environment". Sulfur Monitoring: H2S in Sour Gas: Normal <50ppm. Critical Checkpoints: Regular CUI inspection schedule (every 2 years for high-risk).
*Expected JSON Output (This is a complete example of the JSON you should generate):*
\`\`\`json
{
  "analysis_id": "a1b2c3d4-e5f6-7890-1234-567890abcdef",
  "analyzed_node_id": "node-p102",
  "analysis_timestamp": "2025-06-03T10:00:00Z",
  "analysis_summary": {
    "overall_health_score": 0.4,
    "key_findings": [
      "High risk of active Corrosion Under Insulation (CUI) on Pipe P-102.",
      "Damaged insulation (I-102) is a primary contributor.",
      "CUI inspection is overdue based on domain knowledge guidelines."
    ],
    "primary_concern_level": "High"
  },
  "sulfur_assessment": {
    "relevant_sulfur_params": [
      {
        "parameter_name": "H2S in Sour Gas Condensate",
        "current_value": "Not specified, assumed present due to 'Sour Gas Condensate'",
        "normal_range": "<50ppm (from domain knowledge)",
        "deviation_from_norm": "Unknown, but fluid type implies H2S presence",
        "potential_impact_on_node": "Contributes to corrosive environment, exacerbating CUI if moisture is present."
      }
    ],
    "sulfur_related_observations": ["The fluid 'Sour Gas Condensate' inherently implies a sulfurous, corrosive environment."]
  },
  "process_evaluation": {
    "critical_checkpoints_status": [
      {
        "checkpoint_id": "CUI-INSP-SCHED",
        "status": "Fail",
        "observation": "Last CUI inspection was 3 years ago; domain knowledge suggests every 2 years for high-risk carbon steel pipes in this service.",
        "implication_for_node": "Increased likelihood of undetected CUI progression on P-102."
      }
    ],
    "operational_anomalies_noted": ["None explicitly stated beyond overdue inspection and insulation damage."]
  },
  "root_cause_analysis": {
    "identified_failure_modes": [
      {
        "mode_id": "FM-001",
        "mode_name": "Corrosion Under Insulation (CUI)",
        "description": "Localized corrosion on the external surface of carbon steel pipe P-102 beneath damaged insulation, accelerated by high temperature and corrosive condensate.",
        "likelihood_score": 0.85,
        "severity_score": 0.75,
        "contributing_factors": [
          {
            "factor_id": "CF-001-A",
            "factor_description": "Moisture ingress due to damaged insulation I-102.",
            "likelihood": 0.9,
            "evidence_sources": ["Adjacent node I-102 property: condition: Damaged", "Domain knowledge: CUI common with insulation damage"],
            "impact_on_failure_mode": "Provides electrolyte and corrosive species access to pipe surface."
          },
          {
            "factor_id": "CF-001-B",
            "factor_description": "Elevated operating temperature (160C) accelerating corrosion rates.",
            "likelihood": 0.75,
            "evidence_sources": ["Selected Node P-102 property: operating_temp: 160C"],
            "impact_on_failure_mode": "Increases kinetic rate of corrosion reactions."
          },
          {
            "factor_id": "CF-001-C",
            "factor_description": "Presence of corrosive Sour Gas Condensate.",
            "likelihood": 0.7,
            "evidence_sources": ["Selected Node P-102 property: fluid_type: Sour Gas Condensate"],
            "impact_on_failure_mode": "Provides corrosive agents (e.g., H2S, CO2, chlorides)."
          },
          {
            "factor_id": "CF-001-D",
            "factor_description": "Overdue CUI inspection.",
            "likelihood": 0.6,
            "evidence_sources": ["Selected Node P-102 property: last_inspection_CUI: 3 years ago", "Domain Knowledge: CUI inspection schedule 2 years"],
            "impact_on_failure_mode": "Allows potential corrosion to proceed undetected and unmitigated."
          }
        ],
        "mitigation_strategies": [
          {
            "strategy_id": "MS-001-A",
            "strategy_description": "Repair or replace damaged insulation I-102.",
            "effectiveness_score": 0.9,
            "estimated_cost_category": "Medium",
            "implementation_priority": "High"
          }
        ]
      }
    ],
    "cross_cutting_concerns": ["Potential systemic issue with insulation maintenance program if I-102 damage is not an isolated case."]
  },
  "immediate_actions": [
    {
      "action_id": "IA-001",
      "description": "Visually inspect accessible areas of Pipe P-102 near damaged insulation I-102 for signs of corrosion or leaks. Secure area if leak detected.",
      "priority": "Urgent",
      "responsible_team": "Operations / Inspection",
      "estimated_duration_hours": 2
    },
    {
      "action_id": "IA-002",
      "description": "Schedule non-destructive testing (e.g., UT, Pulsed Eddy Current) for Pipe P-102, focusing on areas under insulation I-102.",
      "priority": "High",
      "responsible_team": "Inspection / NDT Team",
      "estimated_duration_hours": 8
    }
  ],
  "recommendations": [
    {
      "recommendation_id": "REC-001",
      "recommendation_text": "Repair or replace damaged insulation I-102 after pipe surface assessment. Ensure proper sealing.",
      "failure_modes_addressed": ["FM-001"],
      "expected_outcome": "Eliminates moisture ingress path, significantly reducing CUI risk.",
      "confidence_in_outcome": 0.95,
      "implementation_priority": "High",
      "estimated_cost_category": "$$ (Medium $1k-$10k)"
    },
    {
      "recommendation_id": "REC-002",
      "recommendation_text": "Update CUI inspection schedule for P-102 to align with risk-based assessment (e.g., every 2 years or less based on findings).",
      "failure_modes_addressed": ["FM-001"],
      "expected_outcome": "Improves long-term integrity management and early detection of CUI.",
      "confidence_in_outcome": 0.9,
      "implementation_priority": "Medium",
      "estimated_cost_category": "$ (Low <$1k)"
    }
  ],
  "performance_predictions": {
    "without_intervention": {
      "time_to_escalation_days": 90,
      "potential_consequences": ["Through-wall leak leading to product release", "Potential for fire if flammable fluid", "Unplanned shutdown of associated unit."]
    },
    "with_recommendations_implemented": {
      "expected_improvement_metric": "CUI risk reduced by >80%; Pipe P-102 health score improved to >0.8.",
      "long_term_outlook": "Extended safe operational life of P-102, compliance with inspection best practices."
    }
  },
  "regulatory_compliance": {
    "potential_breaches": [
      {
        "regulation_id": "API RP 570 / Internal Piping Integrity Standard",
        "description_of_potential_breach": "Failure to adhere to prescribed inspection intervals for high-risk piping.",
        "implication": "Increased risk of failure, potential audit finding, non-conformance with industry best practices."
      }
    ],
    "compliance_notes": "Ensure CUI program aligns with API RP 583 (Corrosion Under Insulation and Fireproofing)."
  },
  "data_confidence": {
    "overall_confidence_score": "0.75",
    "confidence_assessment_details": "Confidence is good due to clear insulation damage and defined operating conditions, but lack of current H2S measurement slightly reduces it.",
    "data_gaps": [
      "Lack of current H2S measurement for Sour Gas Condensate (assumed based on fluid type)."
    ]
  }
}
\`\`\`

**Example 2: Pump Seal Failure**
*Input Context Snippet (for context only, not part of your output):* Selected Node: Pump P-301 (Centrifugal), ID: "node-p301", Type: "Pump", Properties: { "vibration_pkpk": "8 mm/s", "seal_leakage_rate": "5 ml/min", "operating_hours": "6500", "fluid_pumped": "Lean Amine", "suction_pressure": "2 barg", "discharge_pressure": "10 barg" }. Adjacent: Motor M-301, ID: "node-m301", Type: "Motor", Properties: { "power_draw_kw": "75", "bearing_temp_avg": "65C" }. Domain Knowledge for "Pump": Common failure mode "Mechanical Seal Failure" with symptoms "increased vibration", "visible leakage", "reduced performance". Contributing factors: "seal wear", "misalignment", "bearing failure", "process upsets". Sulfur Monitoring: Not directly applicable to pump mechanicals unless fluid is highly corrosive and unbuffered. Critical Checkpoints: Vibration monitoring limits (e.g., < 5 mm/s pk-pk for good, > 7 mm/s for alarm). Seal flush system operational.
*Expected JSON Output (This is a complete example of the JSON you should generate):*
\`\`\`json
{
  "analysis_id": "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
  "analyzed_node_id": "node-p301",
  "analysis_timestamp": "2025-06-03T10:05:00Z",
  "analysis_summary": {
    "overall_health_score": 0.3,
    "key_findings": [
      "Active mechanical seal failure on Pump P-301, evidenced by high vibration and leakage.",
      "Extended operating hours and high vibration are key contributors.",
      "Potential for imminent pump seizure or major leak if not addressed."
    ],
    "primary_concern_level": "Critical"
  },
  "sulfur_assessment": {
    "relevant_sulfur_params": [],
    "sulfur_related_observations": ["Lean Amine fluid is generally not considered highly sulfurous in a way that directly attacks typical seal materials, but contamination could alter corrosivity. No specific sulfur data provided."]
  },
  "process_evaluation": {
    "critical_checkpoints_status": [
      {
        "checkpoint_id": "VIB-P301-ALARM",
        "status": "Fail",
        "observation": "Vibration at 8 mm/s pk-pk exceeds typical alarm limit of 7 mm/s.",
        "implication_for_node": "Indicates severe mechanical distress, likely originating from or exacerbating seal failure."
      },
      {
        "checkpoint_id": "SEAL-FLUSH-P301",
        "status": "Not Assessed",
        "observation": "No data provided on seal flush system condition or operation.",
        "implication_for_node": "If seal flush is malfunctioning, it could be a primary cause of seal failure."
      }
    ],
    "operational_anomalies_noted": ["Seal leakage rate of 5 ml/min is indicative of failure."]
  },
  "root_cause_analysis": {
    "identified_failure_modes": [
      {
        "mode_id": "FM-001",
        "mode_name": "Mechanical Seal Failure",
        "description": "Deterioration and leakage of the mechanical seal in centrifugal pump P-301, leading to excessive vibration and loss of process fluid.",
        "likelihood_score": 0.95,
        "severity_score": 0.85,
        "contributing_factors": [
          {
            "factor_id": "CF-001-A",
            "factor_description": "Normal wear and tear of seal faces after 6500 operating hours.",
            "likelihood": 0.8,
            "evidence_sources": ["Selected Node P-301 property: operating_hours: 6500", "Domain knowledge: mechanical seals have finite operational life"],
            "impact_on_failure_mode": "Gradual degradation of seal mating surfaces leading to leakage path."
          },
          {
            "factor_id": "CF-001-B",
            "factor_description": "High vibration (8 mm/s pk-pk) accelerating seal wear and potentially causing seal face fretting or opening.",
            "likelihood": 0.9,
            "evidence_sources": ["Selected Node P-301 property: vibration_pkpk: 8 mm/s", "Domain knowledge: high vibration is detrimental to seal life"],
            "impact_on_failure_mode": "Induces dynamic loads and movement at seal faces, compromising sealing integrity."
          },
          {
            "factor_id": "CF-001-C",
            "factor_description": "Potential issues with seal flush system (e.g., inadequate flow, pressure, or contamination).",
            "likelihood": 0.5,
            "evidence_sources": ["Checkpoint 'SEAL-FLUSH-P301' status: Not Assessed", "General knowledge: seal flush is critical for seal environment control"],
            "impact_on_failure_mode": "Lack of proper lubrication, cooling, or cleaning of seal faces can lead to premature failure."
          }
        ],
        "mitigation_strategies": [
          {
            "strategy_id": "MS-001-A",
            "strategy_description": "Replace mechanical seal on Pump P-301.",
            "effectiveness_score": 0.95,
            "estimated_cost_category": "High",
            "implementation_priority": "High"
          }
        ]
      },
      {
        "mode_id": "FM-002",
        "mode_name": "Pump Bearing Degradation (contributing to vibration)",
        "description": "Potential wear or damage to pump bearings, contributing to the observed high vibration levels which in turn damage the seal.",
        "likelihood_score": 0.6,
        "severity_score": 0.7,
        "contributing_factors": [
           {
            "factor_id": "CF-002-A",
            "factor_description": "High vibration itself could be indicative of bearing issues, not just a consequence of seal failure.",
            "likelihood": 0.7,
            "evidence_sources": ["Selected Node P-301 property: vibration_pkpk: 8 mm/s"],
            "impact_on_failure_mode": "Worn bearings cause shaft deflection and instability, leading to seal damage and overall pump vibration."
          },
          {
            "factor_id": "CF-002-B",
            "factor_description": "Extended operating hours (6500) also contribute to bearing wear.",
            "likelihood": 0.6,
            "evidence_sources": ["Selected Node P-301 property: operating_hours: 6500"],
            "impact_on_failure_mode": "Bearings have a finite life, and wear accumulates over time."
          }
        ],
        "mitigation_strategies": [
          {
            "strategy_id": "MS-002-A",
            "strategy_description": "Inspect and replace worn bearings on Pump P-301.",
            "effectiveness_score": 0.9,
            "estimated_cost_category": "High",
            "implementation_priority": "High"
          }
        ]
      }
    ],
    "cross_cutting_concerns": ["The high vibration is a major concern that could be both a cause and effect of seal failure, and potentially indicative of other issues like misalignment or bearing wear."]
  },
  "immediate_actions": [
    {
      "action_id": "IA-001",
      "description": "Isolate and lockout Pump P-301 for immediate inspection and repair. Prepare for seal replacement.",
      "priority": "Urgent",
      "responsible_team": "Operations / Maintenance",
      "estimated_duration_hours": 4
    },
    {
      "action_id": "IA-002",
      "description": "Inspect seal flush system for proper operation (flow, pressure, cleanliness) once pump is safely isolated.",
      "priority": "High",
      "responsible_team": "Maintenance",
      "estimated_duration_hours": 1
    }
  ],
  "recommendations": [
    {
      "recommendation_id": "REC-001",
      "recommendation_text": "Replace mechanical seal on Pump P-301. Perform a root cause analysis of the failed seal (seal strip report).",
      "failure_modes_addressed": ["FM-001"],
      "expected_outcome": "Restores seal integrity, stops leakage, and reduces immediate vibration if seal was primary cause.",
      "confidence_in_outcome": 0.95,
      "implementation_priority": "High",
      "estimated_cost_category": "$$ (Medium $1k-$10k)"
    },
    {
      "recommendation_id": "REC-002",
      "recommendation_text": "Investigate root cause of high vibration: check pump/motor alignment, inspect bearings (consider replacement given operating hours), check for impeller imbalance or damage.",
      "failure_modes_addressed": ["FM-001", "FM-002"],
      "expected_outcome": "Reduces overall vibration to acceptable levels, extends life of seal and bearings, improves pump reliability.",
      "confidence_in_outcome": 0.9,
      "implementation_priority": "High",
      "estimated_cost_category": "$$$ (High >$10k)"
    },
    {
      "recommendation_id": "REC-003",
      "recommendation_text": "Review and optimize seal flush plan for P-301 based on fluid properties and operating conditions. Consider upgrade if current system is inadequate.",
      "failure_modes_addressed": ["FM-001"],
      "expected_outcome": "Ensures optimal seal operating environment, extending seal life.",
      "confidence_in_outcome": 0.8,
      "implementation_priority": "Medium",
      "estimated_cost_category": "$ (Low <$1k)"
    }
  ],
  "performance_predictions": {
    "without_intervention": {
      "time_to_escalation_days": 1,
      "potential_consequences": ["Catastrophic seal failure leading to large uncontrolled leak", "Pump seizure due to bearing failure or excessive heat", "Forced unit shutdown", "Potential safety (personnel exposure, fire) and environmental incidents."]
    },
    "with_recommendations_implemented": {
      "expected_improvement_metric": "Pump P-301 vibration reduced to < 4 mm/s; MTBF for seal extended by >100%; Overall pump health score >0.85.",
      "long_term_outlook": "Reliable operation of P-301, reduced risk of unplanned outages."
    }
  },
  "regulatory_compliance": {
    "potential_breaches": [
       {
        "regulation_id": "OSHA PSM 29 CFR 1910.119 (Mechanical Integrity)",
        "description_of_potential_breach": "Operating equipment with known deficiencies (high vibration, seal leak) that could lead to a release of hazardous chemicals.",
        "implication": "Potential for regulatory citation, fines, and mandated operational changes."
      },
      {
        "regulation_id": "EPA Clean Air Act (LDAR program if applicable)",
        "description_of_potential_breach": "Uncontrolled fugitive emissions from leaking seal.",
        "implication": "Potential fines and environmental reporting obligations."
      }
    ],
    "compliance_notes": "Ensure maintenance and repair records are meticulously kept for compliance audits."
  },
  "data_confidence": {
    "overall_confidence_score": "0.80",
    "confidence_assessment_details": "High confidence due to specific vibration and leakage data. Operating hours provide context. Condition of seal flush system is the main unknown.",
    "data_gaps": [
      "Condition of seal flush system is unknown and could be a key missing piece of information."
    ]
  }
}
\`\`\`

Now, perform the RCA based on the provided "Input Parameters for Analysis" and "Domain-Specific Knowledge". Generate the complete JSON object strictly following the "RESPONSE FORMAT".
  `;

  let llmOutput = ""; // Initialize to capture output for logging in case of error
  try {
    // Add this line to see the exact prompt sent to the LLM
    console.log("[RCA Graph] Constructed LLM Prompt (first 500 chars):\n", prompt.substring(0,500) + "...");

    const response = await llm.invoke([new HumanMessage(prompt)]);
    llmOutput = response.content.toString(); // Store raw output
    console.log("[RCA Graph] LLM Raw Output (first 500 chars):", llmOutput.substring(0,500) + "...");

    let jsonString = llmOutput;
    const jsonBlockMatch = llmOutput.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch && jsonBlockMatch[1]) {
      jsonString = jsonBlockMatch[1];
    } else {
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        } else {
            console.warn("[RCA Graph] LLM output does not appear to be a JSON object or a markdown JSON block. Attempting to parse as is. Raw output:", llmOutput);
            // Fall through to JSON.parse, which will likely throw an error to be caught below.
        }
    }
    
    const parsedResult: RcaResult = JSON.parse(jsonString);
    
    if (!parsedResult.analyzed_node_id || !parsedResult.root_cause_analysis || !parsedResult.root_cause_analysis.identified_failure_modes) {
        console.error("[RCA Graph] LLM output missing crucial fields: analyzed_node_id or root_cause_analysis.identified_failure_modes. Raw output:", llmOutput);
        throw new Error("LLM output missing crucial fields like analyzed_node_id or root_cause_analysis.identified_failure_modes.");
    }

    console.log("[RCA Graph] Parsed LLM Result:", parsedResult);
    return { rcaResult: parsedResult };

  } catch (e: any) {
    console.error("[RCA Graph] Error analyzing data with LLM or parsing result:", e.message);
    console.error("[RCA Graph] Failing LLM Output (if available):", llmOutput); // Log the full raw output on error
    const errorResult: RcaResult = {
      analysis_id: "error",
      analyzed_node_id: selectedNode.id, // selectedNode is guaranteed to be defined here due to earlier check
      analysis_summary: "Error during RCA analysis. Could not determine failure modes.",
      sulfur_assessment: {
        assessment_details: "N/A",
        mitigation_options: []
      },
      process_evaluation: {
        evaluation_details: "N/A",
        optimization_suggestions: []
      },
      root_cause_analysis: {
        methodology_description: "N/A",
        identified_failure_modes: [{
          failure_mode_id: "error",
          description: `Failed to process LLM response or LLM error: ${e.message}. Check logs for LLM raw output.`,
          likelihood: "N/A",
          severity: "N/A",
          contributing_factors: [],
          mitigation_strategies: []
        }],
        underlying_causes: []
      },
      immediate_actions: [],
      recommendations: [],
      performance_predictions: {
        scenario_description: "N/A",
        predicted_outcome: "N/A",
        confidence_level: "N/A"
      },
      regulatory_compliance: {
        compliance_status: "N/A",
        relevant_regulations: [],
        corrective_actions_needed: []
      },
      data_confidence: {
        overall_confidence_score: "0.0",
        confidence_assessment_details: "N/A",
        data_gaps: []
      }
    };
    return { rcaResult: errorResult, error: `Failed to analyze data using LLM: ${e.message}` };
  }
}

// Define the channels configuration for the StateGraph.
// Use keyof RcaState for type safety.
const rcaGraphChannelsConfig: { [Key in keyof RcaState]: null | { value: (x: any, y: any) => any, default?: () => any } } = {
  rcaRequestContext: null,
  rcaResult: null,
  error: null,
};

// StateGraph using RcaState for the main state, and Partial<RcaState> for updates.
const rcaWorkflow = new StateGraph<RcaState, Partial<RcaState>>({
  channels: rcaGraphChannelsConfig,
});

// Add nodes
rcaWorkflow.addNode("initialize_rca_context", new RunnableLambda({ func: initializeRcaContext }) as any);
rcaWorkflow.addNode("analyze_data_llm", new RunnableLambda({ func: analyzeData }) as any);

// Add edges
rcaWorkflow.addEdge(START, "initialize_rca_context" as any);
rcaWorkflow.addEdge("initialize_rca_context" as any, "analyze_data_llm" as any);
rcaWorkflow.addEdge("analyze_data_llm" as any, END);

const rcaApp: CompiledStateGraph<RcaState, Partial<RcaState>> = rcaWorkflow.compile();

export async function runRca(request: RcaRequest): Promise<RcaResult> {
  console.log(`---RUNNING RCA GRAPH for node: ${request.selectedNode.label}--`);
  const initialState: Partial<RcaState> = { rcaRequestContext: request };
  
  try {
    const result = await rcaApp.invoke(initialState, { recursionLimit: 100 });
    console.log("---RCA GRAPH COMPLETE---");
    console.log("Final RCA State:", result);

    if (result.error) {
      console.error("Error in RCA graph execution:", result.error);
      // Return a structured error RcaResult if not already formed by analyzeData
      if (!result.rcaResult || result.rcaResult.analysis_summary.startsWith("Error during RCA analysis")) {
        return {
          analysis_id: "error",
          analyzed_node_id: request.selectedNode.id,
          analysis_summary: `Error during RCA execution: ${result.error}`,
          sulfur_assessment: {
            assessment_details: "N/A",
            mitigation_options: []
          },
          process_evaluation: {
            evaluation_details: "N/A",
            optimization_suggestions: []
          },
          root_cause_analysis: {
            methodology_description: "N/A",
            identified_failure_modes: [{
              failure_mode_id: "error-in-graph", // Differentiate from LLM error
              description: result.error || "Unknown error in graph execution",
              likelihood: "N/A",
              severity: "N/A",
              contributing_factors: [],
              mitigation_strategies: []
            }],
            underlying_causes: []
          },
          immediate_actions: [],
          recommendations: [],
          performance_predictions: {
            scenario_description: "N/A",
            predicted_outcome: "N/A",
            confidence_level: "N/A"
          },
          regulatory_compliance: {
            compliance_status: "N/A",
            relevant_regulations: [],
            corrective_actions_needed: []
          },
          data_confidence: {
            overall_confidence_score: "0.0",
            confidence_assessment_details: "N/A",
            data_gaps: []
          }
        };
      }
    }
    if (!result.rcaResult) {
        console.error("RCA graph finished but rcaResult is undefined.");
        return {
          analysis_id: "error",
          analyzed_node_id: request.selectedNode.id,
          analysis_summary: "RCA process completed without generating a result.",
          sulfur_assessment: {
            assessment_details: "N/A",
            mitigation_options: []
          },
          process_evaluation: {
            evaluation_details: "N/A",
            optimization_suggestions: []
          },
          root_cause_analysis: {
            methodology_description: "N/A",
            identified_failure_modes: [{
              failure_mode_id: "error",
              description: "The RCA process did not yield a specific result.",
              likelihood: "N/A",
              severity: "N/A",
              contributing_factors: [],
              mitigation_strategies: []
            }],
            underlying_causes: []
          },
          immediate_actions: [],
          recommendations: [],
          performance_predictions: {
            scenario_description: "N/A",
            predicted_outcome: "N/A",
            confidence_level: "N/A"
          },
          regulatory_compliance: {
            compliance_status: "N/A",
            relevant_regulations: [],
            corrective_actions_needed: []
          },
          data_confidence: {
            overall_confidence_score: "0.0",
            confidence_assessment_details: "N/A",
            data_gaps: []
          }
        };
    }
    return result.rcaResult;

  } catch (e: any) {
    console.error("---RCA GRAPH FAILED TO INVOKE---", e);
    return {
      analysis_id: "error",
      analyzed_node_id: request.selectedNode.id,
      analysis_summary: `Critical error invoking RCA graph: ${e.message}`,
      sulfur_assessment: {
        assessment_details: "N/A",
        mitigation_options: []
      },
      process_evaluation: {
        evaluation_details: "N/A",
        optimization_suggestions: []
      },
      root_cause_analysis: {
        methodology_description: "N/A",
        identified_failure_modes: [{
          failure_mode_id: "error",
          description: e.message,
          likelihood: "N/A",
          severity: "N/A",
          contributing_factors: [],
          mitigation_strategies: []
        }],
        underlying_causes: []
      },
      immediate_actions: [],
      recommendations: [],
      performance_predictions: {
        scenario_description: "N/A",
        predicted_outcome: "N/A",
        confidence_level: "N/A"
      },
      regulatory_compliance: {
        compliance_status: "N/A",
        relevant_regulations: [],
        corrective_actions_needed: []
      },
      data_confidence: {
        overall_confidence_score: "0.0",
        confidence_assessment_details: "N/A",
        data_gaps: []
      }
    };
  }
}
