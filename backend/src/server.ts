console.log('########## EXECUTING backend/src/server.ts ##########');
import express, { Express, RequestHandler, Response } from 'express'; // Added Response for explicit typing
import { Pool, PoolConfig } from 'pg';
import cors from 'cors';
import dotenv from 'dotenv';
import { ParsedQs } from 'qs';
import { ParamsDictionary } from 'express-serve-static-core';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Type definitions for Vis Network (matching frontend)
interface VisNode {
  id: string; // Changed from number | string
  label?: string;
  title?: string;
  group?: string;
  properties?: Record<string, any>;
  x?: number;
  y?: number;
  fixed?: boolean;
}

interface VisEdge {
  id?: string; // Changed from number | string, and ensure it's always string if present
  from: string; // Changed from number | string
  to: string;   // Changed from number | string
  label?: string;
  title?: string;
  properties?: Record<string, any>;
}

interface GraphData {
  nodes: VisNode[];
  edges: VisEdge[];
}

// --- SSL Configuration: Load a single CA certificate bundle ---
const caBundleFilename = 'bundle.pem'; // The concatenated bundle of all three CAs
const caBundlePath = path.join(__dirname, '..', 'src', caBundleFilename);

let sslOptions: PoolConfig['ssl'] = { rejectUnauthorized: true }; // Default to secure

console.log(`Attempting to load CA certificate bundle: ${caBundleFilename} from backend/src/ directory...`);
if (fs.existsSync(caBundlePath)) {
  try {
    const caContent = fs.readFileSync(caBundlePath).toString();
    console.warn('!!!! INSECURE DEVELOPMENT MODE !!!! Forcing rejectUnauthorized to false. DO NOT USE IN PRODUCTION. Revert this change after testing and before any deployment.');
    sslOptions = {
      rejectUnauthorized: false,       // INSECURE: Bypass certificate verification for E2E testing
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
      rejectUnauthorized: false, // INSECURE: Bypass certificate verification for E2E testing
      servername: process.env.DB_HOST 
    }; 
  }
} else {
  console.warn(
    `CRITICAL: SSL CA certificate bundle '${caBundleFilename}' not found at '${caBundlePath}'. ` +
    `!!!! INSECURE DEVELOPMENT MODE !!!! Forcing rejectUnauthorized to false. DO NOT USE IN PRODUCTION. Revert this change after testing and before any deployment.`
  );
  sslOptions = {
    rejectUnauthorized: false, // INSECURE: Bypass certificate verification for E2E testing
    servername: process.env.DB_HOST 
  };
}
// To disable SSL/TLS, set ssl to false or an object that results in it being disabled.
// For node-postgres, setting ssl: false should disable TLS.
// If connecting to a local instance or one that doesn't require/enforce SSL:
// const sslOptions: PoolConfig['ssl'] = false; 
// console.log("SSL/TLS is explicitly disabled for the database connection.");
// --- End SSL Configuration ---

// Database connection setup
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
  ssl: sslOptions, // Use the configured SSL settings
});

// Helper to parse AGE agtype values

// Intermediate type for parsed agtype_out string
interface ParsedAgEntity {
  id: number; // This is the numeric internal ID
  label: string;
  properties: Record<string, any>;
  // For edges
  start_id?: number; // Numeric internal ID
  end_id?: number;   // Numeric internal ID
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
    // Use the simpler regex from SulfurGraphExplorer
    const jsonString = trimmedString.replace(/::\w+$/, ''); 
    console.log('parseAgtypeOutputString: String after regex replace (attempting to parse as JSON):', jsonString);

    const parsed = JSON.parse(jsonString);

