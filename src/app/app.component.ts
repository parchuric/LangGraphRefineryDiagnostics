import { Component } from '@angular/core'; // Removed ViewChild
import { MatToolbarModule } from '@angular/material/toolbar';
import { GraphVisualizationComponent } from './components/graph-visualization/graph-visualization.component';
import { GraphEditorComponent } from './components/graph-editor/graph-editor.component';
import { VisNode, VisEdge, RcaResponse } from './services/graph-data.service';
import { RouterOutlet } from '@angular/router';
import { GraphDataService } from './services/graph-data.service';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { RcaDialogComponent, RcaDialogData } from './components/rca-dialog/rca-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, 
    MatToolbarModule,
    GraphVisualizationComponent,
    GraphEditorComponent,
    MatDialogModule // Add MatDialogModule here
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'Sulfur Graph Explorer';

  // Removed @ViewChild(GraphVisualizationComponent) graphVisualization!: GraphVisualizationComponent;
  
  constructor(
    private graphDataService: GraphDataService,
    private dialog: MatDialog
  ) {}

  handleGraphChanged(): void {
    console.log('AppComponent: graphChanged event received. Requesting graph refresh via service.');
    this.graphDataService.requestGraphRefresh(); // Use service to signal refresh
  }

  handleSearchSubmitted(searchTerm: string): void {
    console.log('AppComponent: searchSubmitted event received', searchTerm);
    // Later, this will trigger a search in the visualization component
    // For now, we can just log it or prepare for that integration.
  }

  handleRcaRequested(event: { nodeId: string | number, nodeData: VisNode }): void {
    console.log('AppComponent: rcaRequested event received', event);
    this.graphDataService.getRcaSummary(event.nodeId, event.nodeData).subscribe({
      next: (response: RcaResponse) => {
        console.log('RCA Response:', response);
        this.dialog.open<RcaDialogComponent, RcaDialogData>(RcaDialogComponent, {
          width: '500px',
          data: {
            nodeId: String(event.nodeId), 
            summary: response.summary,
            confidence: response.confidence,
            error: response.error // This should now be fine
          }
        });
      },
      error: (err) => {
        console.error('Error getting RCA summary:', err);
        // Ensure the error object passed to the dialog matches RcaDialogData
        const dialogErrorData: RcaDialogData = {
          nodeId: String(event.nodeId),
          summary: '',
          error: err.error?.error || err.message || 'Failed to get RCA summary. Please check the console for more details or try again later.',
          // confidence can be omitted or explicitly set to undefined
        };
        this.dialog.open<RcaDialogComponent, RcaDialogData>(RcaDialogComponent, {
          width: '500px',
          data: dialogErrorData
        });
      }
    });
  }
}
