import dotenv from 'dotenv';
dotenv.config(); // Moved to the very top

console.log('########## EXECUTING backend/src/server.ts ##########');
import express, { Express, Request, Response, NextFunction, RequestHandler } from 'express'; 
import { Pool, PoolConfig, PoolClient } from 'pg'; // Added PoolClient
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai'; 
import { ParsedQs } from 'qs'; // Ensure qs is imported for ParsedQs
import { ParamsDictionary } from 'express-serve-static-core'; // Ensure this is imported for ParamsDictionary
import { runRca, RcaRequest as ServiceRcaRequest, RcaResult } from './langgraph-rca.service'; // Renamed imported RcaRequest to avoid conflict

console.log("[DEBUG] server.ts - After dotenv.config():");
console.log("[DEBUG] AZURE_OPENAI_API_KEY:", process.env.AZURE_OPENAI_API_KEY ? 'Loaded' : 'NOT LOADED');
console.log("[DEBUG] AZURE_OPENAI_ENDPOINT:", process.env.AZURE_OPENAI_ENDPOINT ? 'Loaded' : 'NOT LOADED');
console.log("[DEBUG] AZURE_OPENAI_DEPLOYMENT_NAME:", process.env.AZURE_OPENAI_DEPLOYMENT_NAME ? 'Loaded' : 'NOT LOADED');
console.log("[DEBUG] OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? 'Loaded' : 'NOT LOADED');

// Initialize OpenAI client
const azureOpenAIApiKey = process.env.AZURE_OPENAI_API_KEY;
const azureOpenAIApiInstanceName = process.env.AZURE_OPENAI_ENDPOINT; 
const azureOpenAIApiDeploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
const azureOpenAIApiVersion = process.env.AZURE_OPENAI_API_VERSION || '2023-07-01-preview';

const openAIApiKey = process.env.OPENAI_API_KEY;
const openAIModelName = process.env.OPENAI_MODEL_NAME || 'gpt-3.5-turbo';

let openai: OpenAI;

if (azureOpenAIApiKey && azureOpenAIApiInstanceName && azureOpenAIApiDeploymentName) {
  console.log("Initializing Azure OpenAI client...");
  openai = new OpenAI({
    apiKey: azureOpenAIApiKey,
    baseURL: `${azureOpenAIApiInstanceName}/openai/deployments/${azureOpenAIApiDeploymentName}`,
    defaultQuery: { 'api-version': azureOpenAIApiVersion },
    defaultHeaders: { 'api-key': azureOpenAIApiKey },
  });
  console.log("Azure OpenAI client initialized.");
} else if (openAIApiKey) {
  console.log("Initializing standard OpenAI client...");
  openai = new OpenAI({
    apiKey: openAIApiKey,
  });
  console.log("Standard OpenAI client initialized.");
} else {
  console.error("OpenAI API key not found. Please set OPENAI_API_KEY or Azure OpenAI environment variables.");
}

const app: Express = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

interface VisNode {
  id: string; 
  label?: string;
  title?: string;
  group?: string;
  properties?: Record<string, any>;
  x?: number;
  y?: number;
  fixed?: boolean;
}

interface VisEdge {
  id?: string; 
  from: string; 
  to: string;   
  label?: string;
  title?: string;
  properties?: Record<string, any>;
}

interface GraphData {
  nodes: VisNode[];
  edges: VisEdge[];
}

// Restoring SubgraphContext as it's used by fetchNeighborhood
interface SubgraphContext {
  selectedNode: ParsedAgEntity;
  neighborNodes: ParsedAgEntity[];
  connectingEdges: ParsedAgEntity[];
}

const caBundleFilename = 'bundle.pem'; 
const caBundlePath = path.join(__dirname, '..', 'src', caBundleFilename);

let sslOptions: PoolConfig['ssl'] = { rejectUnauthorized: true }; 

console.log(`Attempting to load CA certificate bundle: ${caBundleFilename} from backend/src/ directory...`);
if (fs.existsSync(caBundlePath)) {
  try {
    const caContent = fs.readFileSync(caBundlePath).toString();
    console.warn('!!!! INSECURE DEVELOPMENT MODE !!!! Forcing rejectUnauthorized to false. DO NOT USE IN PRODUCTION. Revert this change after testing and before any deployment.');
    sslOptions = {
      rejectUnauthorized: false,       
      ca: caContent,                  
      servername: process.env.DB_HOST 
    };
    console.log(`  [SUCCESS] Loaded CA certificate bundle: ${caBundleFilename}. rejectUnauthorized is TEMPORARILY FALSE. Servername: ${process.env.DB_HOST}`);
  } catch (error) {
    console.error(`  [ERROR] Could not read CA certificate bundle ${caBundleFilename} at ${caBundlePath}:`, error);
    console.warn(
      `CRITICAL: Could not read CA bundle ${caBundleFilename}. ` +
      `!!!! INSECURE DEVELOPMENT MODE !!!! Forcing rejectUnauthorized to false. DO NOT USE IN PRODUCTION. Revert this change after testing and before any deployment.`
    );
    sslOptions = { 
      rejectUnauthorized: false, 
      servername: process.env.DB_HOST 
    }; 
  }
} else {
  console.warn(
    `CRITICAL: SSL CA certificate bundle '${caBundleFilename}' not found at '${caBundlePath}'. ` +
    `!!!! INSECURE DEVELOPMENT MODE !!!! Forcing rejectUnauthorized to false. DO NOT USE IN PRODUCTION. Revert this change after testing and before any deployment.`
  );
  sslOptions = {
    rejectUnauthorized: false, 
    servername: process.env.DB_HOST 
  };
}

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
  ssl: sslOptions,
  keepAlive: true,
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
});

interface ParsedAgEntity {
  id: string; // Changed from number
  label: string;
  properties: Record<string, any>;
  start_id?: string; // Changed from number
  end_id?: string;   // Changed from number
}

function parseAgtypeOutputString(agtypeString: string): ParsedAgEntity | null {
  console.log('parseAgtypeOutputString: Received input:', agtypeString); 
  if (!agtypeString || typeof agtypeString !== 'string') {
    console.error('parseAgtypeOutputString: Invalid agtypeString input:', agtypeString);
    return null;
  }
  try {
    const trimmedString = agtypeString.trim();
    console.log('parseAgtypeOutputString: Trimmed input:', trimmedString); 
    
    let jsonToParse = trimmedString.replace(/::\w+$/, '');
    console.log('parseAgtypeOutputString: String after type suffix removal:', jsonToParse);

    // Regex to find number values for "id", "start_id", "end_id" and quote them to preserve precision
    // This handles: "id": 123, "id":123, "id" : 123
    // It ensures that when JSON.parse runs, these specific ID fields are treated as strings.
    jsonToParse = jsonToParse.replace(/"(id|start_id|end_id)"\s*:\s*(\d+)/g, '"$1": "$2"');
    console.log('parseAgtypeOutputString: String after ID quoting for JSON.parse:', jsonToParse);

    const parsed = JSON.parse(jsonToParse);

    if (parsed === null || typeof parsed !== 'object') {
        console.error('parseAgtypeOutputString: Parsed data is not an object or is null:', parsed, 'Original agtypeString:', agtypeString, 'jsonToParse:', jsonToParse);
        return null;
    }
    // Validate core fields, expecting id to be a string now
    if (typeof parsed.id !== 'string' || typeof parsed.label !== 'string' || typeof parsed.properties !== 'object') {
        console.error('parseAgtypeOutputString: Parsed object missing required fields (id (string), label (string), properties (object)):', parsed, 'Original agtypeString:', agtypeString, 'jsonToParse:', jsonToParse);
        return null;
    }
    
    const entity: Partial<ParsedAgEntity> = {
      id: parsed.id, // Already a string due to regex quoting
      label: parsed.label,
      properties: parsed.properties,
    };

    if (trimmedString.includes('::edge') || ('start_id' in parsed || 'end_id' in parsed)) { 
        if (typeof parsed.start_id === 'string') {
            entity.start_id = parsed.start_id; // Already a string
        } else {
            console.error('parseAgtypeOutputString: Parsed edge object has invalid or missing start_id (must be string):', parsed, 'Original agtypeString:', agtypeString, 'jsonToParse:', jsonToParse);
            return null;
        }
        if (typeof parsed.end_id === 'string') {
            entity.end_id = parsed.end_id; // Already a string
        } else {
            console.error('parseAgtypeOutputString: Parsed edge object has invalid or missing end_id (must be string):', parsed, 'Original agtypeString:', agtypeString, 'jsonToParse:', jsonToParse);
            return null;
        }
    }
    console.log('parseAgtypeOutputString: Successfully parsed:', entity);
    return entity as ParsedAgEntity;
  } catch (e) {
    const stringThatFailedParse = agtypeString.trim().replace(/::\w+$/, '').replace(/"(id|start_id|end_id)"\s*:\s*(\d+)/g, '"$1": "$2"');
    console.error('parseAgtypeOutputString: Error during JSON.parse or validation. Original agtypeString:', agtypeString, 'Attempted to parse (jsonToParse):', stringThatFailedParse, 'Error:', e);
    return null;
  }
}