    // Basic validation
    if (parsed === null || typeof parsed !== 'object') {
        console.error('parseAgtypeOutputString: Parsed data is not an object or is null:', parsed, 'Original agtypeString:', agtypeString, 'jsonString:', jsonString);
        return null;
    }
    if (typeof parsed.id !== 'number' || typeof parsed.label !== 'string' || typeof parsed.properties !== 'object') {
        console.error('parseAgtypeOutputString: Parsed object missing required fields (id (number), label (string), properties (object)):', parsed, 'Original agtypeString:', agtypeString, 'jsonString:', jsonString);
        return null;
    }
    // For edges, start_id and end_id are expected
    // Check trimmedString for '::edge' as jsonString has it removed
    if (trimmedString.includes('::edge') || ('start_id' in parsed || 'end_id' in parsed)) { 
        if (typeof parsed.start_id !== 'number' || typeof parsed.end_id !== 'number') {
            console.error('parseAgtypeOutputString: Parsed edge object has invalid or missing start_id/end_id (must be numbers):', parsed, 'Original agtypeString:', agtypeString, 'jsonString:', jsonString);
            return null;
        }
    }
    console.log('parseAgtypeOutputString: Successfully parsed:', parsed);
    return parsed as ParsedAgEntity;
  } catch (e) {
    // Log the string that failed to parse along with the original agtype string
    const stringThatFailedParse = agtypeString.trim().replace(/::\w+$/, '');
    console.error('parseAgtypeOutputString: Error during JSON.parse or validation. Original agtypeString:', agtypeString, 'Attempted to parse (jsonString):', stringThatFailedParse, 'Error:', e);
    return null;
  }
}


// Define a type for the JSON response from agtype_to_json
// NO LONGER USED - Replaced by ParsedAgEntity and manual parsing
/*
interface AgJsonResponseBase {
  id: string; 
  label: string;
  properties: Record<string, any>;
}
interface AgJsonNodeResponse extends AgJsonResponseBase {}
interface AgJsonEdgeResponse extends AgJsonResponseBase {
  start_id: string; 
  end_id: string;   
}
type AgJsonResponse = AgJsonNodeResponse | AgJsonEdgeResponse;
*/

// REMOVE THE parseAgTypeValue function as it's no longer needed
// function parseAgTypeValue(value: string): AgTypeNode | AgTypeEdge | null { ... }

// Type for rows from node/edge queries
interface AgEntityRow {
  ag_vertex_string_out?: string; // Changed from ag_vertex_jsonb
  ag_edge_string_out?: string;   // Changed from ag_edge_jsonb
  // Fields for direct values if not using jsonb objects (e.g. for count or simple returns)
  node_count?: any; // Keep for count queries
  deleted_node_id?: string; // Keep for delete confirmation
  deleted_edge_id?: string; // Keep for delete confirmation
  // Removed id, label, properties, start_id, end_id, start_label, end_label as they will be in the parsed string
}

