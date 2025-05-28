import { Component, EventEmitter, Output, Input, OnChanges, SimpleChanges, OnInit, OnDestroy } from '@angular/core'; // Added OnInit, OnDestroy
import { GraphDataService, VisNode, VisEdge } from '../../services/graph-data.service'; // Added VisEdge
import { FormsModule } from '@angular/forms'; // Import FormsModule
import { CommonModule } from '@angular/common'; // Import CommonModule
import { Subscription } from 'rxjs'; // Import Subscription

@Component({
  selector: 'app-graph-editor',
  standalone: true, // Make it a standalone component
  imports: [FormsModule, CommonModule], // Import necessary modules
  templateUrl: './graph-editor.component.html',
  styleUrls: ['./graph-editor.component.css']
})
export class GraphEditorComponent implements OnChanges, OnInit, OnDestroy { // Implemented OnInit, OnDestroy
  newNodeLabel: string = '';
  newNodePropertiesString: string = '{}'; // Expect JSON string for properties
  
  // For updating existing node
  selectedNodeId: string | number | null = null;
  updateNodeLabel: string = ''; // For updating node label
  updatePropertiesString: string = '{}';

  // For creating new edge
  newEdgeFromId: string = '';
  newEdgeToId: string = '';
  newEdgeLabel: string = '';
  newEdgePropertiesString: string = '{}';

  // For updating/deleting existing edge
  selectedEdgeId: string | number | null = null;
  updateEdgeLabel: string = ''; // For updating edge label
  updateEdgePropertiesString: string = '{}';

  searchTerm: string = '';
  @Output() searchSubmitted = new EventEmitter<string>();

  @Output() graphChanged = new EventEmitter<void>();

  @Input() selectedNode: VisNode | null = null; // This can be removed if direct binding is no longer needed
  @Input() selectedEdge: VisEdge | null = null; // This can be removed if direct binding is no longer needed

  // New EventEmitter for RCA
  @Output() rcaRequested = new EventEmitter<{ nodeId: string | number, nodeData: VisNode }>();

  private nodeSubscription!: Subscription;
  private edgeSubscription!: Subscription;

  constructor(private graphDataService: GraphDataService) { }

  ngOnInit(): void {
    this.nodeSubscription = this.graphDataService.selectedNode$.subscribe(node => {
      this.selectedNode = node; // Update local selectedNode
      if (node) {
        this.selectedNodeId = node.id;
        this.updateNodeLabel = node.label || '';
        this.updatePropertiesString = JSON.stringify(node.properties || {});
        // Clear edge selection when a node is selected via service
        this.selectedEdgeId = null;
        this.updateEdgeLabel = '';
        this.updateEdgePropertiesString = '{}';
        this.newEdgeFromId = '';
        this.newEdgeToId = '';
      } else {
        this.selectedNodeId = null;
        this.updateNodeLabel = '';
        this.updatePropertiesString = '{}';
      }
    });

    this.edgeSubscription = this.graphDataService.selectedEdge$.subscribe(edge => {
      this.selectedEdge = edge; // Update local selectedEdge
      if (edge) {
        this.selectedEdgeId = edge.id !== undefined ? edge.id : null;
        this.updateEdgeLabel = edge.label || '';
        this.updateEdgePropertiesString = JSON.stringify(edge.properties || {});
        this.newEdgeFromId = String(edge.from);
        this.newEdgeToId = String(edge.to);
        // Clear node selection when an edge is selected via service
        this.selectedNodeId = null;
        this.updateNodeLabel = '';
        this.updatePropertiesString = '{}';
      } else {
        this.selectedEdgeId = null;
        this.updateEdgeLabel = '';
        this.updateEdgePropertiesString = '{}';
      }
    });
  }