interface AgEntityRow {
  ag_vertex_string_out?: string; 
  ag_edge_string_out?: string;   
  node_count?: any; 
  deleted_node_id?: string; 
  deleted_edge_id?: string; 
}

async function testDatabaseConnection() {
  let client;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph'; 
  try {
    client = await pool.connect(); 
    console.log('testDatabaseConnection: Successfully connected to database.');
    await client.query("SET search_path = ag_catalog, '$user', public;"); 
    console.log('testDatabaseConnection: search_path set.');

    const cypherQuery = `SELECT * from cypher('${graphName}', $$ MATCH (n) RETURN n LIMIT 1 $$) as (n agtype);`; 
    console.log(`Executing test Cypher query: ${cypherQuery}`);
    const res = await client.query(cypherQuery);
    console.log('Test Cypher query executed. Results:', res.rows);
    if (res.rows.length > 0 && res.rows[0].n) { 
      console.log('Successfully fetched data with AGE. Raw agtype:', res.rows[0].n);
      try {
        const agtypeOutTestQuery = `
          WITH graph_data AS (
            SELECT v FROM cypher($$${graphName}$$, $$ MATCH (n:Person) WHERE n.name = 'Alice' RETURN n LIMIT 1 $$) AS (v agtype)
          )
          SELECT ag_catalog.agtype_out(graph_data.v) AS ag_vertex_string_out FROM graph_data
          WHERE graph_data.v IS NOT NULL;
        `;
        console.log(`Executing agtype_out test query: ${agtypeOutTestQuery}`);
        const conversionResult = await client.query<{ ag_vertex_string_out: string }>(agtypeOutTestQuery);
        
        if (conversionResult.rows.length > 0 && conversionResult.rows[0].ag_vertex_string_out) {
            console.log('testDatabaseConnection: ag_catalog.agtype_out() result string:', conversionResult.rows[0].ag_vertex_string_out);
            const parsedTestNode = parseAgtypeOutputString(conversionResult.rows[0].ag_vertex_string_out);
            console.log('testDatabaseConnection: Parsed test node from agtype_out string:', parsedTestNode);
            if (parsedTestNode) {
                console.log('testDatabaseConnection: Successfully parsed agtype_out string.');
            } else {
                console.warn('testDatabaseConnection: Failed to parse agtype_out string for test node.');
            }
        } else {
            console.warn('testDatabaseConnection: agtype_out test query returned no rows or no string. This might be because the MATCH subquery found no data.');
        }
      } catch (e) {
        console.error('testDatabaseConnection: Error calling ag_catalog.agtype_out() or parsing in test query:', e);
      }
    } else {
      console.log('AGE test query ran but returned no data (this might be okay if graph is empty).');
    }

  } catch (err) {
    console.error('Error during database/AGE test:', err);
  } finally {
    if (client) {
      client.release();
      console.log('Test Database Connection: Client released.');
    }
  }
}

// New function to fetch neighborhood context
async function fetchNeighborhood(nodeIdStr: string, graphName: string): Promise<SubgraphContext | null> {
  console.log(`[fetchNeighborhood] Entered. Node ID: ${nodeIdStr}, Graph Name: ${graphName}`);
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    console.log('[fetchNeighborhood] Database client connected.');
    await client.query("SET search_path = ag_catalog, '$user', public;");
    console.log('[fetchNeighborhood] search_path set.');

    // Validate that nodeIdStr is a string representation of an integer
    // AGE IDs are bigints, which can be larger than JS Number.MAX_SAFE_INTEGER.
    // However, the client sends it as a string, and we use it as a string in Cypher.
    // This validation is more about ensuring it's a numeric string, not its magnitude.
    if (!/^\d+$/.test(nodeIdStr)) {
      console.error(`[fetchNeighborhood] Invalid node ID format (not a numeric string): ${nodeIdStr}`);
      if (client) client.release(); // Release client before early return
      return null;
    }
    console.log(`[fetchNeighborhood] Node ID ${nodeIdStr} format validated as numeric string.`);

    // Fetch the selected node using toString(id(n)) for ID comparison
    // Interpolating nodeIdStr directly due to issues with $1 placeholder within cypher()
    const selectedNodeCypherQuery = `MATCH (n) WHERE toString(id(n)) = \'${nodeIdStr}\' RETURN n`;
    const selectedNodeQuery = `
      SELECT ag_catalog.agtype_out(query_result.v) AS node_data
      FROM cypher($$${graphName}$$, $$${selectedNodeCypherQuery}$$) AS query_result(v agtype);
    `;
    console.log(`[fetchNeighborhood] Executing selectedNodeQuery with ID ${nodeIdStr}:`, selectedNodeQuery);
    // Note: No parameters array needed for client.query if $1 is removed
    const selectedNodeRes = await client.query<{ node_data: string }>(selectedNodeQuery);
    console.log('[fetchNeighborhood] selectedNodeQuery raw result:', JSON.stringify(selectedNodeRes.rows, null, 2));

    if (selectedNodeRes.rows.length === 0 || !selectedNodeRes.rows[0].node_data) {
      console.error(`[fetchNeighborhood] Selected node with ID ${nodeIdStr} not found. Query returned no data or no node_data field.`);
      if (client) client.release(); // Release client
      return null;
    }
    console.log(`[fetchNeighborhood] Raw selected node data string: ${selectedNodeRes.rows[0].node_data}`);
    const selectedNode = parseAgtypeOutputString(selectedNodeRes.rows[0].node_data);
    if (!selectedNode) {
        console.error(`[fetchNeighborhood] Failed to parse selected node data for ID ${nodeIdStr}. Raw data: ${selectedNodeRes.rows[0].node_data}`);
        if (client) client.release(); // Release client
        return null;
    }
    console.log('[fetchNeighborhood] Parsed selected node:', JSON.stringify(selectedNode, null, 2));

    // Fetch neighbors and relationships using toString(id(n)) for ID comparison
    // Interpolating nodeIdStr directly
    const neighborhoodCypherQuery = `MATCH (n)-[r]-(m) WHERE toString(id(n)) = \'${nodeIdStr}\' RETURN r, m`;
    const neighborhoodQuery = `
      SELECT
        ag_catalog.agtype_out(query_result.r) AS edge_data,
        ag_catalog.agtype_out(query_result.m) AS neighbor_node_data
      FROM cypher($$${graphName}$$, $$${neighborhoodCypherQuery}$$) AS query_result(r agtype, m agtype);
    `;
    console.log(`[fetchNeighborhood] Executing neighborhoodQuery with ID ${nodeIdStr}:`, neighborhoodQuery);
    // Note: No parameters array needed for client.query if $1 is removed
    const neighborhoodRes = await client.query<{ edge_data: string; neighbor_node_data: string }>(neighborhoodQuery);
    console.log('[fetchNeighborhood] neighborhoodQuery raw result:', JSON.stringify(neighborhoodRes.rows, null, 2));

    const neighborNodes: ParsedAgEntity[] = [];
    const connectingEdges: ParsedAgEntity[] = [];
    const seenNodeIds = new Set<string>();
    const seenEdgeIds = new Set<string>();

    seenNodeIds.add(selectedNode.id); // selectedNode.id is now string
    console.log(`[fetchNeighborhood] Initialized seenNodeIds with selected node ID: ${selectedNode.id}`);

    for (const row of neighborhoodRes.rows) {
      console.log('[fetchNeighborhood] Processing neighborhood row:', JSON.stringify(row, null, 2));
      const edge = parseAgtypeOutputString(row.edge_data);
      const neighbor = parseAgtypeOutputString(row.neighbor_node_data);

      console.log('[fetchNeighborhood] Parsed edge from row:', JSON.stringify(edge, null, 2));
      console.log('[fetchNeighborhood] Parsed neighbor from row:', JSON.stringify(neighbor, null, 2));

      if (edge && !seenEdgeIds.has(edge.id)) {
        connectingEdges.push(edge);
        seenEdgeIds.add(edge.id);
        console.log(`[fetchNeighborhood] Added edge ID ${edge.id} to connectingEdges and seenEdgeIds.`);
      } else if (edge) {
        console.log(`[fetchNeighborhood] Edge ID ${edge.id} already seen or edge is null.`);
      } else {
        console.log(`[fetchNeighborhood] Edge data could not be parsed from row: ${row.edge_data}`);
      }

      if (neighbor && !seenNodeIds.has(neighbor.id)) {
        neighborNodes.push(neighbor);
        seenNodeIds.add(neighbor.id);
        console.log(`[fetchNeighborhood] Added neighbor node ID ${neighbor.id} to neighborNodes and seenNodeIds.`);
      } else if (neighbor) {
        console.log(`[fetchNeighborhood] Neighbor node ID ${neighbor.id} already seen or neighbor is null.`);
      } else {
        console.log(`[fetchNeighborhood] Neighbor node data could not be parsed from row: ${row.neighbor_node_data}`);
      }
    }

    const resultContext: SubgraphContext = {
      selectedNode,
      neighborNodes,
      connectingEdges,
    };
    console.log('[fetchNeighborhood] Successfully fetched and processed neighborhood. Result:', JSON.stringify(resultContext, null, 2));
    return resultContext;

  } catch (error) {
    console.error('[fetchNeighborhood] Error fetching neighborhood:', error);
    // Ensure the error object is fully logged, including potential 'message' and 'stack'
    if (error instanceof Error) {
        console.error(`[fetchNeighborhood] Error message: ${error.message}`);
        console.error(`[fetchNeighborhood] Error stack: ${error.stack}`);
    } else {
        console.error('[fetchNeighborhood] Non-Error object thrown:', error);
    }
    return null; // Return null on error
  } finally {
    if (client) {
        client.release();
        console.log('[fetchNeighborhood] Database client released.');
    } else {
        console.log('[fetchNeighborhood] Client was not defined or already released, no release needed in finally.');
    }
  }
}

