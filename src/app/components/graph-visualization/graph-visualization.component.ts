import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, Inject, PLATFORM_ID, Output, EventEmitter } from '@angular/core';
import { isPlatformBrowser } from '@angular/common'; // Import isPlatformBrowser
import { GraphDataService, GraphData, VisNode, VisEdge } from '../../services/graph-data.service';
import { Network, DataSet } from 'vis-network/standalone/esm/vis-network.min'; // Import from standalone for better tree-shaking

@Component({
  selector: 'app-graph-visualization',
  templateUrl: './graph-visualization.component.html',
  styleUrls: ['./graph-visualization.component.css'],
  host: { // Add this host property
    '[style.display]': "'flex'",
    '[style.flex-direction]': "'column'",
    '[style.height]': "'100%'",
    '[style.width]': "'100%'" // Also ensure width is 100%
  }
})
export class GraphVisualizationComponent implements OnInit, AfterViewInit {

  @ViewChild('visNetwork', { static: false }) visNetworkContainer!: ElementRef;
  @Output() nodeClicked = new EventEmitter<VisNode>();
  @Output() edgeClicked = new EventEmitter<VisEdge>();

  private networkInstance: Network | undefined;
  public graphData: GraphData = { nodes: [], edges: [] };
  private viewInitialized = false;
  private dataLoaded = false;

  // Define colors for graph elements and legend
  public nodeColor = '#97C2FC'; // Default vis-network node color
  public nodeBorderColor = '#2B7CE9'; // Default vis-network node border color
  public edgeColor = '#848484'; // Default vis-network edge color

