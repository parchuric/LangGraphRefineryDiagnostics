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
  id: number | string;
  label?: string;
  title?: string;
  group?: string;
  properties?: Record<string, any>;
  x?: number;
  y?: number;
  fixed?: boolean;
}

interface VisEdge {
  id?: number | string; // Optional, as it might be derived or not always present
  from: number | string;
  to: number | string;
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

// Helper to parse AGE agtype values (simplified, expand as needed)

// Define a type for the JSON response from agtype_to_json
interface AgJsonResponseBase {
  id: string | number; // Changed to allow number, as raw JSON might have numeric IDs
  label: string;
  properties: Record<string, any>;
}
interface AgJsonNodeResponse extends AgJsonResponseBase {}
interface AgJsonEdgeResponse extends AgJsonResponseBase {
  start_id: string; // graphid string
  end_id: string;   // graphid string
}
type AgJsonResponse = AgJsonNodeResponse | AgJsonEdgeResponse;

// REMOVE THE parseAgTypeValue function as it's no longer needed
// function parseAgTypeValue(value: string): AgTypeNode | AgTypeEdge | null { ... }

// Type for rows from node/edge queries
interface AgEntityRow {
  ag_vertex_string?: string; // Changed from ag_vertex_json
  ag_edge_string?: string;   // Changed from ag_edge_json
  // AGE specific id representation if different from properties
  id?: any; // Adjust if AGE returns id directly in a specific format
  label?: string; // Adjust if AGE returns label directly
  properties?: string; // JSON string of properties
  start_id?: any; // For edges
  end_id?: any; // For edges
  start_label?: string; // For edges
  end_label?: string; // For edges
}

// Function to test database connection and AGE setup
async function testDatabaseConnection() {
  let client;
  try {
    client = await pool.connect();
    console.log('Successfully connected to the database via pg.Pool!');

    // Set the search_path to include ag_catalog for AGE functions
    await client.query("SET search_path = ag_catalog, '$user', public;");
    console.log("Session search_path set to include ag_catalog.");

    const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';

    // Check if the graph already exists
    const checkGraphExistsQuery = `SELECT 1 FROM ag_catalog.ag_graph WHERE name = '${graphName}';`;
    const graphExistsResult = await client.query(checkGraphExistsQuery);

    if (graphExistsResult.rowCount === 0) {
      console.log(`Graph '${graphName}' does not exist. Attempting to create it.`);
      // Explicitly call create_graph from ag_catalog schema
      await client.query(`SELECT ag_catalog.create_graph('${graphName}');`);
      console.log(`Graph '${graphName}' created successfully.`);
    } else {
      console.log(`Graph '${graphName}' already exists.`);
    }

    // Test Cypher query
    const cypherQuery = `SELECT * from cypher('${graphName}', $$ MATCH (n) RETURN n $$) as (n agtype);`;
    console.log(`Executing test Cypher query: ${cypherQuery}`);
    const res = await client.query(cypherQuery);
    console.log('Test Cypher query executed. Results:', res.rows);

  } catch (err) {
    console.error('Error during database/AGE test:', err);
  } finally {
    if (client) {
      client.release();
      console.log('Database client released.');
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

    // Set search_path for AGE
    await client.query("SET search_path = ag_catalog, '$user', public;");
    console.log('GET /api/graph: search_path set.');

    // Fetch nodes
    const nodesQuery = `
      SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string
      FROM cypher($$${graphName}$$, $$
          MATCH (v)
          RETURN v
      $$) AS v_data(v agtype);
    `;
    const nodesResult = await client.query<AgEntityRow>(nodesQuery);
    console.log(`GET /api/graph: Fetched ${nodesResult.rowCount} raw node entries.`);

    const nodes: VisNode[] = nodesResult.rows.map((row: AgEntityRow): VisNode | null => {
      if (!row.ag_vertex_string) return null;
      try {
        const agtypeString = row.ag_vertex_string;
        const jsonString = agtypeString.replace(/::\w+$/, '');
        const parsed = JSON.parse(jsonString) as AgJsonNodeResponse; // parsed.id can be string or number
                        
        return {
          id: String(parsed.id), // Ensure node ID is a string
          label: parsed.properties.name || parsed.properties.label || parsed.label || String(parsed.id), // Also stringify ID if used as label
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
      SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string
      FROM cypher($$${graphName}$$, $$
          MATCH ()-[e]->()
          RETURN e
      $$) AS e_data(e agtype);
    `;
    const edgesResult = await client.query<AgEntityRow>(edgesQuery);
    console.log(`GET /api/graph: Fetched ${edgesResult.rowCount} raw edge entries.`);
    
    const processedEdgeStringIds = new Set<string>(); // For de-duplication using string IDs

    const edges: VisEdge[] = edgesResult.rows.map((row: AgEntityRow): VisEdge | null => {
      if (!row.ag_edge_string) return null;
      try {
        const agtypeString = row.ag_edge_string;
        const jsonString = agtypeString.replace(/::\w+$/, '');
        const parsed = JSON.parse(jsonString) as AgJsonEdgeResponse; // parsed.id can be string or number
        
        const edgeIdString = String(parsed.id); // Convert to string for consistent de-duplication and usage

        if (processedEdgeStringIds.has(edgeIdString)) {
          console.warn(`GET /api/graph: Duplicate edge ID (stringified) "${edgeIdString}" found. Original raw ID from DB: ${parsed.id} (type: ${typeof parsed.id}). Skipping this edge.`);
          return null; // Skip this duplicate edge
        }
        processedEdgeStringIds.add(edgeIdString);
        
        return {
          from: String(parsed.start_id), // Ensure from/to are also strings
          to: String(parsed.end_id),
          label: parsed.properties.label || parsed.label,
          title: JSON.stringify(parsed.properties, null, 2),
          properties: parsed.properties,
          id: edgeIdString // Use the stringified ID
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
      if (edge.id === undefined) continue; 
      if (finalEdgeIds.has(edge.id as string)) { // edge.id is already string
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
interface CreateEdgeBody {
  from: string; // Source node graph ID (stringified)
  to: string;   // Target node graph ID (stringified)
  label: string;
  properties: Record<string, any>;
}

interface EdgeParams extends ParamsDictionary {
  id: string; // Edge graph ID (stringified)
}

interface UpdateEdgeBody {
  properties: Record<string, any>;
}

// Response types for Edge CRUD operations
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
    SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string
    FROM cypher($$${graphName}$$, $$
        CREATE (v:${label} {${propertiesString}})
        RETURN v
    $$) AS v_data(v agtype);
  `;

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`POST /api/node: Executing Cypher: ${cypherQuery}`);
    const result = await client.query<AgEntityRow>(cypherQuery);

    if (result.rows.length > 0 && result.rows[0].ag_vertex_string) {
      const agtypeString = result.rows[0].ag_vertex_string;
      const jsonString = agtypeString.replace(/::\w+$/, '');
      const createdAgNode = JSON.parse(jsonString) as AgJsonNodeResponse;

      const responseNode: VisNode = {
        id: createdAgNode.id, // graphid string
        label: createdAgNode.properties.name || createdAgNode.properties.label || createdAgNode.label || createdAgNode.id,
        title: JSON.stringify(createdAgNode.properties, null, 2),
        group: createdAgNode.label,
        properties: createdAgNode.properties,
      };
      res.status(201).json(responseNode);
    } else {
      console.error('POST /api/node: Node creation query returned no rows or no ag_vertex_string.');
      res.status(500).json({ error: 'Failed to create node; query returned no results or no ag_vertex_string.' });
    }
  } catch (error) {
    console.error('POST /api/node: Error creating node:', error);
    res.status(500).json({ error: 'Failed to create node', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.post('/api/node', createNodeHandler);

// Update Node
const updateNodeHandler: RequestHandler<NodeParams, UpdateNodeResponse, UpdateNodeBody, ParsedQs> = async (req, res): Promise<void> => {
  const nodeIdParam = req.params.id; // This is expected to be the graphid string now
  const { properties } = req.body;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  // Validate nodeIdParam if it needs to match a specific graphid format, e.g., "number.number"
  // For now, we assume it's passed correctly by the frontend.

  if (!properties || typeof properties !== 'object' || Object.keys(properties).length === 0) {
    res.status(400).json({ error: 'Properties (object) to update are required.' });
    return;
  }
    
  const setClauses = Object.entries(properties).map(([key, value]) => {
    const escapedKey = key.replace(/`/g, '``');
    const cypherKey = (key.includes(' ') || !/^[a-zA-Z_][\w]*$/.test(key)) ? `\`${escapedKey}\`` : escapedKey;
    return `v.${cypherKey} = ${JSON.stringify(value)}`;
  }).join(', ');
  
  // IMPORTANT: id(v) returns an integer in AGE, but graphid is a string like "3.14".
  // We need to match by graphid string if that's what we store/send to frontend.
  // However, the id() function in Cypher typically works with the internal integer ID.
  // Let's assume for now that the frontend sends the internal integer ID for updates/deletes.
  // If the frontend sends the graphid string, the query needs to change.
  // For simplicity, let's assume nodeIdParam is the *integer* part of the graphid for WHERE id(v) = ...
  // This is a potential point of mismatch if not handled consistently.
  // Let's try to match by a property if available, or assume nodeIdParam is the integer part for id().

  // Attempting to parse the integer part of the graphid for the WHERE clause
  // This is a temporary workaround. Ideally, you'd have a consistent ID strategy.
  let ageNodeInternalId: number;
  try {
    // If nodeIdParam is "label_id.entry_id", e.g., "3.14", split and parse the entry_id part.
    // If it's just an integer string, parse it directly.
    const parts = nodeIdParam.split('.');
    const idStringToParse = parts.length > 1 ? parts[1] : nodeIdParam;
    ageNodeInternalId = parseInt(idStringToParse, 10);
    
    if (isNaN(ageNodeInternalId)) {
        res.status(400).json({ error: `Invalid node ID format for Cypher id() function: ${nodeIdParam}. Expected integer or 'label_id.entry_id' parsable to integer.` });
        return;
    }
  } catch (e) {
    res.status(400).json({ error: `Could not parse node ID for Cypher id() function: ${nodeIdParam}` });
    return;
  }


  const updateCypherString = `
    MATCH (v)
    WHERE id(v) = ${ageNodeInternalId} 
    SET ${setClauses}
    RETURN v
  `;

  const finalSql = `
    SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string
    FROM cypher($$${graphName}$$, $$ ${updateCypherString.replace(/\$\$/g, '$$$$')} $$) AS v_data(v agtype);
  `;

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`PUT /api/node/${nodeIdParam}: Executing SQL: ${finalSql}`);
    const result = await client.query<AgEntityRow>(finalSql);

    if (result.rows.length > 0 && result.rows[0].ag_vertex_string) {
      const agtypeString = result.rows[0].ag_vertex_string;
      const jsonString = agtypeString.replace(/::\w+$/, '');
      const updatedAgNode = JSON.parse(jsonString) as AgJsonNodeResponse;

      const responseNode: VisNode = {
        id: updatedAgNode.id, // graphid string
        label: updatedAgNode.properties.name || updatedAgNode.properties.label || updatedAgNode.label || updatedAgNode.id,
        title: JSON.stringify(updatedAgNode.properties, null, 2),
        group: updatedAgNode.label,
        properties: updatedAgNode.properties,
      };
      res.json(responseNode);
    } else {
      console.warn(`PUT /api/node/${nodeIdParam}: Node not found or update query returned no rows/vertex_json.`);
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
const deleteNodeHandler: RequestHandler<NodeParams, DeleteNodeResponse, any, ParsedQs> = async (req, res): Promise<void> => {
  const nodeIdParam = req.params.id;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  // Similar to update, assuming id(v) needs an integer.
  let ageNodeInternalId: number;
   try {
    ageNodeInternalId = parseInt(nodeIdParam.split('.')[1] || nodeIdParam, 10);
    if (isNaN(ageNodeInternalId)) {
        const directInt = parseInt(nodeIdParam, 10);
        if (isNaN(directInt)) {
            res.status(400).json({ error: `Invalid node ID format for Cypher id() function: ${nodeIdParam}. Expected integer or parsable to integer.` });
            return;
        }
        ageNodeInternalId = directInt;
    }
  } catch (e) {
    res.status(400).json({ error: `Could not parse node ID for Cypher id() function: ${nodeIdParam}` });
    return;
  }

  const deleteCypherString = `
    MATCH (v)
    WHERE id(v) = ${ageNodeInternalId}
    DETACH DELETE v
  `;

  const finalSql = `
    PERFORM cypher($$${graphName}$$, $$ ${deleteCypherString.replace(/\$\$/g, '$$$$')} $$);
  `;

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`DELETE /api/node/${nodeIdParam}: Executing Cypher: ${finalSql}`);
    // Check if the node was actually deleted by trying to fetch it, or check affected rows if PERFORM returns it.
    // For now, we assume success if no error.
    await client.query(finalSql); 

    res.status(200).json({ message: 'Node deleted successfully', id: nodeIdParam }); // Return the original ID sent by client
  } catch (error) {
    console.error(`DELETE /api/node/${nodeIdParam}: Error deleting node:`, error);
    res.status(500).json({ error: 'Failed to delete node', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.delete('/api/node/:id', deleteNodeHandler);

// Create Edge
const createEdgeHandler: RequestHandler<ParamsDictionary, CreateEdgeResponse, CreateEdgeBody, ParsedQs> = async (req, res): Promise<void> => {
  const { from, to, label, properties } = req.body;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!from || !to || !label || !properties) {
    res.status(400).json({ error: '`from` (source node ID), `to` (target node ID), `label` (string), and `properties` (object) are required.' });
    return;
  }

  // Validate from/to IDs - they should be strings representing graphids (e.g., "1.23")
  // Basic validation, can be enhanced if a strict format is known and required.
  if (typeof from !== 'string' || typeof to !== 'string' || typeof label !== 'string' || typeof properties !== 'object') {
    res.status(400).json({ error: 'Invalid types for `from`, `to`, `label`, or `properties`.' });
    return;
  }

  const propertiesString = Object.entries(properties)
    .map(([key, value]) => {
      const escapedKey = key.replace(/`/g, '``');
      const cypherKey = (key.includes(' ') || !/^[a-zA-Z_][\w]*$/.test(key)) ? `\`${escapedKey}\`` : escapedKey;
      return `${cypherKey}: ${JSON.stringify(value)}`;
    })
    .join(', ');

  // Construct the Cypher query to match nodes by their graphid and then create the edge.
  // We assume 'from' and 'to' are the string representations of graphid (e.g., "entry_id.id")
  // and need to be cast to graphid in the Cypher query.
  const cypherQuery = `
    SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string
    FROM cypher($$${graphName}$$, $$
        MATCH (a), (b)
        WHERE ag_catalog.graphid_to_string(id(a)) = $1 AND ag_catalog.graphid_to_string(id(b)) = $2
        CREATE (a)-[e:${label} {${propertiesString}}]->(b)
        RETURN e
    $$, $3) AS e_data(e agtype);
  `;
  // Parameters for the query: from (source node ID), to (target node ID), and an array containing these for the cypher function
  const queryParams = [from, to, [from, to]]; 

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`POST /api/edge: Executing Cypher: ${cypherQuery} with params: ${JSON.stringify(queryParams)}`);
    const result = await client.query<AgEntityRow>(cypherQuery, queryParams);

    if (result.rows.length > 0 && result.rows[0].ag_edge_string) {
      const agtypeString = result.rows[0].ag_edge_string;
      const jsonString = agtypeString.replace(/::\w+$/, '');
      const createdAgEdge = JSON.parse(jsonString) as AgJsonEdgeResponse;

      const responseEdge: VisEdge = {
        id: String(createdAgEdge.id), // Ensure ID is string
        from: String(createdAgEdge.start_id), // Ensure from/to are strings
        to: String(createdAgEdge.end_id),
        label: createdAgEdge.properties.label || createdAgEdge.label,
        title: JSON.stringify(createdAgEdge.properties, null, 2),
        properties: createdAgEdge.properties,
      };
      res.status(201).json(responseEdge);
    } else {
      console.error('POST /api/edge: Edge creation query returned no rows or no ag_edge_string.');
      res.status(500).json({ error: 'Failed to create edge; query returned no results or no ag_edge_string. Check if source/target nodes exist.' });
    }
  } catch (error) {
    console.error('POST /api/edge: Error creating edge:', error);
    res.status(500).json({ error: 'Failed to create edge', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.post('/api/edge', createEdgeHandler);

// Update Edge
const updateEdgeHandler: RequestHandler<EdgeParams, UpdateEdgeResponse, UpdateEdgeBody, ParsedQs> = async (req, res): Promise<void> => {
  const edgeIdParam = req.params.id; // This is expected to be the graphid string
  const { properties } = req.body;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!edgeIdParam) {
    res.status(400).json({ error: 'Edge ID parameter is required.' });
    return;
  }
  if (!properties || typeof properties !== 'object' || Object.keys(properties).length === 0) {
    res.status(400).json({ error: 'Properties (object) to update are required and cannot be empty.' });
    return;
  }

  // Prepare properties for SET clause. AGE allows direct JSON object for properties update.
  // However, to be precise with Cypher, we construct the SET clauses for each property.
  const setClauses = Object.entries(properties).map(([key, value]) => {
    const escapedKey = key.replace(/`/g, '``');
    // Quote key if it contains spaces or special characters or doesn't follow typical identifier rules
    const cypherKey = (key.includes(' ') || !/^[a-zA-Z_][\w]*$/.test(key)) ? `\`${escapedKey}\`` : escapedKey;
    return `e.${cypherKey} = ${JSON.stringify(value)}`;
  }).join(', ');

  const cypherQuery = `
    SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string
    FROM cypher($$${graphName}$$, $$
        MATCH ()-[e]->()
        WHERE ag_catalog.graphid_to_string(id(e)) = $1
        SET ${setClauses}
        RETURN e
    $$, $2) AS e_data(e agtype);
  `;
  const queryParams = [edgeIdParam, [edgeIdParam]]; // Parameter for graphid_to_string and for the cypher function context

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    console.log(`PUT /api/edge/${edgeIdParam}: Executing Cypher: ${cypherQuery} with params: ${JSON.stringify(queryParams)}`);
    const result = await client.query<AgEntityRow>(cypherQuery, queryParams);

    if (result.rows.length > 0 && result.rows[0].ag_edge_string) {
      const agtypeString = result.rows[0].ag_edge_string;
      const jsonString = agtypeString.replace(/::\w+$/, '');
      const updatedAgEdge = JSON.parse(jsonString) as AgJsonEdgeResponse;

      const responseEdge: VisEdge = {
        id: String(updatedAgEdge.id),
        from: String(updatedAgEdge.start_id),
        to: String(updatedAgEdge.end_id),
        label: updatedAgEdge.properties.label || updatedAgEdge.label,
        title: JSON.stringify(updatedAgEdge.properties, null, 2),
        properties: updatedAgEdge.properties,
      };
      res.status(200).json(responseEdge);
    } else {
      console.error(`PUT /api/edge/${edgeIdParam}: Edge update query returned no rows or no ag_edge_string. Edge might not exist.`);
      res.status(404).json({ error: `Failed to update edge. Edge with ID '${edgeIdParam}' not found or no properties changed.` });
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
  const edgeIdParam = req.params.id; // This is expected to be the graphid string
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!edgeIdParam) {
    res.status(400).json({ error: 'Edge ID parameter is required.' });
    return;
  }

  // In AGE, deleting an edge requires matching it first. The count of deleted edges isn't directly returned by DELETE.
  // We can first check if the edge exists, then delete it, or attempt delete and infer success if no error.
  // For simplicity, we'll attempt delete. If the edge doesn't exist, the query won't fail but won't delete anything.
  // To confirm deletion, we'd ideally check rowCount if the Cypher query returned something indicative of a successful match and delete.
  // AGE's `DELETE` in Cypher doesn't return the deleted element directly in the same way `RETURN` does for `CREATE` or `SET`.
  // We will assume success if the query executes without error and affect at least one row if we were to count it before.
  // A more robust way would be to count before and after, or use a subquery if AGE syntax allows.

  // We will execute a query that attempts to delete and then try to return the ID of what was deleted.
  // However, AGE might not support returning properties of a deleted edge. Let's try a simpler approach.
  // We will execute the DELETE and if it doesn't throw, assume it worked or the edge wasn't there.
  // To provide better feedback, we should ideally know if the edge existed.

  const checkQuery = `
    SELECT count(*) as edge_count
    FROM cypher($$${graphName}$$, $$
        MATCH ()-[e]->()
        WHERE ag_catalog.graphid_to_string(id(e)) = $1
        RETURN id(e)
    $$, $2) AS data(edge_id agtype);
  `;
  const deleteCypherQuery = `
    CALL cypher($$${graphName}$$, $$
        MATCH ()-[e]->()
        WHERE ag_catalog.graphid_to_string(id(e)) = $1
        DELETE e
    $$, $2) RETURN void;
  `;
  const queryParams = [edgeIdParam, [edgeIdParam]];

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    // First, check if the edge exists
    console.log(`DELETE /api/edge/${edgeIdParam}: Checking if edge exists. Query: ${checkQuery} with params: ${JSON.stringify(queryParams)}`);
    const checkResult = await client.query<{ edge_count: string }>(checkQuery, queryParams);
    
    if (parseInt(checkResult.rows[0]?.edge_count || "0") === 0) {
      console.log(`DELETE /api/edge/${edgeIdParam}: Edge not found.`);
      res.status(404).json({ error: `Edge with ID '${edgeIdParam}' not found.` });
      return;
    }

    // If edge exists, proceed to delete
    console.log(`DELETE /api/edge/${edgeIdParam}: Executing Cypher: ${deleteCypherQuery} with params: ${JSON.stringify(queryParams)}`);
    await client.query(deleteCypherQuery, queryParams); // CALL ... RETURN void doesn't return rows for rowCount check

    // Since DELETE in AGE within a CALL procedure might not give row counts indicating deletion,
    // and we've confirmed existence, we assume success if no error is thrown.
    res.status(200).json({ message: 'Edge deleted successfully', id: edgeIdParam });

  } catch (error) {
    console.error(`DELETE /api/edge/${edgeIdParam}: Error deleting edge:`, error);
    res.status(500).json({ error: 'Failed to delete edge', details: (error as Error).message });
  } finally {
    if (client) client.release();
  }
};
app.delete('/api/edge/:id', deleteEdgeHandler);

// Search Graph
interface SearchQuery extends ParsedQs {
  q: string;
}

const searchGraphHandler: RequestHandler<ParamsDictionary, GraphData | { error: string; details?: string }, any, SearchQuery> = async (req, res): Promise<void> => {
  const searchQuery = req.query.q;
  const graphName = process.env.AGE_GRAPH_NAME || 'sulfurgraph';
  let client;

  if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
    res.status(400).json({ error: 'Search query (q) is required and cannot be empty.' });
    return;
  }

  console.log(`GET /api/search: Query received: "${searchQuery}"`);

  // Sanitize/escape the search query for direct use in CONTAINS. 
  // Cypher parameters handle most of this, but for CONTAINS, the string itself is evaluated.
  // A simple approach: escape single quotes. For more complex needs, a dedicated library or more robust escaping is better.
  const searchTerm = searchQuery.replace(/'/g, "''"); 

  try {
    client = await pool.connect();
    await client.query("SET search_path = ag_catalog, '$user', public;");

    // Fetch matching nodes
    // We use parameterized query for the search term within the Cypher string itself.
    const nodesCypherQuery = `
      SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string
      FROM cypher($$${graphName}$$, $$
          MATCH (v)
          WHERE (v.label IS NOT NULL AND v.label CONTAINS $searchTermParam) OR 
                ANY(prop_key IN KEYS(v.properties) WHERE toString(v.properties[prop_key]) CONTAINS $searchTermParam)
          RETURN v
      $$, jsonb_build_object('searchTermParam', $1)) AS v_data(v agtype);
    `;
    console.log(`GET /api/search: Executing nodes search: ${nodesCypherQuery} with term: ${searchQuery}`);
    const nodesResult = await client.query<AgEntityRow>(nodesCypherQuery, [searchQuery]); // Pass original searchQuery as parameter
    console.log(`GET /api/search: Found ${nodesResult.rowCount} raw matching node entries.`);

    const nodes: VisNode[] = nodesResult.rows.map((row: AgEntityRow): VisNode | null => {
      if (!row.ag_vertex_string) return null;
      try {
        const agtypeString = row.ag_vertex_string;
        const jsonString = agtypeString.replace(/::\w+$/, '');
        const parsed = JSON.parse(jsonString) as AgJsonNodeResponse;
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
    console.log(`GET /api/search: Processed ${nodes.length} matching nodes.`);

    // Fetch matching edges
    const edgesCypherQuery = `
      SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string
      FROM cypher($$${graphName}$$, $$
          MATCH ()-[e]->()
          WHERE (e.label IS NOT NULL AND e.label CONTAINS $searchTermParam) OR 
                ANY(prop_key IN KEYS(e.properties) WHERE toString(e.properties[prop_key]) CONTAINS $searchTermParam)
          RETURN e
      $$, jsonb_build_object('searchTermParam', $1)) AS e_data(e agtype);
    `;
    console.log(`GET /api/search: Executing edges search: ${edgesCypherQuery} with term: ${searchQuery}`);
    const edgesResult = await client.query<AgEntityRow>(edgesCypherQuery, [searchQuery]);
    console.log(`GET /api/search: Found ${edgesResult.rowCount} raw matching edge entries.`);

    const processedEdgeStringIds = new Set<string>();
    const edges: VisEdge[] = edgesResult.rows.map((row: AgEntityRow): VisEdge | null => {
      if (!row.ag_edge_string) return null;
      try {
        const agtypeString = row.ag_edge_string;
        const jsonString = agtypeString.replace(/::\w+$/, '');
        const parsed = JSON.parse(jsonString) as AgJsonEdgeResponse;
        const edgeIdString = String(parsed.id);

        if (processedEdgeStringIds.has(edgeIdString)) {
          return null; // Should ideally not happen if search results are distinct, but good for safety
        }
        processedEdgeStringIds.add(edgeIdString);

        return {
          from: String(parsed.start_id),
          to: String(parsed.end_id),
          label: parsed.properties.label || parsed.label,
          title: JSON.stringify(parsed.properties, null, 2),
          properties: parsed.properties,
          id: edgeIdString
        };
      } catch (e) {
        console.error("Error processing searched edge row:", row, e);
        return null;
      }
    }).filter((edge): edge is VisEdge => edge !== null);
    console.log(`GET /api/search: Processed ${edges.length} matching edges.`);

    // If nodes are found from search, we should also include edges that connect these nodes,
    // even if the edges themselves didn't match the search term directly.
    // This provides context. We also need all nodes participating in these contextual edges.

    let contextualNodes: VisNode[] = [...nodes];
    let contextualEdges: VisEdge[] = [...edges];

    if (nodes.length > 0) {
        const matchingNodeIds = nodes.map(n => n.id);
        const matchingNodeIdStrings = matchingNodeIds.map(id => `'${String(id).replace(/'/g, "''")}'`).join(', '); // Prepare for IN clause

        if (matchingNodeIdStrings) { // Ensure not empty before querying
            const contextualEdgesQuery = `
                SELECT ag_catalog.agtype_out(e_data.e) AS ag_edge_string
                FROM cypher($$${graphName}$$, $$
                    MATCH (n)-[e]-(m)
                    WHERE ag_catalog.graphid_to_string(id(n)) IN [$nodeIdsParam] OR ag_catalog.graphid_to_string(id(m)) IN [$nodeIdsParam]
                    RETURN e
                $$, jsonb_build_object('nodeIdsParam', $1)) AS e_data(e agtype);
            `;
            console.log(`GET /api/search: Fetching contextual edges for ${matchingNodeIds.length} matched nodes.`);
            const contextualEdgesResult = await client.query<AgEntityRow>(contextualEdgesQuery, [matchingNodeIds]);
            console.log(`GET /api/search: Found ${contextualEdgesResult.rowCount} raw contextual edge entries.`);

            const newContextualEdges: VisEdge[] = contextualEdgesResult.rows.map((row: AgEntityRow): VisEdge | null => {
                if (!row.ag_edge_string) return null;
                try {
                    const agtypeString = row.ag_edge_string;
                    const jsonString = agtypeString.replace(/::\w+$/, '');
                    const parsed = JSON.parse(jsonString) as AgJsonEdgeResponse;
                    const edgeIdString = String(parsed.id);
                    // Add only if not already present from direct search
                    if (!processedEdgeStringIds.has(edgeIdString)) {
                        processedEdgeStringIds.add(edgeIdString);
                        return {
                            from: String(parsed.start_id),
                            to: String(parsed.end_id),
                            label: parsed.properties.label || parsed.label,
                            title: JSON.stringify(parsed.properties, null, 2),
                            properties: parsed.properties,
                            id: edgeIdString
                        };
                    }
                    return null;
                } catch (e) {
                    console.error("Error processing contextual edge row:", row, e);
                    return null;
                }
            }).filter((edge): edge is VisEdge => edge !== null);
            contextualEdges.push(...newContextualEdges);
            console.log(`GET /api/search: Added ${newContextualEdges.length} new contextual edges.`);

            // Now, ensure all nodes participating in the *final* edge list are included.
            const allNodeIdsInFinalEdges = new Set<string>();
            contextualEdges.forEach(e => {
                allNodeIdsInFinalEdges.add(String(e.from));
                allNodeIdsInFinalEdges.add(String(e.to));
            });

            const currentContextualNodeIds = new Set(contextualNodes.map(n => String(n.id)));
            const missingNodeIds = Array.from(allNodeIdsInFinalEdges).filter(id => !currentContextualNodeIds.has(id));
            
            if (missingNodeIds.length > 0) {
                const missingNodeIdStrings = missingNodeIds.map(id => `'${String(id).replace(/'/g, "''")}'`).join(', ');
                const missingNodesQuery = `
                    SELECT ag_catalog.agtype_out(v_data.v) AS ag_vertex_string
                    FROM cypher($$${graphName}$$, $$
                        MATCH (v)
                        WHERE ag_catalog.graphid_to_string(id(v)) IN [$nodeIdsParam]
                        RETURN v
                    $$, jsonb_build_object('nodeIdsParam', $1)) AS v_data(v agtype);
                `;
                console.log(`GET /api/search: Fetching ${missingNodeIds.length} missing contextual nodes.`);
                const missingNodesResult = await client.query<AgEntityRow>(missingNodesQuery, [missingNodeIds]);
                const newContextualNodes: VisNode[] = missingNodesResult.rows.map((row: AgEntityRow): VisNode | null => {
                     if (!row.ag_vertex_string) return null;
                    try {
                        const agtypeString = row.ag_vertex_string;
                        const jsonString = agtypeString.replace(/::\w+$/, '');
                        const parsed = JSON.parse(jsonString) as AgJsonNodeResponse;
                        return {
                            id: String(parsed.id),
                            label: parsed.properties.name || parsed.properties.label || parsed.label || String(parsed.id),
                            title: JSON.stringify(parsed.properties, null, 2),
                            group: parsed.label,
                            properties: parsed.properties,
                        };
                    } catch (e) {
                        console.error("Error processing missing contextual node row:", row, e);
                        return null;
                    }
                }).filter((node): node is VisNode => node !== null);
                contextualNodes.push(...newContextualNodes);
                console.log(`GET /api/search: Added ${newContextualNodes.length} new contextual nodes.`);
            }
        }
    }

    // De-duplicate nodes before sending (e.g. if a node was matched directly and also contextually)
    const finalNodesMap = new Map<string, VisNode>();
    contextualNodes.forEach(n => finalNodesMap.set(String(n.id), n));
    const finalNodes = Array.from(finalNodesMap.values());

    // Edges are already de-duplicated by ID using processedEdgeStringIds

    console.log(`GET /api/search: Returning ${finalNodes.length} nodes and ${contextualEdges.length} edges (including contextual).`);
    res.json({ nodes: finalNodes, edges: contextualEdges });

  } catch (error) {
    console.error('GET /api/search: Error during graph search:', error);
    res.status(500).json({ error: 'Failed to perform graph search', details: (error as Error).message });
  } finally {
    if (client) {
      client.release();
      console.log('GET /api/search: Database client released.');
    }
  }
};
app.get('/api/search', searchGraphHandler);


app.listen(port, () => {
  console.log(`Backend server is running on http://localhost:${port}`);
  // Test database connection on server startup
  testDatabaseConnection();
});