app.use(cors());
app.use(express.json());

// Comment out old/conflicting RCA route handlers and their registrations
/*
// Handler for POST /api/analyze-root-cause
const analyzeRootCauseWithNodeIdHandler: RequestHandler<ParamsDictionary, any, { nodeId: string }, ParsedQs> = async (req, res, next) => {
  const { nodeId } = req.body;
  if (!nodeId) {
    res.status(400).json({ error: 'nodeId is required in the request body.' });
    return; 
  }
  try {
    console.log(`[Server] Received request for RCA with nodeId: ${nodeId}`);
    // const result = await runRca(nodeId); // TS2345: Argument of type 'string' is not assignable to parameter of type 'ServiceRcaRequest'.
    res.status(501).json({ message: "This RCA endpoint (analyzeRootCauseWithNodeIdHandler) is deprecated." });
  } catch (error) {
    console.error('[Server] Error in analyzeRootCauseWithNodeIdHandler:', error);
    next(error); 
  }
};

// Original analyzeRootCauseWithSubgraphContextHandler, now using runRca
const analyzeRootCauseWithSubgraphContextHandler: RequestHandler<{ nodeId: string }, any, SubgraphContext, ParsedQs> = async (req, res, next) => {
  const { nodeId } = req.params; 
  const subgraphContext = req.body; 

  if (!nodeId) {
    res.status(400).json({ error: 'nodeId is required in URL path.' });
    return; 
  }
  try {
    console.log(`[Server] Received request for RCA with subgraph context for nodeId: ${nodeId}`);
    console.log("[Server] Subgraph Context:", subgraphContext);
    // const result = await runRca(nodeId); // TS2345: Argument of type 'string' is not assignable to parameter of type 'ServiceRcaRequest'.
    res.status(501).json({ message: "This RCA endpoint (analyzeRootCauseWithSubgraphContextHandler) is deprecated." });
  } catch (error) {
    console.error('[Server] Error in analyzeRootCauseWithSubgraphContextHandler:', error);
    next(error); 
  }
};

// Define a type for the expected request body for RCA analysis
/* interface RcaRequestBody { // This was a local definition, ServiceRcaRequest is now used
  nodeId?: string;
} */

/* interface RcaWithSubGraphContextRequestBody { // No longer needed
    subgraphContext?: SubgraphContext;
    nodeId?: string; 
} */

/* interface ExplainQueryRequestBody { // No longer needed
    query?: string;
} */


// Generic RCA handler - expects nodeId in body
/* const analyzeRootCauseHandler: RequestHandler<ParamsDictionary, any, RcaRequestBody, ParsedQs> = async (req, res, next) => {
  console.log("analyzeRootCauseHandler called");
  try {
    const { nodeId } = req.body;
    if (!nodeId) {
      res.status(400).json({ error: "nodeId is required in the request body." });
      return;
    }
    console.log(`Received request for RCA with nodeId: ${nodeId}`);
    // const result = await runRca(nodeId); // TS2345
    res.status(501).json({ message: "This RCA endpoint (analyzeRootCauseHandler) is deprecated." });
  } catch (error) {
    console.error("Error in analyzeRootCauseHandler:", error);
    next(error); 
  }
}; */

// Renamed to avoid conflict and ensure correct typing for this specific endpoint
/* const analyzeRcaWithNodeIdParamHandler: RequestHandler<{ nodeId: string }, any, RcaWithSubGraphContextRequestBody, ParsedQs> = async (req, res, next) => {
  console.log("analyzeRcaWithNodeIdParamHandler called");
  try {
    const nodeIdFromParams = req.params.nodeId;
    const nodeIdFromBody = req.body.nodeId;
    const nodeIdFromContext = req.body.subgraphContext?.selectedNode?.id;
    
    const effectiveNodeId = nodeIdFromParams || nodeIdFromBody || nodeIdFromContext;

    if (!effectiveNodeId) {
        res.status(400).json({ error: "nodeId (from path, body, or subgraphContext) is required." });
        return;
    }
    console.log(`Received request for RCA with effective nodeId: ${effectiveNodeId}`);
    // const result = await runRca(effectiveNodeId); // TS2345
    res.status(501).json({ message: "This RCA endpoint (analyzeRcaWithNodeIdParamHandler) is deprecated." });
  } catch (error) {
    console.error("Error in analyzeRcaWithNodeIdParamHandler:", error);
    next(error);
  }
}; */

// Explain query handler (currently calls runRca with a placeholder)
/* const explainQueryHandler: RequestHandler<ParamsDictionary, any, ExplainQueryRequestBody, ParsedQs> = async (req, res, next) => {
  console.log("explainQueryHandler called");
  try {
    const query = req.body.query;
    if (!query) {
        res.status(400).json({ error: "query is required in the request body." });
        return;
    }
    console.log(`Received request to explain query: ${query}`);
    // const result = await runRca(query); // TS2345
    res.status(501).json({ message: "This RCA endpoint (explainQueryHandler) is deprecated." });
  } catch (error) {
    console.error("Error in explainQueryHandler:", error);
    next(error);
  }
}; */

// app.post('/api/analyze-root-cause', analyzeRootCauseHandler); // Deprecated
// app.post('/api/rca/:nodeId', analyzeRcaWithNodeIdParamHandler); // Deprecated by newAnalyzeRootCauseHandler then by perform-rca
// app.post('/api/explain-query', explainQueryHandler); // Deprecated


