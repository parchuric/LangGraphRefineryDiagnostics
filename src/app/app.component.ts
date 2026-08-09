import { Component } from '@angular/core';
import { MatToolbarModule } from '@angular/material/toolbar';
// GraphVisualizationComponent import removed as it's handled by routing
import { GraphEditorComponent } from './components/graph-editor/graph-editor.component';
import { RouterOutlet } from '@angular/router';
import { GraphDataService } from './services/graph-data.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, 
    MatToolbarModule,
    // GraphVisualizationComponent removed from imports
    GraphEditorComponent,
    // MatDialogModule removed as AppComponent no longer opens dialogs directly
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'LangGraphRefineryDiagnostics';

  constructor(
    private graphDataService: GraphDataService
    // MatDialog removed from constructor
  ) {}

  handleGraphChanged(): void {
    console.log('AppComponent: graphChanged event received. Requesting graph refresh via service.');
    this.graphDataService.requestGraphRefresh();
  }

  handleSearchSubmitted(searchTerm: string): void {
    console.log('AppComponent: searchSubmitted event received', searchTerm);
    // Logic for search can be implemented here or delegated
  }

  // handleRcaRequested method removed entirely
}