  constructor(
    private graphDataService: GraphDataService,
    @Inject(PLATFORM_ID) private platformId: Object // Inject PLATFORM_ID
  ) { }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) { // Check platform before potentially calling loadGraph
      this.fetchAndLoadGraph();
    }
  }

  fetchAndLoadGraph(): void {
    this.dataLoaded = false; // Reset dataLoaded flag
    this.graphDataService.getGraphData().subscribe((data: GraphData) => {
      console.log('Data received from backend:', data);
      this.graphData = data;
      this.dataLoaded = true;
      this.tryLoadGraph();
    });
  }

  // Public method to be called by parent component to refresh data
  public refreshGraphData(): void {
    console.log('GraphVisualizationComponent: refreshGraphData called.');
    if (isPlatformBrowser(this.platformId)) {
      this.fetchAndLoadGraph();
    }
  }

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) { // Only attempt to load graph in browser
      console.log('ngAfterViewInit: View is initialized.');
      this.viewInitialized = true;
      this.tryLoadGraph(); // Attempt to load graph
    }
  }

  private tryLoadGraph(): void {
    console.log(`[tryLoadGraph] Called. View Initialized: ${this.viewInitialized}, Data Loaded: ${this.dataLoaded}`);
    if (this.viewInitialized && this.dataLoaded && isPlatformBrowser(this.platformId)) {
      // Delay graph loading slightly to allow Angular hydration to settle
      setTimeout(() => {
        this.loadGraphActual();
      }, 0); 
    } else {
      console.log('[tryLoadGraph] Conditions not met or not in browser.');
    }
  }

  private loadGraphActual(): void {
    console.log('[loadGraphActual] Called.');

    if (!this.visNetworkContainer || !this.visNetworkContainer.nativeElement) {
      console.log('[loadGraphActual] VisNetwork container not yet available in the DOM.');
      return;
    }
    console.log('[loadGraphActual] VisNetwork container IS available.');

    if (!this.graphData || !this.graphData.nodes || !this.graphData.edges) {
      console.warn('[loadGraphActual] Graph data object or nodes/edges array is missing.');
      return;
    }
    console.log('[loadGraphActual] Graph data IS available. Nodes:', this.graphData.nodes.length, 'Edges:', this.graphData.edges.length);

    // Removed enhanced client-side duplicate checks for nodes and edges
    // Removed logging of Node/Edge IDs being passed to DataSet

    // Prepare nodes and edges with tooltips from properties
    const processedNodes = this.graphData.nodes.map(node => {
      const titleLines = [];
      // Add label if it exists
      if (node.label) {
        titleLines.push(node.label);
      }
      // Always add the ID
      titleLines.push(`ID: ${String(node.id)}`);

      // Add properties if they exist
      if (node.properties && Object.keys(node.properties).length > 0) {
        // Add a separator if there's already a label or ID and properties to list
        if (titleLines.length > 1 || (titleLines.length === 1 && node.label)) { // if label was pushed, or if only ID was pushed but now we add props
             titleLines.push('----------');
        }
        const propsString = Object.entries(node.properties)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        titleLines.push(propsString);
      }
      
      const title = titleLines.join('\n');
      return { ...node, title };
    });

    const processedEdges = this.graphData.edges.map(edge => {
      let title = edge.label; // Default title to edge label
      if (edge.properties) {
        const propsString = Object.entries(edge.properties)
          .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
          .join('\n');
        title = `${edge.label || 'Edge'}\n----------\n${propsString}`;
      }
      // Use id, from, to directly from edge object (service already converts them to string)
      return { ...edge, title };
    });

    console.log(`[loadGraphActual] Processed ${processedNodes.length} nodes and ${processedEdges.length} edges.`);
    if (processedNodes.length === 0 && this.graphData.nodes && this.graphData.nodes.length > 0) {
        console.warn('[loadGraphActual] Original graphData had nodes, but processedNodes is empty. Check mapping or data integrity.');
    }
    if (processedEdges.length === 0 && this.graphData.edges && this.graphData.edges.length > 0 && processedNodes.length > 0) {
        console.warn('[loadGraphActual] Original graphData had edges, but processedEdges is empty while nodes are present. Check mapping or data integrity.');
    }


    const container = this.visNetworkContainer.nativeElement;
    // Use processedNodes and processedEdges directly for DataSet creation
    const nodesDataSet = new DataSet<VisNode>(processedNodes);
    const edgesDataSet = new DataSet<VisEdge>(processedEdges);

    console.log(`[loadGraphActual] DataSet created. Nodes in DataSet: ${nodesDataSet.length}, Edges in DataSet: ${edgesDataSet.length}`);
    
    const dataForNetwork = { nodes: nodesDataSet, edges: edgesDataSet };

    // Destroy previous instance if it exists
    if (this.networkInstance) {
      console.log('[loadGraphActual] Destroying previous network instance.');
      this.networkInstance.destroy();
      this.networkInstance = undefined;
    }

    console.log('[loadGraphActual] Creating new Network instance.');
    
    // Removed unused 'nodes', 'edges', and 'data' variable declarations that created separate DataSets

    const options = { // Original options
      physics: {
        enabled: true,
        solver: 'forceAtlas2Based', 
        forceAtlas2Based: {
          gravitationalConstant: -50,
          centralGravity: 0.01,
          springLength: 100,
          springConstant: 0.08,
          damping: 0.4,
          avoidOverlap: 0 
        },
        stabilization: {
          enabled: true,
          iterations: 1000, 
          updateInterval: 30,
          onlyDynamicEdges: false,
          fit: true
        }
      },
      layout: {
        hierarchical: {
          enabled: false, 
          direction: 'UD', 
          sortMethod: 'directed', 
          levelSeparation: 200, 
          nodeSpacing: 150, 
          treeSpacing: 250 
        }
      },
      interaction: {
        dragNodes: true,
        dragView: true,
        zoomView: true
      },
      nodes: {
        shape: 'dot',
        size: 16,
        font: {
          size: 14,
          color: '#333'
        },
        borderWidth: 2,
        color: {
          background: this.nodeColor,
          border: this.nodeBorderColor,
          highlight: {
            background: '#D2E5FF',
            border: this.nodeBorderColor
          },
          hover: {
            background: '#D2E5FF',
            border: this.nodeBorderColor
          }
        }
      },
      edges: {
        width: 2,
        arrows: {
          to: { enabled: true, scaleFactor: 1 }
        },
        smooth: {
          enabled: true,
          type: "dynamic", 
          roundness: 0.5 
        },
        color: {
          color: this.edgeColor,
          highlight: '#848484', 
          hover: '#848484' 
        }
      }
    };

    // const simpleOptions = { // Simplified options commented out
    //   nodes: {
    //     shape: 'dot',
    //     size: 20,
    //     color: 'red', // Make nodes very obvious
    //     font: { size: 14, color: '#333' }
    //   },
    //   edges: {
    //     width: 3,
    //     color: 'blue', // Make edges very obvious
    //     arrows: { to: { enabled: true, scaleFactor: 1 } },
    //     smooth: false // Simplest way to disable smooth
    //   },
    //   interaction: {
    //     dragNodes: true,
    //     dragView: true,
    //     zoomView: true
    //   },
    //   physics: {
    //     enabled: true, // Keep physics, but simplify
    //     solver: 'barnesHut', // A common, less complex solver
    //     barnesHut: {
    //       gravitationalConstant: -2000,
    //       centralGravity: 0.1,
    //       springLength: 95,
    //       springConstant: 0.04,
    //       damping: 0.09,
    //       avoidOverlap: 0.1
    //     },
    //     stabilization: {
    //       iterations: 200 // Fewer iterations for faster stabilization
    //     }
    //   },
    //   layout: {
    //     randomSeed: undefined // Let vis-network pick a seed or use its default
    //   }
    // };
    // console.log('[loadGraphActual] Using SIMPLIFIED options:', simpleOptions);


    try {
      console.log('[loadGraphActual] Attempting to create new Network instance with data:', dataForNetwork);
      this.networkInstance = new Network(container, dataForNetwork, options); // Use original options
      console.log('[loadGraphActual] Network instance CREATED successfully.');

      // Explicitly set the size of the network canvas to fill its container
      this.networkInstance.setSize('100%', '100%');
      console.log('[loadGraphActual] Called networkInstance.setSize(\'100%\', \'100%\')');

      this.networkInstance.fit();
      console.log('[loadGraphActual] Called networkInstance.fit()');

      // Add a slightly delayed re-fit and stabilization
      setTimeout(() => {
        if (this.networkInstance) {
          console.log('[loadGraphActual] Performing delayed fit and stabilization.');
          this.networkInstance.fit(); // Fit again
          // Forcing stabilization might be too much if physics is simple,
          // but can be tried if fit() alone doesn't help.
          // this.networkInstance.stabilize(); 
        }
      }, 100);

      this.networkInstance.on("click", (params) => {
        if (params.nodes.length > 0) {
          const nodeId = String(params.nodes[0]); // Ensure ID is a string
          console.log('Clicked node ID:', nodeId);
          const clickedNode = nodesDataSet.get(nodeId) as VisNode | null; // Cast to VisNode
          if (clickedNode) {
            console.log('Clicked node data:', clickedNode);
            this.nodeClicked.emit(clickedNode);
          } else {
            console.warn('Clicked node not found in DataSet:', nodeId);
          }
        } else if (params.edges.length > 0) {
          const edgeId = String(params.edges[0]); // Ensure ID is a string
          console.log('Clicked edge ID:', edgeId);
          const clickedEdge = edgesDataSet.get(edgeId) as VisEdge | null; // Cast to VisEdge
          if (clickedEdge) {
            console.log('Clicked edge data:', clickedEdge);
            this.edgeClicked.emit(clickedEdge);
          } else {
            console.warn('Clicked edge not found in DataSet:', edgeId);
          }
        }
      });

    } catch (error) {
      console.error('[loadGraphActual] Error initializing vis-network:', error);
    }
  }
}