// Define the new RCA route handler as a constant with explicit types
/* const newAnalyzeRootCauseHandler: RequestHandler<ParamsDictionary, any, { subgraphContext: SubgraphContext }, ParsedQs> = async (req, res, next) => {
  console.log('newAnalyzeRootCauseHandler: Received request');
  const { subgraphContext } = req.body;

  if (!subgraphContext) {
    console.error('newAnalyzeRootCauseHandler: Subgraph context is missing in the request body');
    res.status(400).json({ error: 'Subgraph context is required' });
    return next(); 
  }

  console.log('newAnalyzeRootCauseHandler: Subgraph Context:', JSON.stringify(subgraphContext, null, 2));

  try {
    console.log(`newAnalyzeRootCauseHandler: Calling a deprecated version of runRca.`);
    res.status(501).json({ message: "This RCA endpoint (newAnalyzeRootCauseHandler) is deprecated." });
    return next(); 
  } catch (error) {
    console.error('newAnalyzeRootCauseHandler: Error during root cause analysis:', error);
    return next(error); 
  }
}; */

// app.post('/api/rca/:nodeId', newAnalyzeRootCauseHandler); // This was also deprecated by perform-rca

// */
// The above block /* ... */ comments out all deprecated RCA handlers and their registrations.

app.get('/', (req, res): Promise<void> => { 
  res.send('Hello from the backend! Database connection test will run on startup.');
  return Promise.resolve(); 
});

app.get('/api/graph', async (req, res): Promise<void> => { 
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  try {
    client = await pool.connect();
    console.log('GET /api/graph: Successfully connected to database.');

    try {
        const userQueryResult = await client.query("SELECT current_user, session_user;");
        console.log('GET /api/graph: DB User Context:', userQueryResult.rows[0]);
    } catch (e) {
        console.error('GET /api/graph: Error querying current_user/session_user:', e);
    }

    await client.query("SET search_path = ag_catalog, '$user', public;");
    console.log('GET /api/graph: search_path set command executed.');

    try {
        const showPathResult = await client.query("SHOW search_path;");
        console.log('GET /api/graph: Current search_path from SHOW search_path:', showPathResult.rows[0].search_path);
    } catch (e) {
        console.error('GET /api/graph: Error executing SHOW search_path:', e);
    }

    try {
        const pgExtensionResult = await client.query("SELECT * FROM pg_extension WHERE extname = 'age';");
        console.log('GET /api/graph: pg_extension query result for "age":', pgExtensionResult.rows);
        if (pgExtensionResult.rows.length > 0) {
            const extNamespaceOid = pgExtensionResult.rows[0].extnamespace;
            console.log(`GET /api/graph: AGE extension namespace OID: ${extNamespaceOid}`);
            const namespaceCheckResult = await client.query("SELECT nspname FROM pg_namespace WHERE oid = $1;", [extNamespaceOid]);
            if (namespaceCheckResult.rows.length > 0) {
                console.log(`GET /api/graph: Namespace name for OID ${extNamespaceOid}:`, namespaceCheckResult.rows[0].nspname);
            } else {
                console.log(`GET /api/graph: No namespace found for OID ${extNamespaceOid}.`);
            }
        }
    } catch (e) {
        console.error('GET /api/graph: Error querying pg_extension:', e);
    }

    try {
        const sharedLibrariesResult = await client.query("SHOW shared_preload_libraries;");
        console.log('GET /api/graph: shared_preload_libraries:', sharedLibrariesResult.rows);
    } catch (e) {
        console.error('GET /api/graph: Error executing SHOW shared_preload_libraries (this might be a permissions issue, which is okay):', e);
    }

    const nodesQuery = `
      SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string_out
      FROM cypher($$${graphName}$$, $$
          MATCH (v)
          RETURN v
      $$) AS v_data(v agtype);
    `;
    const nodesResult = await client.query<AgEntityRow>(nodesQuery);
    console.log(`GET /api/graph: Fetched ${nodesResult.rowCount} raw node entries (as agtype strings).`);

    const nodes: VisNode[] = nodesResult.rows.map((row: AgEntityRow): VisNode | null => {
      if (!row.ag_vertex_string_out) return null;
      try {
        const parsed = parseAgtypeOutputString(row.ag_vertex_string_out);
        if (!parsed) {
            console.error("GET /api/graph: Failed to parse node string:", row.ag_vertex_string_out);
            return null;
        }
                        
        return {
          id: parsed.id, // parsed.id is now string
          label: parsed.properties.name || parsed.properties.label || parsed.label || parsed.id,
          title: JSON.stringify(parsed.properties, null, 2),
          group: parsed.label,
          properties: parsed.properties,
        };
      } catch (e) {
        console.error("Error processing node row:", row, e);
        return null;
      }
    }).filter((node): node is VisNode => node !== null);
    console.log(`GET /api/graph: Processed ${nodes.length} nodes (IDs stringified).`);

    const edgesQuery = `
      SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string_out
      FROM cypher($$${graphName}$$, $$
          MATCH ()-[e]->()
          RETURN e
      $$) AS e_data(e agtype);
    `;
    const edgesResult = await client.query<AgEntityRow>(edgesQuery);
    console.log(`GET /api/graph: Fetched ${edgesResult.rowCount} raw edge entries (as agtype strings).`);
    
    const processedEdgeStringIds = new Set<string>();

    const edges: VisEdge[] = edgesResult.rows.map((row: AgEntityRow): VisEdge | null => {
      if (!row.ag_edge_string_out) return null;
      try {
        const parsed = parseAgtypeOutputString(row.ag_edge_string_out);
        // parsed.start_id and parsed.end_id are now strings
        if (!parsed || typeof parsed.start_id !== 'string' || typeof parsed.end_id !== 'string') {
            console.error("GET /api/graph: Failed to parse edge string or missing start/end IDs (must be strings):", row.ag_edge_string_out, parsed);
            return null;
        }
        
        const edgeIdString = parsed.id; // parsed.id is now string

        if (processedEdgeStringIds.has(edgeIdString)) {
          console.warn(`GET /api/graph: Duplicate edge ID "${edgeIdString}" found. Skipping this edge.`);
          return null; 
        }
        processedEdgeStringIds.add(edgeIdString);
        
        return {
          id: edgeIdString, 
          from: parsed.start_id, // parsed.start_id is now string
          to: parsed.end_id,   // parsed.end_id is now string
          label: parsed.properties.label || parsed.label, 
          title: JSON.stringify(parsed.properties, null, 2),
          properties: parsed.properties,
        };
      } catch (e) {
        console.error("Error processing edge row:", row, e);
        return null;
      }
    }).filter((edge): edge is VisEdge => edge !== null);
    console.log(`GET /api/graph: Processed ${edges.length} edges (after de-duplication using stringified IDs).`);

    const finalNodeIds = new Set<string>();
    const duplicateNodeIdsDetected: string[] = [];
    for (const node of nodes) { 
      if (finalNodeIds.has(node.id as string)) { 
        duplicateNodeIdsDetected.push(node.id as string);
      }
      finalNodeIds.add(node.id as string);
    }
    if (duplicateNodeIdsDetected.length > 0) {
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      console.error('SERVER-SIDE VERIFICATION: Duplicate NODE IDs detected AFTER DE-DUP (should not happen):', duplicateNodeIdsDetected);
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    }

    const finalEdgeIds = new Set<string>();
    const duplicateEdgeIdsDetected: string[] = [];
    for (const edge of edges) { 
      if (edge.id === undefined) {
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.error('SERVER-SIDE VERIFICATION: Found an edge with undefined ID AFTER processing:', edge);
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        continue; 
      }
      if (finalEdgeIds.has(edge.id as string)) {
        duplicateEdgeIdsDetected.push(edge.id as string);
      }
      finalEdgeIds.add(edge.id as string);
    }
    if (duplicateEdgeIdsDetected.length > 0) {
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
      console.error('SERVER-SIDE VERIFICATION: Duplicate EDGE IDs detected AFTER DE-DUP (should not happen):', duplicateEdgeIdsDetected);
      console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    }

    res.json({ nodes, edges });

  } catch (error) {
    console.error('GET /api/graph: Error fetching graph data:', error);
    res.status(500).json({ error: 'Failed to fetch graph data', details: (error as Error).message });
  } finally {
    if (client) {
      client.release();
      console.log('GET /api/graph: Database client released.');
    }
  }
});

