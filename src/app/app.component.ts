import { Component, ViewChild } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
import { GraphVisualizationComponent } from './components/graph-visualization/graph-visualization.component';
import { GraphEditorComponent } from './components/graph-editor/graph-editor.component';
import { VisNode, VisEdge } from './services/graph-data.service'; // Import VisNode and VisEdge
import { RouterOutlet } from '@angular/router'; // Import RouterOutlet

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, // Add RouterOutlet here
    MatToolbarModule,
    GraphVisualizationComponent,
    GraphEditorComponent
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'Sulfur Graph Explorer';
  selectedNodeForEditor: VisNode | null = null;
  selectedEdgeForEditor: VisEdge | null = null;

  @ViewChild(GraphVisualizationComponent) graphVisualization!: GraphVisualizationComponent;

  handleGraphChanged(): void {
    console.log('AppComponent: graphChanged event received. Refreshing graph visualization.');
    if (this.graphVisualization) {
      this.graphVisualization.refreshGraphData();
    }
  }

  handleNodeClicked(node: VisNode): void {
    console.log('AppComponent: nodeClicked event received', node);
    this.selectedNodeForEditor = node;
    this.selectedEdgeForEditor = null; // Clear selected edge if a node is clicked
  }

  handleEdgeClicked(edge: VisEdge): void {
    console.log('AppComponent: edgeClicked event received', edge);
    this.selectedEdgeForEditor = edge;
    this.selectedNodeForEditor = null; // Clear selected node if an edge is clicked
  }

  handleSearchSubmitted(searchTerm: string): void {
    console.log('AppComponent: searchSubmitted event received', searchTerm);
    // Later, this will trigger a search in the visualization component
    // For now, we can just log it or prepare for that integration.
  }
}
