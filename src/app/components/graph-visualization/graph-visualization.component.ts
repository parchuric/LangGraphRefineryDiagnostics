import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, Inject, PLATFORM_ID, OnDestroy } from '@angular/core'; // Added OnDestroy
import { isPlatformBrowser } from '@angular/common'; // Import isPlatformBrowser
import { GraphDataService, GraphData, VisNode, VisEdge } from '../../services/graph-data.service';
import { RcaService } from '../../services/rca.service'; // Import RcaService
import { RcaDialogComponent, RcaDialogData } from '../rca-dialog/rca-dialog.component'; // Import RcaDialogComponent and RcaDialogData
import { MatDialog, MatDialogModule } from '@angular/material/dialog'; // Import MatDialog and MatDialogModule
import { Network, DataSet, IdType } from 'vis-network/standalone/esm/vis-network.min'; // Import from standalone for better tree-shaking, Import IdType
import { Subscription } from 'rxjs'; // Import Subscription

@Component({
  selector: 'app-graph-visualization',
  templateUrl: './graph-visualization.component.html',
  styleUrls: ['./graph-visualization.component.css'],
  // Remove standalone: true if it exists, and ensure MatDialogModule is imported in the relevant NgModule or here if truly standalone with individual imports.
  // For simplicity with recent Angular versions, if this component is intended to be standalone and use other standalone components like MatDialog, ensure imports are correct.
  // Assuming RcaDialogComponent is standalone, it can be directly used. MatDialogModule might be needed if not already provided globally.
  imports: [MatDialogModule], // Add MatDialogModule here if graph-visualization is standalone and needs to open dialogs
  standalone: true, // Keep standalone as true
  host: { // Add this host property
    '[style.display]': "'flex'",
    '[style.flex-direction]': "'column'",
    '[style.height]': "'100%'",
    '[style.width]': "'100%'" // Also ensure width is 100%
  }
})
export class GraphVisualizationComponent implements OnInit, AfterViewInit, OnDestroy { // Implemented OnDestroy

  @ViewChild('visNetwork', { static: false }) visNetworkContainer!: ElementRef;
  // Remove Output event emitters for nodeClicked and edgeClicked
  // @Output() nodeClicked = new EventEmitter<VisNode>();
  // @Output() edgeClicked = new EventEmitter<VisEdge>();

  private networkInstance: Network | undefined;
  public graphData: GraphData = { nodes: [], edges: [] };
  private viewInitialized = false;
  private dataLoaded = false;
  private graphRefreshSubscription!: Subscription;
  private nodeClickSubscription!: Subscription; // For handling node clicks from GraphDataService

  // Define colors for graph elements and legend
  public nodeColor = '#97C2FC'; // Default vis-network node color
  public nodeBorderColor = '#2B7CE9'; // Default vis-network node border color
  public edgeColor = '#848484'; // Default vis-network edge color