interface CreateNodeBody {
  label: string;
  properties: Record<string, any>;
}

interface NodeParams extends ParamsDictionary {
  id: string;
}

interface UpdateNodeBody {
  properties: Record<string, any>;
}

type CreateNodeResponse = VisNode | { error: string; details?: string };
type UpdateNodeResponse = VisNode | { error: string; details?: string };
type DeleteNodeResponse = { message: string; id: string } | { error: string; details?: string }; 

interface CreateEdgeBody {
  from: string; 
  to: string;   
  label: string;
  properties: Record<string, any>;
}

interface EdgeParams extends ParamsDictionary {
  id: string; 
}

interface UpdateEdgeBody {
  properties: Record<string, any>;
}

type CreateEdgeResponse = VisEdge | { error: string; details?: string };
type UpdateEdgeResponse = VisEdge | { error: string; details?: string };
type DeleteEdgeResponse = { message: string; id: string } | { error: string; details?: string };

interface RcaRequest {
  nodeId: string; 
  nodeData: VisNode; 
}

interface RcaResponse {
  nodeId: string;
  summary: string;
  confidence?: number; 
  error?: string;
}

// Corrected Express handler type definitions and implementation for /api/rca/:nodeId

interface RcaParams extends ParamsDictionary { // Corrected: No 'core.'
  nodeId: string;
}

interface RcaRequestBody {
  nodeData: VisNode; // This is what the client sends
}

// Define the new RCA route handler as a constant with explicit types
/* const newAnalyzeRootCauseHandler: RequestHandler<ParamsDictionary, any, { subgraphContext: SubgraphContext }, ParsedQs> = async (req, res, next) => {
  console.log('newAnalyzeRootCauseHandler: Received request');
  const { subgraphContext } = req.body;

  if (!subgraphContext) {
    console.error('newAnalyzeRootCauseHandler: Subgraph context is missing in the request body');
    res.status(400).json({ error: 'Subgraph context is required' });
    return next(); // Call next after sending response
  }

  console.log('newAnalyzeRootCauseHandler: Subgraph Context:', JSON.stringify(subgraphContext, null, 2));

  const simpleInput = `Analyzing root cause for node: ${subgraphContext.selectedNode.label} (ID: ${subgraphContext.selectedNode.id})`;

  try {
    console.log(`newAnalyzeRootCauseHandler: Calling runSimpleTestGraph with input: "${simpleInput}"`);
    const analysisResult = await runRca(simpleInput);
    console.log('newAnalyzeRootCauseHandler: Analysis result from runSimpleTestGraph:', analysisResult);
    res.json({ analysis: analysisResult });
    return next(); // Call next after sending response
  } catch (error) {
    console.error('newAnalyzeRootCauseHandler: Error during root cause analysis:', error);
    return next(error); // Pass error to next
  }
}; */

// Register the new, correctly typed handler, replacing the old app.post for this route
// app.post('/api/rca/:nodeId', newAnalyzeRootCauseHandler); // This replaces the previous app.post('/api/rca/:nodeId', async (req: Request, res: Response) => { ... });

