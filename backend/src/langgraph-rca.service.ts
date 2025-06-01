import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, StateGraphArgs, END, START, CompiledStateGraph } from "@langchain/langgraph";
import { RunnableLambda, RunnableConfig } from "@langchain/core/runnables";
import { HumanMessage } from "@langchain/core/messages";

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

export interface RcaFactor {
  factor: string;
  likelihood: number; // 0.0 to 1.0
  evidence: string[];
}

export interface RecommendedSolution {
  solution: string;
  estimatedImpact: string;
  confidence: number; // 0.0 to 1.0
}

export interface FailureMode {
  mode: string;
  description: string;
  potentialCauses: RcaFactor[];
  recommendedSolutions: RecommendedSolution[];
}

export interface RcaResult {
  analyzedNodeId: string;
  summary: string;
  failureModes: FailureMode[];
  overallConfidence: number; // 0.0 to 1.0
  timestamp: string;
}

// --- Updated State for our graph ---
interface RcaState {
  rcaRequestContext?: RcaRequest;
  rcaResult?: RcaResult;
  error?: string;
}

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

  const adjacentNodesInfo = adjacentNodes.map(n => `  - Node ID: ${n.id}, Label: ${n.label}, Type: ${n.type || 'N/A'}, Properties: ${JSON.stringify(n.properties)}`).join('\n');
  const connectingEdgesInfo = connectingEdges.map(e => `  - Edge ID: ${e.id}, From: ${e.from}, To: ${e.to}, Label: ${e.label || 'N/A'}, Properties: ${JSON.stringify(e.properties)}`).join('\n');

  const prompt = `
    You are an expert Root Cause Analysis (RCA) system for industrial processes, specifically focusing on oil refinery operations.
    Your task is to analyze the provided graph data representing a component and its surrounding environment to identify potential failure modes, their causes, and recommend solutions.

    You MUST return your analysis as a single JSON object conforming to the RcaResult interface structure provided below.
    Ensure all fields in the JSON structure are populated appropriately. Likelihood and confidence scores should be between 0.0 and 1.0.

    JSON Structure to follow:
    \`\`\`json
    {
      "analyzedNodeId": "string", // ID of the primary node being analyzed
      "summary": "string", // A brief summary of the overall analysis
      "failureModes": [
        {
          "mode": "string", // e.g., "Corrosion Under Insulation (CUI)"
          "description": "string", // Detailed description of this failure mode
          "potentialCauses": [
            {
              "factor": "string", // e.g., "Moisture ingress due to damaged insulation cladding"
              "likelihood": "number", // Likelihood of this factor contributing (0.0 to 1.0)
              "evidence": ["string"] // Evidence supporting this factor, based on provided data or domain knowledge
            }
          ],
          "recommendedSolutions": [
            {
              "solution": "string", // e.g., "Inspect and repair insulation and cladding"
              "estimatedImpact": "string", // e.g., "Reduces risk of CUI by 70%"
              "confidence": "number" // Confidence in this solution's effectiveness (0.0 to 1.0)
            }
          ]
        }
      ],
      "overallConfidence": "number", // Overall confidence in the entire RCA (0.0 to 1.0)
      "timestamp": "string" // ISO 8601 timestamp of the analysis
    }
    \`\`\`

    Context for Analysis:
    Selected Node (Component of Interest):
      - Node ID: ${selectedNode.id}
      - Label: ${selectedNode.label}
      - Type: ${selectedNode.type || 'N/A'}
      - Properties: ${JSON.stringify(selectedNode.properties)}

    Adjacent Nodes (Connected Components/Environment):
    ${adjacentNodesInfo || '  - None'}

    Connecting Edges (Relationships):
    ${connectingEdgesInfo || '  - None'}

    Few-Shot Examples of Analysis (Oil Refinery Context):

    Example 1:
    Input Context Snippet: Selected Node: Pipe Segment P-101 (Carbon Steel), Properties: { operating_temp: '150C', fluid: 'Sour Crude' }. Adjacent: Insulation I-101 (Damaged).
    Expected JSON Output Snippet for one failure mode:
    \`\`\`json
    {
      "mode": "Corrosion Under Insulation (CUI)",
      "description": "Degradation of pipe material due to trapped moisture under insulation. Given the sour crude and operating temperature, any moisture ingress is critical.",
      "potentialCauses": [
        { "factor": "Damaged insulation (I-101) allowing moisture ingress.", "likelihood": 0.8, "evidence": ["Adjacent node I-101 reported as 'Damaged'", "Carbon steel susceptible to CUI"] },
        { "factor": "Operating temperature (150C) accelerates corrosion if moisture is present.", "likelihood": 0.7, "evidence": ["Node P-101 property operating_temp: 150C"] }
      ],
      "recommendedSolutions": [
        { "solution": "Immediate inspection of P-101 under insulation. Repair/replace insulation I-101.", "estimatedImpact": "High reduction in CUI risk", "confidence": 0.9 }
      ]
    }
    \`\`\`

    Example 2:
    Input Context Snippet: Selected Node: Pump P-205 (Centrifugal), Properties: { vibration_level: 'High', last_maintenance: '12 months ago' }. Adjacent: Motor M-205 (Connected, Normal Ops).
    Expected JSON Output Snippet for one failure mode:
    \`\`\`json
    {
      "mode": "Bearing Failure",
      "description": "Pump P-205 is experiencing high vibration, a common symptom of bearing wear or failure, especially with overdue maintenance.",
      "potentialCauses": [
        { "factor": "Wear and tear of bearings due to extended operation without maintenance.", "likelihood": 0.85, "evidence": ["Property: vibration_level: High", "Property: last_maintenance: 12 months ago"] },
        { "factor": "Misalignment with Motor M-205 (though M-205 is Normal Ops, check alignment).", "likelihood": 0.4, "evidence": ["High vibration can be caused by misalignment"] }
      ],
      "recommendedSolutions": [
        { "solution": "Schedule immediate maintenance for P-205: inspect bearings, check alignment, lubricate.", "estimatedImpact": "Prevents catastrophic pump failure, restores efficiency.", "confidence": 0.95 }
      ]
    }
    \`\`\`

    Example 3:
    Input Context Snippet: Selected Node: Heat Exchanger HX-301, Properties: { tube_material: 'Brass', shell_fluid: 'Cooling Water (High Chlorides)'}. Edge: E-301 (From: Cooling Tower CT-300, To: HX-301).
    Expected JSON Output Snippet for one failure mode:
    \`\`\`json
    {
      "mode": "Chloride Stress Corrosion Cracking (CSCC)",
      "description": "Brass tubes in HX-301 are susceptible to CSCC when exposed to cooling water with high chloride content.",
      "potentialCauses": [
        { "factor": "High chloride content in cooling water from CT-300.", "likelihood": 0.9, "evidence": ["Property: shell_fluid: Cooling Water (High Chlorides)", "Brass material susceptible to CSCC"] },
        { "factor": "Elevated operational stresses or temperatures (if any, not specified but common).", "likelihood": 0.5, "evidence": ["General knowledge for CSCC"] }
      ],
      "recommendedSolutions": [
        { "solution": "Monitor chloride levels in cooling water. Consider material upgrade for tubes if CSCC is confirmed.", "estimatedImpact": "Extends exchanger lifespan, prevents leaks.", "confidence": 0.8 }
      ]
    }
    \`\`\`

    Example 4:
    Input Context Snippet: Selected Node: Valve V-450 (Gate Valve), Properties: { position: 'Stuck Open', actuator_type: 'Pneumatic' }. Adjacent: Actuator A-450 (Connected, Low Air Pressure).
    Expected JSON Output Snippet for one failure mode:
    \`\`\`json
    {
      "mode": "Valve Fails to Close",
      "description": "Valve V-450 is stuck open, likely due to an issue with its pneumatic actuator A-450, which is reporting low air pressure.",
      "potentialCauses": [
        { "factor": "Insufficient air pressure to actuator A-450.", "likelihood": 0.95, "evidence": ["Adjacent node A-450 property: Low Air Pressure", "Valve is pneumatically actuated"] },
        { "factor": "Mechanical obstruction within the valve body.", "likelihood": 0.3, "evidence": ["General possibility for stuck valves"] }
      ],
      "recommendedSolutions": [
        { "solution": "Inspect air supply to actuator A-450, check for leaks or supply issues. Inspect valve V-450 for mechanical issues if air supply is normal.", "estimatedImpact": "Restores valve functionality, critical for process control.", "confidence": 0.9 }
      ]
    }
    \`\`\`

    Example 5:
    Input Context Snippet: Selected Node: Storage Tank T-502, Properties: { product: 'Naphtha', vent_status: 'Clogged' }.
    Expected JSON Output Snippet for one failure mode:
    \`\`\`json
    {
      "mode": "Overpressure of Tank",
      "description": "Tank T-502 storing volatile Naphtha has a clogged vent, creating a high risk of overpressure during filling or due to temperature changes.",
      "potentialCauses": [
        { "factor": "Clogged vent preventing pressure relief.", "likelihood": 0.98, "evidence": ["Property: vent_status: Clogged"] },
        { "factor": "Filling operations increasing internal pressure.", "likelihood": 0.7, "evidence": ["Naphtha is volatile, tank is being filled (assumed common operation)"] }
      ],
      "recommendedSolutions": [
        { "solution": "Immediately inspect and clear tank vent. Review vent maintenance schedule. Implement high-pressure alarm.", "estimatedImpact": "Prevents tank rupture and loss of containment.", "confidence": 0.95 }
      ]
    }
    \`\`\`

    Now, analyze the provided context and generate the JSON output.
  `;

  try {
    // Add this line to see the exact prompt sent to the LLM
    console.log("[RCA Graph] Constructed LLM Prompt:\n", prompt);

    const response = await llm.invoke([new HumanMessage(prompt)]);
    const llmOutput = response.content.toString();
    console.log("[RCA Graph] LLM Raw Output:", llmOutput);

    // Attempt to parse the JSON output from the LLM
    // The LLM might return the JSON block wrapped in ```json ... ```, so we need to extract it.
    let jsonString = llmOutput;
    const jsonBlockMatch = llmOutput.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch && jsonBlockMatch[1]) {
      jsonString = jsonBlockMatch[1];
    }
    
    const parsedResult: RcaResult = JSON.parse(jsonString);
    
    // Validate crucial fields (optional, but good practice)
    if (!parsedResult.analyzedNodeId || !parsedResult.failureModes) {
        throw new Error("LLM output missing crucial fields like analyzedNodeId or failureModes.");
    }
    // Ensure timestamp is current if not provided by LLM or if it's invalid
    if (!parsedResult.timestamp || isNaN(new Date(parsedResult.timestamp).getTime())) {
        parsedResult.timestamp = new Date().toISOString();
    }


    console.log("[RCA Graph] Parsed LLM Result:", parsedResult);
    return { rcaResult: parsedResult };

  } catch (e: any) {
    console.error("[RCA Graph] Error analyzing data with LLM or parsing result:", e);
    // Fallback or error structure
    const errorResult: RcaResult = {
      analyzedNodeId: selectedNode.id,
      summary: "Error during RCA analysis. Could not determine failure modes.",
      failureModes: [{
        mode: "Analysis Error",
        description: e.message || "An unexpected error occurred during LLM interaction or parsing.",
        potentialCauses: [],
        recommendedSolutions: []
      }],
      overallConfidence: 0.0,
      timestamp: new Date().toISOString(),
    };
    return { rcaResult: errorResult, error: e.message || "Failed to analyze data using LLM." };
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
      if (!result.rcaResult || result.rcaResult.summary.startsWith("Error during RCA analysis")) {
        return {
            analyzedNodeId: request.selectedNode.id,
            summary: `Error during RCA execution: ${result.error}`,
            failureModes: [{
                mode: "Execution Error",
                description: result.error,
                potentialCauses: [],
                recommendedSolutions: []
            }],
            overallConfidence: 0.0,
            timestamp: new Date().toISOString(),
        };
      }
    }
    if (!result.rcaResult) {
        console.error("RCA graph finished but rcaResult is undefined.");
        return {
            analyzedNodeId: request.selectedNode.id,
            summary: "RCA process completed without generating a result.",
            failureModes: [{
                mode: "Process Incomplete",
                description: "The RCA process did not yield a specific result.",
                potentialCauses: [],
                recommendedSolutions: []
            }],
            overallConfidence: 0.0,
            timestamp: new Date().toISOString(),
        };
    }
    return result.rcaResult;

  } catch (e: any) {
    console.error("---RCA GRAPH FAILED TO INVOKE---", e);
    return {
      analyzedNodeId: request.selectedNode.id,
      summary: `Critical error invoking RCA graph: ${e.message}`,
      failureModes: [{
        mode: "Invocation Error",
        description: e.message,
        potentialCauses: [],
        recommendedSolutions: []
      }],
      overallConfidence: 0.0,
      timestamp: new Date().toISOString(),
    };
  }
}