// Function to test database connection and AGE setup
async function testDatabaseConnection() {
  let client;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph'; // Define graphName here
  try {
    client = await pool.connect(); // Initialize client
    console.log('testDatabaseConnection: Successfully connected to database.');
    await client.query("SET search_path = ag_catalog, '$user', public;"); // Set search_path
    console.log('testDatabaseConnection: search_path set.');

    // Test ag_catalog.age_version()
    /* // Commenting out due to function not existing in Azure AGE 1.5.0
    try {
      const versionResult = await client.query("SELECT ag_catalog.age_version();");
      console.log('testDatabaseConnection: ag_catalog.age_version() result:', versionResult.rows);
    } catch (e) {
      console.error('testDatabaseConnection: Error calling ag_catalog.age_version():', e);
    }
    */

    const cypherQuery = `SELECT * from cypher('${graphName}', $$ MATCH (n) RETURN n LIMIT 1 $$) as (n agtype);`; // Added LIMIT 1
    console.log(`Executing test Cypher query: ${cypherQuery}`);
    const res = await client.query(cypherQuery);
    console.log('Test Cypher query executed. Results:', res.rows);
    if (res.rows.length > 0 && res.rows[0].n) { // Check res.rows[0].n
      console.log('Successfully fetched data with AGE. Raw agtype:', res.rows[0].n);
      // Test ag_catalog.agtype_to_json() with the fetched agtype in a combined query
      // Modify this test to use agtype_out and the new parser
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

app.use(cors());
app.use(express.json());

app.get('/', (req, res): Promise<void> => { // Explicit Promise<void> for consistency
  res.send('Hello from the backend! Database connection test will run on startup.');
  return Promise.resolve(); // Explicitly return a resolved promise for void
});

// Define a new route for fetching graph data
app.get('/api/graph', async (req, res): Promise<void> => { // Explicit Promise<void>
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  try {
    client = await pool.connect();
    console.log('GET /api/graph: Successfully connected to database.');

    // Log current_user and session_user
    try {
        const userQueryResult = await client.query("SELECT current_user, session_user;");
        console.log('GET /api/graph: DB User Context:', userQueryResult.rows[0]);
    } catch (e) {
        console.error('GET /api/graph: Error querying current_user/session_user:', e);
    }

    await client.query("SET search_path = ag_catalog, '$user', public;");
    console.log('GET /api/graph: search_path set command executed.');

    // Log the actual search_path
    try {
        const showPathResult = await client.query("SHOW search_path;");
        console.log('GET /api/graph: Current search_path from SHOW search_path:', showPathResult.rows[0].search_path);
    } catch (e) {
        console.error('GET /api/graph: Error executing SHOW search_path:', e);
    }

    // Additional Diagnostics (pg_extension and shared_preload_libraries are still useful)
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
    // End Additional Diagnostics

    // Pre-flight check: Execute a simple Cypher query to ensure cypher() function is accessible

    // Fetch nodes
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
          id: String(parsed.id), // Ensure ID is a string for VisNode
          label: parsed.properties.name || parsed.properties.label || parsed.label || String(parsed.id),
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

    // Fetch edges
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
        if (!parsed || typeof parsed.start_id !== 'number' || typeof parsed.end_id !== 'number') {
            console.error("GET /api/graph: Failed to parse edge string or missing start/end IDs:", row.ag_edge_string_out, parsed);
            return null;
        }
        
        const edgeIdString = String(parsed.id); // Ensure edge ID is a string

        if (processedEdgeStringIds.has(edgeIdString)) {
          console.warn(`GET /api/graph: Duplicate edge ID (stringified) "${edgeIdString}" found. Original raw ID from DB: ${parsed.id}. Skipping this edge.`);
          return null; 
        }
        processedEdgeStringIds.add(edgeIdString);
        
        return {
          id: edgeIdString, // Use the stringified ID for VisEdge
          from: String(parsed.start_id), // Ensure from ID is a string for VisEdge
          to: String(parsed.end_id),   // Ensure to ID is a string for VisEdge
          label: parsed.properties.label || parsed.label, // Prefer property 'label' if exists, else agtype label
          title: JSON.stringify(parsed.properties, null, 2),
          properties: parsed.properties,
        };
      } catch (e) {
        console.error("Error processing edge row:", row, e);
        return null;
      }
    }).filter((edge): edge is VisEdge => edge !== null);
    console.log(`GET /api/graph: Processed ${edges.length} edges (after de-duplication using stringified IDs).`);

    // --- SERVER-SIDE DUPLICATE ID VERIFICATION CHECK (POST-DEPLICATION) ---
    // This check should ideally find no duplicates now as IDs are stringified and de-duplicated.
    const finalNodeIds = new Set<string>();
    const duplicateNodeIdsDetected: string[] = [];
    for (const node of nodes) { // nodes now have string IDs
      if (finalNodeIds.has(node.id as string)) { // node.id is already string
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
    for (const edge of edges) { // edges now have string IDs and are de-duplicated
      if (edge.id === undefined) {
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        console.error('SERVER-SIDE VERIFICATION: Found an edge with undefined ID AFTER processing:', edge);
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
        continue; // Skip this edge
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
    // --- END SERVER-SIDE DUPLICATE ID VERIFICATION CHECK ---

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

// Define interfaces for request parts
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

// Response types for CRUD operations
type CreateNodeResponse = VisNode | { error: string; details?: string };
type UpdateNodeResponse = VisNode | { error: string; details?: string };
type DeleteNodeResponse = { message: string; id: string } | { error: string; details?: string }; // Changed id to string

// --- Edge CRUD --- 

// Request types for Edge CRUD operations
// UNCOMMENTED AND WILL BE USED
interface CreateEdgeBody {
  from: string; // Source node graph ID (stringified internal numeric ID)
  to: string;   // Target node graph ID (stringified internal numeric ID)
  label: string;
  properties: Record<string, any>;
}

interface EdgeParams extends ParamsDictionary {
  id: string; // Edge graph ID (stringified internal numeric ID)
}

interface UpdateEdgeBody {
  properties: Record<string, any>;
}

// Response types for Edge CRUD operations
// UNCOMMENTED AND WILL BE USED
type CreateEdgeResponse = VisEdge | { error: string; details?: string };
type UpdateEdgeResponse = VisEdge | { error: string; details?: string };
type DeleteEdgeResponse = { message: string; id: string } | { error: string; details?: string };


// Create Node
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

// Fetch Node by ID
const getNodeByIdHandler: RequestHandler<NodeParams, VisNode | { error: string; details?: string }, {}, ParsedQs> = async (req, res): Promise<void> => {
  const nodeIdParam = req.params.id; 
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  console.log(`GET /api/node/${nodeIdParam}: Received request for node ID.`);

  let ageNodeInternalId: bigint; // Use BigInt for precision with id()
  try {
    const parts = nodeIdParam.split('.');
    const idStringToParse = parts.length > 1 ? parts[1] : nodeIdParam;
    ageNodeInternalId = BigInt(idStringToParse); // Parse to BigInt
    
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

// Update Node
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
  
  let ageNodeInternalId: bigint; // Use BigInt
  try {
    const parts = nodeIdParam.split('.');
    const idStringToParse = parts.length > 1 ? parts[1] : nodeIdParam;
    ageNodeInternalId = BigInt(idStringToParse); // Parse to BigInt
    
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

// Delete Node
const deleteNodeHandler: RequestHandler<NodeParams, DeleteNodeResponse, {}, ParsedQs> = async (req, res): Promise<void> => {
  const nodeIdParam = req.params.id; 
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;
  let ageNodeInternalId: bigint; // Use BigInt

  try {
    const parts = nodeIdParam.split('.');
    const idStringToParse = parts.length > 1 ? parts[1] : nodeIdParam;
    ageNodeInternalId = BigInt(idStringToParse); // Parse to BigInt

  } catch (e) {
    res.status(400).json({ error: `Could not parse node ID to BigInt for Cypher id() function: ${nodeIdParam}` });
    return;
  }

  const deleteCypherString = `
    MATCH (v)
    WHERE id(v) = ${ageNodeInternalId} // Use BigInt in query
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
      // It's important to send a response back to the client in this case too.
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

// --- Edge CRUD Handlers ---

// Create Edge
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
    // Assuming 'from' and 'to' are string representations of the numeric AGE IDs
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

      if (!parsedEdge || typeof parsedEdge.start_id !== 'number' || typeof parsedEdge.end_id !== 'number') {
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


// Fetch Edge by ID
const getEdgeByIdHandler: RequestHandler<EdgeParams, VisEdge | { error: string; details?: string }, {}, ParsedQs> = async (req, res): Promise<void> => {
  const edgeIdParam = req.params.id;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;
  let ageEdgeInternalId: bigint;

  console.log(`GET /api/edge/${edgeIdParam}: Received request for edge ID.`);

  try {
    // Assuming edgeIdParam is a string representation of the numeric AGE ID
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

      if (!parsedEdge || typeof parsedEdge.start_id !== 'number' || typeof parsedEdge.end_id !== 'number') {
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


// Update Edge
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

      if (!parsedEdge || typeof parsedEdge.start_id !== 'number' || typeof parsedEdge.end_id !== 'number') {
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


// Delete Edge
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

  // Return the original edgeIdParam (string) if successful, to match node deletion pattern
  const deleteEdgeCypherString = `
    MATCH ()-[e]->()
    WHERE id(e) = ${ageEdgeInternalId}
    DELETE e
    RETURN '${edgeIdParam}' 
  `;

  const finalSql = `
    SELECT result_data.id_string AS deleted_edge_id 
    FROM cypher($$${graphName}$$, $$ ${deleteEdgeCypherString.replace(/\\$\\$/g, '$$$$')} $$) AS result_data(id_string agtype);
  `;
  
  try {
    client = await pool.connect();
    console.log(`DELETE /api/edge/${edgeIdParam}: Successfully connected to database.`);
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`DELETE /api/edge/${edgeIdParam}: Executing SQL: ${finalSql}`);
    const result = await client.query<{ deleted_edge_id: string }>(finalSql);

    // The returned agtype string will be quoted, e.g., "\"12345\""
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


// Search Query Interface for the old /api/search by term
interface SearchQuery extends ParsedQs {
  term: string;
}

// Old search endpoint (by general term) - kept for reference or potential future use, but new one is /api/nodes/search
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

// Interface for the new /api/nodes/search by property and value
interface SearchNodesByPropertyQuery extends ParsedQs {
  property: string;
  value: string;
}

// Search Nodes by Property Value (Case-Insensitive) - New Endpoint: /api/nodes/search
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
app.get('/api/nodes/search', searchNodesByPropertyHandler); // New route for property-based search

// Start the server
app.listen(port, () => {
  console.log(`Backend server running at http://localhost:${port}`);
  console.log('Testing database connection and AGE setup...');
  testDatabaseConnection();
});