const createNodeHandler: RequestHandler<ParamsDictionary, CreateNodeResponse, CreateNodeBody, ParsedQs> = async (req, res): Promise<void> => {
  const { label, properties } = req.body;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!label || typeof label !== 'string' || !properties || typeof properties !== 'object') {
    res.status(400).json({ error: 'Label (string) and properties (object) are required.' });
    return;
  }

  const propertiesString = Object.entries(properties)
    .map(([key, value]) => {
      const escapedKey = key.replace(/`/g, '``');
      const cypherKey = (key.includes(' ') || !/^[a-zA-Z_][\w]*$/.test(key)) ? `\`${escapedKey}\`` : escapedKey;
      return `${cypherKey}: ${JSON.stringify(value)}`;
    })
    .join(', ');

  const cypherQuery = `
    SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string_out
    FROM cypher($$${graphName}$$, $$
        CREATE (v:${label} {${propertiesString}})
        RETURN v
    $$) AS v_data(v agtype);
  `;

  try {
    client = await pool.connect();
    console.log('POST /api/node: Successfully connected to database.');
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`POST /api/node: Executing Cypher: ${cypherQuery}`);
    const result = await client.query<AgEntityRow>(cypherQuery);

    if (result.rows.length > 0 && result.rows[0].ag_vertex_string_out) {
      const createdAgNodeString = result.rows[0].ag_vertex_string_out;
      const parsedNode = parseAgtypeOutputString(createdAgNodeString);

      if (!parsedNode) {
        console.error('POST /api/node: Failed to parse created node string:', createdAgNodeString);
        res.status(500).json({ error: 'Failed to parse created node data from database.' });
        return;
      }

      const responseNode: VisNode = {
        id: String(parsedNode.id),
        label: parsedNode.properties.name || parsedNode.properties.label || parsedNode.label || String(parsedNode.id),
        title: JSON.stringify(parsedNode.properties, null, 2),
        group: parsedNode.label,
        properties: parsedNode.properties,
      };
      res.status(201).json(responseNode);
    } else {
      console.error('POST /api/node: Node creation query returned no rows or no ag_vertex_string_out.');
      res.status(500).json({ error: 'Failed to create node; query returned no results or no ag_vertex_string_out.' });
    }
  } catch (error) {
    console.error('POST /api/node: Error creating node:', error);
    res.status(500).json({ error: 'Failed to create node', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.post('/api/node', createNodeHandler);

const getNodeByIdHandler: RequestHandler<NodeParams, VisNode | { error: string; details?: string }, {}, ParsedQs> = async (req, res): Promise<void> => {
  const nodeIdParam = req.params.id; 
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  console.log(`GET /api/node/${nodeIdParam}: Received request for node ID.`);

  let ageNodeInternalId: bigint; 
  try {
    const parts = nodeIdParam.split('.');
    const idStringToParse = parts.length > 1 ? parts[1] : nodeIdParam;
    ageNodeInternalId = BigInt(idStringToParse); 
    
  } catch (e) {
    console.error(`GET /api/node/${nodeIdParam}: Error parsing node ID to BigInt. Original: '${nodeIdParam}'`, e);
    res.status(400).json({ error: `Could not parse node ID to BigInt for Cypher id() function: ${nodeIdParam}` });
    return;
  }

  const getNodeCypherString = `
    MATCH (v)
    WHERE id(v) = ${ageNodeInternalId} 
    RETURN v
  `;

  const finalSql = `
    SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string_out
    FROM cypher($$${graphName}$$, $$ ${getNodeCypherString.replace(/\$\$/g, '$$$$')} $$) AS v_data(v agtype);
  `;

  try {
    client = await pool.connect();
    console.log(`GET /api/node/${nodeIdParam}: Successfully connected to database.`);
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`GET /api/node/${nodeIdParam}: Executing SQL: ${finalSql}`);
    const result = await client.query<AgEntityRow>(finalSql);

    if (result.rows.length > 0 && result.rows[0].ag_vertex_string_out) {
      const agNodeString = result.rows[0].ag_vertex_string_out;
      const parsedNode = parseAgtypeOutputString(agNodeString);

      if (!parsedNode) {
        console.error(`GET /api/node/${nodeIdParam}: Failed to parse node string:`, agNodeString);
        res.status(500).json({ error: 'Failed to parse node data from database.' });
        return;
      }

      const responseNode: VisNode = {
        id: String(parsedNode.id),
        label: parsedNode.properties.name || parsedNode.properties.label || parsedNode.label || String(parsedNode.id),
        title: JSON.stringify(parsedNode.properties, null, 2),
        group: parsedNode.label,
        properties: parsedNode.properties,
      };
      console.log(`GET /api/node/${nodeIdParam}: Node found, returning:`, responseNode);
      res.json(responseNode);
    } else {
      console.warn(`GET /api/node/${nodeIdParam}: Node not found with ID. Query returned no rows or no ag_vertex_string_out.`);
      res.status(404).json({ error: 'Node not found', details: `No node found with ID ${nodeIdParam}` });
    }
  } catch (error) {
    console.error(`GET /api/node/${nodeIdParam}: Error fetching node:`, error);
    res.status(500).json({ error: 'Failed to fetch node', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.get('/api/node/:id', getNodeByIdHandler);

const updateNodeHandler: RequestHandler<NodeParams, UpdateNodeResponse, UpdateNodeBody, ParsedQs> = async (req, res): Promise<void> => {
  const nodeIdParam = req.params.id; 
  const { properties } = req.body;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!properties || typeof properties !== 'object' || Object.keys(properties).length === 0) {
    res.status(400).json({ error: 'Properties (object) to update are required.' });
    return;
  }
    
  const setClauses = Object.entries(properties).map(([key, value]) => {
    const escapedKey = key.replace(/`/g, '``');
    const cypherKey = (key.includes(' ') || !/^[a-zA-Z_][\w]*$/.test(key)) ? `\`${escapedKey}\`` : escapedKey;
    return `v.${cypherKey} = ${JSON.stringify(value)}`;
  }).join(', ');
  
  let ageNodeInternalId: bigint; 
  try {
    const parts = nodeIdParam.split('.');
    const idStringToParse = parts.length > 1 ? parts[1] : nodeIdParam;
    ageNodeInternalId = BigInt(idStringToParse); 
    
  } catch (e) {
    res.status(400).json({ error: `Could not parse node ID to BigInt for Cypher id() function: ${nodeIdParam}` });
    return;
  }

  const updateCypherString = `
    MATCH (v)
    WHERE id(v) = ${ageNodeInternalId} 
    SET ${setClauses}
    RETURN v
  `;

  const finalSql = `
    SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string_out
    FROM cypher($$${graphName}$$, $$ ${updateCypherString.replace(/\$\$/g, '$$$$')} $$) AS v_data(v agtype);
  `;

  try {
    client = await pool.connect();
    console.log(`PUT /api/node/${nodeIdParam}: Successfully connected to database.`);
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`PUT /api/node/${nodeIdParam}: Executing SQL: ${finalSql}`);
    const result = await client.query<AgEntityRow>(finalSql);

    if (result.rows.length > 0 && result.rows[0].ag_vertex_string_out) {
      const updatedAgNodeString = result.rows[0].ag_vertex_string_out;
      const parsedNode = parseAgtypeOutputString(updatedAgNodeString);

      if (!parsedNode) {
        console.error(`PUT /api/node/${nodeIdParam}: Failed to parse updated node string:`, updatedAgNodeString);
        res.status(500).json({ error: 'Failed to parse updated node data from database.' });
        return;
      }

      const responseNode: VisNode = {
        id: String(parsedNode.id),
        label: parsedNode.properties.name || parsedNode.properties.label || parsedNode.label || String(parsedNode.id),
        title: JSON.stringify(parsedNode.properties, null, 2),
        group: parsedNode.label,
        properties: parsedNode.properties,
      };
      res.json(responseNode);
    } else {
      console.warn(`PUT /api/node/${nodeIdParam}: Node not found or update query returned no rows/vertex_string_out.`);
      res.status(404).json({ error: 'Node not found or not updated.' });
    }
  } catch (error) {
    console.error(`PUT /api/node/${nodeIdParam}: Error updating node:`, error);
    res.status(500).json({ error: 'Failed to update node', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.put('/api/node/:id', updateNodeHandler);

const deleteNodeHandler: RequestHandler<NodeParams, DeleteNodeResponse, {}, ParsedQs> = async (req, res): Promise<void> => {
  const nodeIdParam = req.params.id; 
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;
  let ageNodeInternalId: bigint; 

  try {
    const parts = nodeIdParam.split('.');
    const idStringToParse = parts.length > 1 ? parts[1] : nodeIdParam;
    ageNodeInternalId = BigInt(idStringToParse); 

  } catch (e) {
    res.status(400).json({ error: `Could not parse node ID to BigInt for Cypher id() function: ${nodeIdParam}` });
    return;
  }

  const deleteCypherString = `
    MATCH (v)
    WHERE id(v) = ${ageNodeInternalId} 
    DETACH DELETE v
    RETURN '${nodeIdParam}' 
  `;

  const finalSql = `
    SELECT result_data.id_string AS deleted_node_id
    FROM cypher($$${graphName}$$, $$ ${deleteCypherString.replace(/\$\$/g, '$$$$')} $$) AS result_data(id_string agtype);
  `;

  try {
    client = await pool.connect();
    console.log(`DELETE /api/node/${nodeIdParam}: Successfully connected to database.`);
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`DELETE /api/node/${nodeIdParam}: Executing SQL: ${finalSql}`);
    const result = await client.query<{ deleted_node_id: string }>(finalSql);

    if (result.rows.length > 0 && result.rows[0].deleted_node_id === `"${nodeIdParam}"` ) { 
      console.log(`DELETE /api/node/${nodeIdParam}: Node deleted successfully.`);
      res.json({ message: 'Node deleted successfully', id: nodeIdParam });
    } else {
      console.warn(`DELETE /api/node/${nodeIdParam}: Node not found or not deleted. Cypher query may not have matched.`);
      res.status(404).json({ error: 'Node not found or not deleted.', details: `Node ID ${nodeIdParam} may not exist or was already deleted.` });
    }
  } catch (error) {
    console.error(`DELETE /api/node/${nodeIdParam}: Error deleting node:`, error);
    res.status(500).json({ error: 'Failed to delete node', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.delete('/api/node/:id', deleteNodeHandler);

const createEdgeHandler: RequestHandler<ParamsDictionary, CreateEdgeResponse, CreateEdgeBody, ParsedQs> = async (req, res): Promise<void> => {
  const { from, to, label, properties } = req.body;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!from || !to || !label || typeof label !== 'string' || !properties || typeof properties !== 'object') {
    res.status(400).json({ error: 'From node ID (string), to node ID (string), label (string), and properties (object) are required.' });
    return;
  }

  let fromNodeInternalId: bigint;
  let toNodeInternalId: bigint;

  try {
    fromNodeInternalId = BigInt(from);
    toNodeInternalId = BigInt(to);
  } catch (e) {
    console.error('POST /api/edge: Error parsing from/to node IDs to BigInt.', e);
    res.status(400).json({ error: 'Invalid from/to node ID format. Must be string representation of a number.', details: (e as Error).message });
    return;
  }

  const propertiesString = Object.entries(properties)
    .map(([key, value]) => {
      const escapedKey = key.replace(/`/g, '``');
      const cypherKey = (key.includes(' ') || !/^[a-zA-Z_][\\w]*$/.test(key)) ? `\\\`${escapedKey}\\\`` : escapedKey;
      return `${cypherKey}: ${JSON.stringify(value)}`;
    })
    .join(', ');

  const createEdgeCypherString = `
    MATCH (a), (b)
    WHERE id(a) = ${fromNodeInternalId} AND id(b) = ${toNodeInternalId}
    CREATE (a)-[e:${label} {${propertiesString}}]->(b)
    RETURN e
  `;

  const finalSql = `
    SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string_out
    FROM cypher($$${graphName}$$, $$ ${createEdgeCypherString.replace(/\\$\\$/g, '$$$$')} $$) AS e_data(e agtype);
  `;

  try {
    client = await pool.connect();
    console.log('POST /api/edge: Successfully connected to database.');
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`POST /api/edge: Executing SQL: ${finalSql}`);
    const result = await client.query<AgEntityRow>(finalSql);

    if (result.rows.length > 0 && result.rows[0].ag_edge_string_out) {
      const createdAgEdgeString = result.rows[0].ag_edge_string_out;
      const parsedEdge = parseAgtypeOutputString(createdAgEdgeString);

      if (!parsedEdge || typeof parsedEdge.start_id !== 'string' || typeof parsedEdge.end_id !== 'string') {
        console.error('POST /api/edge: Failed to parse created edge string or missing start/end IDs:', createdAgEdgeString, parsedEdge);
        res.status(500).json({ error: 'Failed to parse created edge data from database.' });
        return;
      }

      const responseEdge: VisEdge = {
        id: String(parsedEdge.id),
        from: String(parsedEdge.start_id),
        to: String(parsedEdge.end_id),
        label: parsedEdge.properties.label || parsedEdge.label,
        title: JSON.stringify(parsedEdge.properties, null, 2),
        properties: parsedEdge.properties,
      };
      res.status(201).json(responseEdge);
    } else {
      console.error('POST /api/edge: Edge creation query returned no rows or no ag_edge_string_out. Check if source/target nodes exist.');
      res.status(500).json({ error: 'Failed to create edge; query returned no results or no ag_edge_string_out. Source or target nodes might not exist.' });
    }
  } catch (error) {
    console.error('POST /api/edge: Error creating edge:', error);
    res.status(500).json({ error: 'Failed to create edge', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.post('/api/edge', createEdgeHandler);

const getEdgeByIdHandler: RequestHandler<EdgeParams, VisEdge | { error: string; details?: string }, {}, ParsedQs> = async (req, res): Promise<void> => {
  const edgeIdParam = req.params.id;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;
  let ageEdgeInternalId: bigint;

  console.log(`GET /api/edge/${edgeIdParam}: Received request for edge ID.`);

  try {
    ageEdgeInternalId = BigInt(edgeIdParam);
  } catch (e) {
    console.error(`GET /api/edge/${edgeIdParam}: Error parsing edge ID to BigInt. Original: '${edgeIdParam}'`, e);
    res.status(400).json({ error: `Could not parse edge ID to BigInt for Cypher id() function: ${edgeIdParam}` });
    return;
  }

  const getEdgeCypherString = `
    MATCH ()-[e]->()
    WHERE id(e) = ${ageEdgeInternalId}
    RETURN e
  `;

  const finalSql = `
    SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string_out
    FROM cypher($$${graphName}$$, $$ ${getEdgeCypherString.replace(/\\$\\$/g, '$$$$')} $$) AS e_data(e agtype);
  `;

  try {
    client = await pool.connect();
    console.log(`GET /api/edge/${edgeIdParam}: Successfully connected to database.`);
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`GET /api/edge/${edgeIdParam}: Executing SQL: ${finalSql}`);
    const result = await client.query<AgEntityRow>(finalSql);

    if (result.rows.length > 0 && result.rows[0].ag_edge_string_out) {
      const agEdgeString = result.rows[0].ag_edge_string_out;
      const parsedEdge = parseAgtypeOutputString(agEdgeString);

      if (!parsedEdge || typeof parsedEdge.start_id !== 'string' || typeof parsedEdge.end_id !== 'string') {
        console.error(`GET /api/edge/${edgeIdParam}: Failed to parse edge string or missing start/end IDs:`, agEdgeString, parsedEdge);
        res.status(500).json({ error: 'Failed to parse edge data from database.' });
        return;
      }

      const responseEdge: VisEdge = {
        id: String(parsedEdge.id),
        from: String(parsedEdge.start_id),
        to: String(parsedEdge.end_id),
        label: parsedEdge.properties.label || parsedEdge.label,
        title: JSON.stringify(parsedEdge.properties, null, 2),
        properties: parsedEdge.properties,
      };
      console.log(`GET /api/edge/${edgeIdParam}: Edge found, returning:`, responseEdge);
      res.json(responseEdge);
    } else {
      console.warn(`GET /api/edge/${edgeIdParam}: Edge not found with ID. Query returned no rows or no ag_edge_string_out.`);
      res.status(404).json({ error: 'Edge not found', details: `No edge found with ID ${edgeIdParam}` });
    }
  } catch (error) {
    console.error(`GET /api/edge/${edgeIdParam}: Error fetching edge:`, error);
    res.status(500).json({ error: 'Failed to fetch edge', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.get('/api/edge/:id', getEdgeByIdHandler);

const updateEdgeHandler: RequestHandler<EdgeParams, UpdateEdgeResponse, UpdateEdgeBody, ParsedQs> = async (req, res): Promise<void> => {
  const edgeIdParam = req.params.id;
  const { properties } = req.body;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;
  let ageEdgeInternalId: bigint;

  if (!properties || typeof properties !== 'object' || Object.keys(properties).length === 0) {
    res.status(400).json({ error: 'Properties (object) to update are required.' });
    return;
  }

  try {
    ageEdgeInternalId = BigInt(edgeIdParam);
  } catch (e) {
    res.status(400).json({ error: `Could not parse edge ID to BigInt for Cypher id() function: ${edgeIdParam}` });
    return;
  }

  const setClauses = Object.entries(properties).map(([key, value]) => {
    const escapedKey = key.replace(/`/g, '``');
    const cypherKey = (key.includes(' ') || !/^[a-zA-Z_][\\w]*$/.test(key)) ? `\\\`${escapedKey}\\\`` : escapedKey;
    return `e.${cypherKey} = ${JSON.stringify(value)}`;
  }).join(', ');

  const updateEdgeCypherString = `
    MATCH ()-[e]->()
    WHERE id(e) = ${ageEdgeInternalId}
    SET ${setClauses}
    RETURN e
  `;

  const finalSql = `
    SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string_out
    FROM cypher($$${graphName}$$, $$ ${updateEdgeCypherString.replace(/\\$\\$/g, '$$$$')} $$) AS e_data(e agtype);
  `;

  try {
    client = await pool.connect();
    console.log(`PUT /api/edge/${edgeIdParam}: Successfully connected to database.`);
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`PUT /api/edge/${edgeIdParam}: Executing SQL: ${finalSql}`);
    const result = await client.query<AgEntityRow>(finalSql);

    if (result.rows.length > 0 && result.rows[0].ag_edge_string_out) {
      const updatedAgEdgeString = result.rows[0].ag_edge_string_out;
      const parsedEdge = parseAgtypeOutputString(updatedAgEdgeString);

      if (!parsedEdge || typeof parsedEdge.start_id !== 'string' || typeof parsedEdge.end_id !== 'string') {
        console.error(`PUT /api/edge/${edgeIdParam}: Failed to parse updated edge string or missing start/end IDs:`, updatedAgEdgeString, parsedEdge);
        res.status(500).json({ error: 'Failed to parse updated edge data from database.' });
        return;
      }

      const responseEdge: VisEdge = {
        id: String(parsedEdge.id),
        from: String(parsedEdge.start_id),
        to: String(parsedEdge.end_id),
        label: parsedEdge.properties.label || parsedEdge.label,
        title: JSON.stringify(parsedEdge.properties, null, 2),
        properties: parsedEdge.properties,
      };
      res.json(responseEdge);
    } else {
      console.warn(`PUT /api/edge/${edgeIdParam}: Edge not found or update query returned no rows/edge_string_out.`);
      res.status(404).json({ error: 'Edge not found or not updated.' });
    }
  } catch (error) {
    console.error(`PUT /api/edge/${edgeIdParam}: Error updating edge:`, error);
    res.status(500).json({ error: 'Failed to update edge', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.put('/api/edge/:id', updateEdgeHandler);

const deleteEdgeHandler: RequestHandler<EdgeParams, DeleteEdgeResponse, {}, ParsedQs> = async (req, res): Promise<void> => {
  const edgeIdParam = req.params.id;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;
  let ageEdgeInternalId: bigint;

  try {
    ageEdgeInternalId = BigInt(edgeIdParam);
  } catch (e) {
    res.status(400).json({ error: `Could not parse edge ID to BigInt for Cypher id() function: ${edgeIdParam}` });
    return;
  }

  const deleteEdgeCypherString = `
    MATCH ()-[e]->()
    WHERE id(e) = ${ageEdgeInternalId}
    DELETE e
    RETURN '${edgeIdParam}' 
  `;

  const finalSql = `
    SELECT result_data.id_string AS deleted_edge_id 
    FROM cypher($$${graphName}$$, $$ ${deleteEdgeCypherString.replace(/\$\$/g, '$$$$')} $$) AS result_data(id_string agtype);
  `;
  
  try {
    client = await pool.connect();
    console.log(`DELETE /api/edge/${edgeIdParam}: Successfully connected to database.`);
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`DELETE /api/edge/${edgeIdParam}: Executing SQL: ${finalSql}`);
    const result = await client.query<{ deleted_edge_id: string }>(finalSql);

    if (result.rows.length > 0 && result.rows[0].deleted_edge_id === `"${edgeIdParam}"`) {
      console.log(`DELETE /api/edge/${edgeIdParam}: Edge deleted successfully.`);
      res.json({ message: 'Edge deleted successfully', id: edgeIdParam });
    } else {
      console.warn(`DELETE /api/edge/${edgeIdParam}: Edge not found or not deleted. Cypher query may not have matched. Result:`, result.rows);
      res.status(404).json({ error: 'Edge not found or not deleted.', details: `Edge ID ${edgeIdParam} may not exist or was already deleted.` });
    }
  } catch (error) {
    console.error(`DELETE /api/edge/${edgeIdParam}: Error deleting edge:`, error);
    res.status(500).json({ error: 'Failed to delete edge', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.delete('/api/edge/:id', deleteEdgeHandler);

interface SearchQuery extends ParsedQs {
  term: string;
}

app.get('/api/search', async (req: express.Request<ParamsDictionary, GraphData | { error: string; details?: string }, {}, SearchQuery>, res: express.Response<GraphData | { error: string; details?: string }>): Promise<void> => {
  const searchTerm = req.query.term;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!searchTerm) {
    res.status(400).json({ error: 'Search term is required' });
    return;
  }

  console.log(`GET /api/search: Received search request for term: "${searchTerm}"`);

  const nodeSearchQuery = `
    SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string_out
    FROM cypher($$${graphName}$$, $$
        MATCH (v)
        WHERE (
          ANY(propKey IN keys(properties(v)) WHERE toString(properties(v)[propKey]) CONTAINS '${searchTerm.replace(/'/g, '\'\'')}') OR
          ANY(lbl IN labels(v) WHERE lbl CONTAINS '${searchTerm.replace(/'/g, '\'\'')}')
        )
        RETURN v
    $$) AS v_data(v agtype);
  `;

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`GET /api/search: Executing Node Search SQL: ${nodeSearchQuery}`);
    const nodesResult = await client.query<AgEntityRow>(nodeSearchQuery);
    console.log(`GET /api/search: Fetched ${nodesResult.rowCount} raw node entries from search (as agtype strings).`);

    const foundNodes: VisNode[] = nodesResult.rows.map((row: AgEntityRow): VisNode | null => {
      if (!row.ag_vertex_string_out) return null; 
      try {
        const parsed = parseAgtypeOutputString(row.ag_vertex_string_out); 
        if (!parsed) {
            console.error("GET /api/search: Failed to parse searched node string:", row.ag_vertex_string_out);
            return null;
        }
        
        return {
          id: String(parsed.id), 
          label: parsed.properties.name || parsed.properties.label || parsed.label || String(parsed.id),
          title: JSON.stringify(parsed.properties, null, 2),
          group: parsed.label,
          properties: parsed.properties,
        };
      } catch (e) {
        console.error("Error processing searched node row:", row, e);
        return null;
      }
    }).filter((node): node is VisNode => node !== null);
    console.log(`GET /api/search: Processed ${foundNodes.length} nodes from search.`);

    res.json({ nodes: foundNodes, edges: [] });

  } catch (error) {
    console.error(`GET /api/search: Error during search for term "${searchTerm}":`, error);
    res.status(500).json({ error: 'Failed to perform search', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
});

interface SearchNodesByPropertyQuery extends ParsedQs {
  property: string;
  value: string;
}

const searchNodesByPropertyHandler: RequestHandler<ParamsDictionary, GraphData | { error: string; details?: string }, {}, SearchNodesByPropertyQuery> = async (req, res): Promise<void> => {
  const { property, value } = req.query;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!property || !value) {
    res.status(400).json({ error: 'Property and value query parameters are required for search.' });
    return;
  }

  const safeProperty = String(property).replace(/[^a-zA-Z0-9_]/g, '');
  if (!safeProperty) {
    res.status(400).json({ error: 'Invalid property name for search.' });
    return;
  }

  const searchCypherString = `
    MATCH (v)
    WHERE toLower(toString(v.${safeProperty})) CONTAINS toLower($value)
    RETURN v
  `;

  const finalSql = `
    SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string_out
    FROM cypher(
      $$${graphName}$$, 
      $$ ${searchCypherString.replace(/\$\$/g, '$$$$')} $$,
      $$ { "value": ${JSON.stringify(String(value))} } $$ 
    ) AS v_data(v agtype);
  `;

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`GET /api/nodes/search: Executing SQL: ${finalSql}`);
    const nodesResult = await client.query<AgEntityRow>(finalSql);
    console.log(`GET /api/nodes/search: Fetched ${nodesResult.rowCount} raw node entries from search (as agtype strings).`);

    const foundNodes: VisNode[] = nodesResult.rows.map((row: AgEntityRow): VisNode | null => {
      if (!row.ag_vertex_string_out) return null; 
      try {
        const parsed = parseAgtypeOutputString(row.ag_vertex_string_out); 
         if (!parsed) {
            console.error("GET /api/nodes/search: Failed to parse searched node string:", row.ag_vertex_string_out);
            return null;
        }
        
        return {
          id: String(parsed.id), 
          label: parsed.properties.name || parsed.properties.label || parsed.label || String(parsed.id),
          title: JSON.stringify(parsed.properties, null, 2),
          group: parsed.label,
          properties: parsed.properties,
        };
      } catch (e) {
        console.error("Error processing searched node row:", row, e);
        return null;
      }
    }).filter((node): node is VisNode => node !== null);
    console.log(`GET /api/nodes/search: Processed ${foundNodes.length} nodes from search.`);

    res.json({ nodes: foundNodes, edges: [] });

  } catch (error) {
    console.error(`GET /api/nodes/search: Error during search for property "${property}" and value "${value}":`, error);
    res.status(500).json({ error: 'Failed to search nodes', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.get('/api/nodes/search', searchNodesByPropertyHandler); 

app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log('Testing database connection and AGE setup...');
  testDatabaseConnection();
});

// Updated RCA handler that expects ServiceRcaRequest in the body
const rootCauseAnalysisHandler: RequestHandler<ParamsDictionary, RcaResult, ServiceRcaRequest, ParsedQs> = async (req, res, next) => {
  console.log('[Server] rootCauseAnalysisHandler: Received request');
  const rcaRequestBody = req.body;

  if (!rcaRequestBody || !rcaRequestBody.selectedNode) {
    console.error('[Server] rootCauseAnalysisHandler: ServiceRcaRequest object with selectedNode is missing in the request body');
    const errorPayload: RcaResult = {
        analyzedNodeId: rcaRequestBody?.selectedNode?.id || 'unknown',
        summary: 'Request validation failed: ServiceRcaRequest object with selectedNode is required in the request body.',
        failureModes: [],
        overallConfidence: 0,
        timestamp: new Date().toISOString()
    };
    res.status(400).json(errorPayload);
    return; 
  }

  console.log('[Server] rootCauseAnalysisHandler: ServiceRcaRequest Body:', JSON.stringify(rcaRequestBody, null, 2));

  try {
    console.log(`[Server] rootCauseAnalysisHandler: Calling runRca for node: ${rcaRequestBody.selectedNode.label}`);
    const analysisResult: RcaResult = await runRca(rcaRequestBody);
    console.log('[Server] rootCauseAnalysisHandler: Analysis result from runRca:', analysisResult);
    res.json(analysisResult);
  } catch (error) {
    console.error('[Server] rootCauseAnalysisHandler: Error during root cause analysis:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    const errorResponse: RcaResult = {
      analyzedNodeId: rcaRequestBody.selectedNode.id,
      summary: `Error during RCA: ${errorMessage}`,
      failureModes: [{
        mode: "ExecutionError",
        description: `Error during root cause analysis: ${errorMessage}`,
        potentialCauses: [],
        recommendedSolutions: []
      }],
      overallConfidence: 0,
      timestamp: new Date().toISOString(),
    };
    res.status(500).json(errorResponse);
  }
};

// Register the new handler.
app.post('/api/perform-rca', rootCauseAnalysisHandler);

// Comment out or remove the old local RcaRequest interface to resolve conflict
/*
interface RcaRequest { // This was conflicting
  nodeId: string; 
  nodeData: VisNode; 
}
*/

// ...existing code...
app.post('/api/node', createNodeHandler);
// ...existing code...