  constructor(
    private graphDataService: GraphDataService,
    private rcaService: RcaService, // Inject RcaService
    public dialog: MatDialog, // Inject MatDialog
    @Inject(PLATFORM_ID) private platformId: Object // Inject PLATFORM_ID
  ) { }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) { // Check platform before potentially calling loadGraph
      this.fetchAndLoadGraph();
      this.graphRefreshSubscription = this.graphDataService.graphRefreshNeeded$.subscribe(() => {
        console.log('GraphVisualizationComponent: graphRefreshNeeded event received. Refreshing graph data.');
        this.fetchAndLoadGraph();
      });

      // Subscribe to node selection changes to trigger RCA dialog
      /* REMOVED: This subscription was causing the RCA dialog to open immediately on node click.
         The GraphEditorComponent is responsible for opening the dialog via its button.
      this.nodeClickSubscription = this.graphDataService.selectedNode$.subscribe(node => {
        if (node) {
          // Check if a dialog is already open for this node to prevent multiple popups for the same click
          // This simple check might need to be more robust depending on interaction complexity
          if (!this.dialog.getDialogById(String(node.id))) {
            this.handleNodeClickForRca(node);
          }
        }
      });
      */
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

  private formatPropertiesForTooltip(properties: any): string {
    if (!properties) {
      return '';
    }
    return Object.entries(properties)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
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
      return { ...edge, title: this.formatPropertiesForTooltip(edge.properties) };
    });

    const nodes = new DataSet<VisNode>(processedNodes);
    const edges = new DataSet<VisEdge>(processedEdges);

    const data = { nodes, edges };
    const options = {
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
        zoomView: true,
        tooltipDelay: 200 // Added tooltip delay
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

    if (this.networkInstance) {
      this.networkInstance.destroy();
    }
    this.networkInstance = new Network(this.visNetworkContainer.nativeElement, data, options);

    // Event listeners for node and edge clicks
    this.networkInstance.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0] as IdType; // Cast to IdType
        const clickedNodeOrNodes = nodes.get(nodeId);
        let node: VisNode | null = null;
        if (Array.isArray(clickedNodeOrNodes)) {
          node = clickedNodeOrNodes.length > 0 ? clickedNodeOrNodes[0] : null;
        } else {
          node = clickedNodeOrNodes as VisNode | null;
        }

        if (node) {
          this.graphDataService.selectNode(node); // This will trigger the subscription in ngOnInit
        }
      } else if (params.edges.length > 0) {
        const edgeId = params.edges[0] as IdType; // Cast to IdType
        const clickedEdgeOrEdges = edges.get(edgeId);
        let edge: VisEdge | null = null;
        if (Array.isArray(clickedEdgeOrEdges)) {
          edge = clickedEdgeOrEdges.length > 0 ? clickedEdgeOrEdges[0] : null;
        } else {
          edge = clickedEdgeOrEdges as VisEdge | null;
        }
        if (edge) {
          this.graphDataService.selectEdge(edge);
        }
      } else {
        // Clicked on empty space, clear selections
        this.graphDataService.selectNode(null);
        this.graphDataService.selectEdge(null);
      }
    });

    console.log('[loadGraphActual] Network initialized.');
  }

  private handleNodeClickForRca(node: VisNode): void {
    console.log(`Node clicked: ${node.id}, preparing RCA input.`);
    // Prepare RcaObservationInput from the clicked node
    // This is a simplified example; you might need more complex logic
    // to extract relevant process variables or symptoms from node properties.
    const rcaInput = {
      symptom: `Issue observed at node ${node.label || node.id}`,
      equipmentInvolved: [String(node.id)],
      // Example: try to find a 'status' or 'alarm' property for detectedFailureModeIds
      // This is highly dependent on your node data structure
      detectedFailureModeIds: node.properties?.alarmType ? [node.properties.alarmType] : [],
      processVariables: node.properties ? 
        Object.entries(node.properties).map(([key, value]) => ({ name: key, value: String(value), unit: '' })) :
        []
    };

    this.rcaService.performRca(rcaInput).subscribe({
      next: (rcaResult) => {
        const dialogData: RcaDialogData = {
          nodeId: String(node.id),
          rcaResult: rcaResult
        };
        this.dialog.open(RcaDialogComponent, {
          width: '600px',
          data: dialogData,
          id: String(node.id) // Use node ID as dialog ID to prevent duplicates
        });
      },
      error: (err) => {
        console.error('Error performing RCA:', err);
        const dialogData: RcaDialogData = {
          nodeId: String(node.id),
          error: 'Failed to perform Root Cause Analysis. Please check console for details.'
        };
        this.dialog.open(RcaDialogComponent, {
          width: '600px',
          data: dialogData,
          id: String(node.id) // Use node ID as dialog ID for error dialog too
        });
      }
    });
  }

  ngOnDestroy(): void {
    if (this.graphRefreshSubscription) {
      this.graphRefreshSubscription.unsubscribe();
    }
    /* REMOVED: Unsubscribe from the removed node click subscription
    if (this.nodeClickSubscription) { 
      this.nodeClickSubscription.unsubscribe();
    }
    */
    if (this.networkInstance) {
      this.networkInstance.destroy();
      this.networkInstance = undefined;
    }
  }
}
