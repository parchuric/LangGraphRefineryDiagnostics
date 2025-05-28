import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, Inject, PLATFORM_ID, OnDestroy } from '@angular/core'; // Added OnDestroy
import { isPlatformBrowser } from '@angular/common'; // Import isPlatformBrowser
import { GraphDataService, GraphData, VisNode, VisEdge } from '../../services/graph-data.service';
import { Network, DataSet } from 'vis-network/standalone/esm/vis-network.min'; // Import from standalone for better tree-shaking
import { Subscription } from 'rxjs'; // Import Subscription

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
      this.graphRefreshSubscription = this.graphDataService.graphRefreshNeeded$.subscribe(() => {
        console.log('GraphVisualizationComponent: graphRefreshNeeded event received. Refreshing graph data.');
        this.fetchAndLoadGraph();
      });
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

    if (this.networkInstance) {
      this.networkInstance.destroy();
    }
    this.networkInstance = new Network(this.visNetworkContainer.nativeElement, data, options);

    // Event listeners for node and edge clicks
    this.networkInstance.on('click', (params) => {
      if (params.nodes.length > 0) {
        const nodeId = params.nodes[0];
        const node = this.graphData.nodes.find(n => n.id === nodeId);
        if (node) {
          this.graphDataService.selectNode(node);
        }
      } else if (params.edges.length > 0) {
        const edgeId = params.edges[0];
        const edge = this.graphData.edges.find(e => e.id === edgeId);
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

  ngOnDestroy(): void {
    if (this.graphRefreshSubscription) {
      this.graphRefreshSubscription.unsubscribe();
    }
    if (this.networkInstance) {
      this.networkInstance.destroy();
      this.networkInstance = undefined;
    }
  }
}
