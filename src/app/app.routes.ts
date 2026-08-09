import { Routes } from '@angular/router';
import { GraphVisualizationComponent } from './components/graph-visualization/graph-visualization.component';

export const routes: Routes = [
  { path: '', redirectTo: '/graph', pathMatch: 'full' }, // Default route redirects to /graph
  { path: 'graph', component: GraphVisualizationComponent, title: 'Graph Explorer' },
  // Add other routes here as the application grows
];