  ngOnDestroy(): void {
    if (this.nodeSubscription) {
      this.nodeSubscription.unsubscribe();
    }
    if (this.edgeSubscription) {
      this.edgeSubscription.unsubscribe();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Keep ngOnChanges if selectedNode/selectedEdge are still used as @Inputs for initial binding
    // or if there are other @Input properties that need handling.
    // If selectedNode and selectedEdge are purely driven by the service now,
    // much of the logic here might be redundant or can be simplified.

    if (changes['selectedNode'] && this.selectedNode) {
      console.log('GraphEditorComponent: selectedNode input changed (ngOnChanges)', this.selectedNode);
      // This logic might conflict or be redundant with ngOnInit if service also updates it.
      // Consider if this is still needed or if ngOnInit covers it.
      if (this.selectedNodeId !== this.selectedNode.id) { // Prevent re-processing if already set by service
        this.selectedNodeId = this.selectedNode.id;
        this.updateNodeLabel = this.selectedNode.label || '';
        this.updatePropertiesString = JSON.stringify(this.selectedNode.properties || {});
        this.selectedEdgeId = null;
        this.updateEdgeLabel = '';
        this.updateEdgePropertiesString = '{}';
        this.newEdgeFromId = '';
        this.newEdgeToId = '';
      }
    } else if (changes['selectedNode'] && !this.selectedNode && this.selectedNodeId !== null) {
        // If selectedNode input becomes null and it wasn't already null
        // this.selectedNodeId = null; // Handled by service subscription
        // this.updateNodeLabel = '';
        // this.updatePropertiesString = '{}';
    }

    if (changes['selectedEdge'] && this.selectedEdge) {
      console.log('GraphEditorComponent: selectedEdge input changed (ngOnChanges)', this.selectedEdge);
      // Similar to selectedNode, consider redundancy with ngOnInit
      if (this.selectedEdgeId !== (this.selectedEdge.id !== undefined ? this.selectedEdge.id : null)) {
        this.selectedEdgeId = this.selectedEdge.id !== undefined ? this.selectedEdge.id : null;
        this.updateEdgeLabel = this.selectedEdge.label || '';
        this.updateEdgePropertiesString = JSON.stringify(this.selectedEdge.properties || {});
        this.newEdgeFromId = String(this.selectedEdge.from);
        this.newEdgeToId = String(this.selectedEdge.to);
        this.selectedNodeId = null;
        this.updateNodeLabel = '';
        this.updatePropertiesString = '{}';
      }
    } else if (changes['selectedEdge'] && !this.selectedEdge && this.selectedEdgeId !== null) {
        // this.selectedEdgeId = null; // Handled by service subscription
        // this.updateEdgeLabel = '';
        // this.updateEdgePropertiesString = '{}';
    }
  }

  createNode(): void {
    if (!this.newNodeLabel.trim()) {
      alert('Node label cannot be empty.');
      return;
    }
    let properties;
    try {
      properties = JSON.parse(this.newNodePropertiesString);
    } catch (error) {
      alert('Invalid JSON format for properties.');
      console.error('Error parsing properties JSON:', error);
      return;
    }

    this.graphDataService.createNode(this.newNodeLabel, properties).subscribe({
      next: (newNode) => {
        console.log('Node created successfully:', newNode);
        alert(`Node '${newNode.label}' (ID: ${newNode.id}) created!`);
        this.graphChanged.emit();
        this.graphDataService.requestGraphRefresh(); // Signal refresh via service
        // Clear form
        this.newNodeLabel = '';
        this.newNodePropertiesString = '{}';
      },
      error: (err) => {
        console.error('Error creating node:', err);
        alert('Failed to create node. See console for details.');
      }
    });
  }

  selectNodeForUpdate(nodeId: string): void {
    if (!nodeId.trim()) {
      alert("Please enter a Node ID to select.");
      return;
    }
    this.graphDataService.getNode(nodeId.trim()).subscribe({
      next: (node: VisNode) => { // Explicitly type node
        this.selectedNode = node; // This will trigger ngOnChanges
        this.selectedNodeId = node.id;
        this.updateNodeLabel = node.label || '';
        this.updatePropertiesString = JSON.stringify(node.properties || {});
        alert(`Node with ID ${nodeId} selected. Details populated in the update form.`);
      },
      error: (err: any) => { // Explicitly type err
        console.error('Error fetching node details:', err);
        alert('Failed to fetch node details. Node may not exist.');
      }
    });
  }

  updateSelectedNode(): void {
    if (this.selectedNodeId === null) {
      alert('No node selected for update. Please select a node first.');
      return;
    }
    let propertiesToUpdate;
    try {
      propertiesToUpdate = JSON.parse(this.updatePropertiesString);
      // No longer checking for empty properties, as label update alone is valid
    } catch (error) {
      alert('Invalid JSON format for properties.');
      console.error('Error parsing update properties JSON:', error);
      return;
    }

    const payload: any = { properties: propertiesToUpdate };
    if (this.updateNodeLabel.trim()) {
      payload.label = this.updateNodeLabel.trim();
    }

    if (Object.keys(payload.properties).length === 0 && !payload.label) {
        alert('Please provide a new label or new properties to update.');
        return;
    }

    this.graphDataService.updateNode(this.selectedNodeId, payload).subscribe({
      next: (updatedNode) => {
        console.log('Node updated successfully:', updatedNode);
        alert(`Node ID '${updatedNode.id}' updated!`);
        this.graphChanged.emit();
        this.graphDataService.requestGraphRefresh(); // Signal refresh via service
        this.selectedNodeId = null;
        this.updateNodeLabel = '';
        this.updatePropertiesString = '{}';
      },
      error: (err) => {
        console.error('Error updating node:', err);
        alert('Failed to update node. See console for details.');
      }
    });
  }

  deleteSelectedNode(): void {
    if (this.selectedNodeId === null) {
      alert('No node selected for deletion.');
      return;
    }
    if (!confirm(`Are you sure you want to delete node ID ${this.selectedNodeId}?`)) {
      return;
    }
    this.graphDataService.deleteNode(this.selectedNodeId).subscribe({
      next: (response) => { // response is { message: string, deletedNodeId: string }
        console.log('Node deleted successfully:', response);
        alert(`Node ID '${response.deletedNodeId}' deleted!`); // Changed from response.id to response.deletedNodeId
        this.graphChanged.emit();
        this.graphDataService.requestGraphRefresh(); // Signal refresh via service
        this.selectedNodeId = null;
        this.updateNodeLabel = '';
        this.updatePropertiesString = '{}'; // Clear update form as well
      },
      error: (err) => {
        console.error('Error deleting node:', err);
        alert('Failed to delete node. See console for details.');
      }
    });
  }

  // --- Edge Management ---

  createEdge(): void {
    if (!this.newEdgeFromId.trim() || !this.newEdgeToId.trim() || !this.newEdgeLabel.trim()) {
      alert('Edge "From ID", "To ID", and "Label" cannot be empty.');
      return;
    }
    // Ensure IDs are strings, as they might be numbers if populated from selectedEdge
    const fromId = String(this.newEdgeFromId).trim();
    const toId = String(this.newEdgeToId).trim();
    const label = this.newEdgeLabel.trim();

    let properties;
    try {
      properties = JSON.parse(this.newEdgePropertiesString);
    } catch (error) {
      alert('Invalid JSON format for edge properties.');
      console.error('Error parsing edge properties JSON:', error);
      return;
    }

    this.graphDataService.createEdge(fromId, toId, label, properties).subscribe({
      next: (newEdge) => {
        console.log('Edge created successfully:', newEdge);
        alert(`Edge '${newEdge.label}' (ID: ${newEdge.id}) created from ${newEdge.from} to ${newEdge.to}!`);
        this.graphChanged.emit();
        this.graphDataService.requestGraphRefresh(); // Signal refresh via service
        // Clear form
        this.newEdgeFromId = '';
        this.newEdgeToId = '';
        this.newEdgeLabel = '';
        this.newEdgePropertiesString = '{}';
      },
      error: (err) => {
        console.error('Error creating edge:', err);
        alert('Failed to create edge. See console for details. Ensure source and target nodes exist.');
      }
    });
  }

  selectEdgeForUpdate(edgeId: string): void {
    if (!edgeId.trim()) {
      alert("Please enter an Edge ID to select.");
      return;
    }
    this.graphDataService.getEdge(edgeId.trim()).subscribe({
        next: (edge: VisEdge) => { // Explicitly type edge
            this.selectedEdge = edge; // This will trigger ngOnChanges
            this.selectedEdgeId = edge.id;
            this.updateEdgeLabel = edge.label || '';
            this.updateEdgePropertiesString = JSON.stringify(edge.properties || {});
            this.newEdgeFromId = String(edge.from);
            this.newEdgeToId = String(edge.to);
            alert(`Edge with ID ${edgeId} selected. Details populated in the update form.`);
        },
        error: (err: any) => { // Explicitly type err
            console.error('Error fetching edge details:', err);
            alert('Failed to fetch edge details. Edge may not exist.');
        }
    });
  }

  updateSelectedEdge(): void {
    if (this.selectedEdgeId === null) {
      alert('No edge selected for update.');
      return;
    }
    let propertiesToUpdate;
    try {
      propertiesToUpdate = JSON.parse(this.updateEdgePropertiesString);
      // No longer checking for empty properties, as label update alone is valid
    } catch (error) {
      alert('Invalid JSON format for edge properties.');
      console.error('Error parsing update edge properties JSON:', error);
      return;
    }

    const payload: any = { properties: propertiesToUpdate };
    if (this.updateEdgeLabel.trim()) {
      payload.label = this.updateEdgeLabel.trim();
    }

    if (Object.keys(payload.properties).length === 0 && !payload.label) {
        alert('Please provide a new label or new properties to update.');
        return;
    }

    this.graphDataService.updateEdge(this.selectedEdgeId, payload).subscribe({
      next: (updatedEdge) => {
        console.log('Edge updated successfully:', updatedEdge);
        alert(`Edge ID '${updatedEdge.id}' updated!`);
        this.graphChanged.emit();
        this.graphDataService.requestGraphRefresh(); // Signal refresh via service
        this.selectedEdgeId = null;
        this.updateEdgeLabel = '';
        this.updateEdgePropertiesString = '{}';
      },
      error: (err) => {
        console.error('Error updating edge:', err);
        alert('Failed to update edge. See console for details.');
      }
    });
  }

  deleteSelectedEdge(): void {
    if (this.selectedEdgeId === null) {
      alert('No edge selected for deletion.');
      return;
    }
    if (!confirm(`Are you sure you want to delete edge ID ${this.selectedEdgeId}?`)) {
      return;
    }
    this.graphDataService.deleteEdge(this.selectedEdgeId).subscribe({
      next: (response) => {
        console.log('Edge deleted successfully:', response);
        alert(`Edge ID '${response.id}' deleted!`);
        this.graphChanged.emit();
        this.graphDataService.requestGraphRefresh(); // Signal refresh via service
        this.selectedEdgeId = null;
        this.updateEdgeLabel = '';
        this.updateEdgePropertiesString = '{}';
      },
      error: (err) => {
        console.error('Error deleting edge:', err);
        alert('Failed to delete edge. See console for details.');
      }
    });
  }

  analyzeRootCause(): void {
    if (this.selectedNodeId && this.selectedNode) {
      console.log('Analyze Root Cause button clicked for node ID:', this.selectedNodeId);
      // Emit an event with the node ID and the full node data
      this.rcaRequested.emit({ nodeId: this.selectedNodeId, nodeData: this.selectedNode });
      // For now, we'll just log. Later, this will call a service.
      alert(`RCA requested for node: ${this.selectedNode.label} (ID: ${this.selectedNodeId})`);
    } else {
      alert('Please select a node first to analyze its root cause.');
      console.warn('analyzeRootCause called without a selected node.');
    }
  }

  onSearch(): void {
    if (this.searchTerm.trim()) {
      console.log('Search term submitted from editor:', this.searchTerm);
      this.searchSubmitted.emit(this.searchTerm.trim());
    }
  }
}
