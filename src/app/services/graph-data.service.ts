import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, BehaviorSubject, Subject } from 'rxjs'; // Import Subject
import { catchError, map } from 'rxjs/operators';
import { RcaResult } from '../models/rca.models'; // Import RcaResult

export interface VisNode {
  id: string | number;
  label: string;
  properties?: any;
  title?: string; 
  color?: string | { 
    border: string, 
    background: string, 
    highlight: { 
      border: string, 
      background: string 
    },
    hover?: {        // Added hover property
      border: string,
      background: string
    }
  }; 
  group?: string; 
}

export interface VisEdge {
  id: string | number; 
  from: string | number;
  to: string | number;
  label?: string;
  properties?: any;
  title?: string; 
  arrows?: string; 
  color?: string | { 
    color: string, 
    highlight: string,
    hover?: string    // Added hover property for edge color object
  }; 
  dashes?: boolean; // Added dashes property
}

export interface GraphData {
  nodes: VisNode[];
  edges: VisEdge[];
}

// Define interfaces for RCA request and response
export interface RcaRequest {
  selectedNode: VisNode; // Renamed from nodeData for clarity
  adjacentNodes?: VisNode[];
  connectingEdges?: VisEdge[];
  // We can add more context if needed
}

// Remove RcaResponse interface as we now use RcaResult directly from the backend

@Injectable({
  providedIn: 'root'
})
export class GraphDataService {
  private apiUrl = 'http://localhost:3000/api';

  // BehaviorSubjects for selected node and edge
  private selectedNodeSubject = new BehaviorSubject<VisNode | null>(null);
  private selectedEdgeSubject = new BehaviorSubject<VisEdge | null>(null);

  // Observables for components to subscribe to
  selectedNode$ = this.selectedNodeSubject.asObservable();
  selectedEdge$ = this.selectedEdgeSubject.asObservable();

  // Subject for graph refresh
  private graphRefreshSource = new Subject<void>();
  graphRefreshNeeded$ = this.graphRefreshSource.asObservable();

  constructor(private http: HttpClient) { }

  private handleError(error: HttpErrorResponse) {
    console.error(
      `Backend returned code ${error.status}, ` +
      `body was: ${JSON.stringify(error.error)}`);
    // Return an observable with a user-facing error message AND the error object itself
    return throwError(() => ({
      message: 'Something bad happened with RCA; please try again later. Check console for details.',
      details: error.error // This will carry the RcaResult-like error from the backend
    }));
  }

  getGraphData(): Observable<GraphData> {
    return this.http.get<GraphData>(`${this.apiUrl}/graph`).pipe(
      map(response => {
        const nodes = response.nodes.map(node => ({ ...node, id: String(node.id) }));
        const edges = response.edges.map(edge => ({
          ...edge,
          id: String(edge.id),
          from: String(edge.from),
          to: String(edge.to)
        }));
        return { nodes, edges };
      }),
      catchError(this.handleError)
    );
  }

  // Assumes backend GET /api/node/:id returns a single VisNode object
  getNode(id: string | number): Observable<VisNode> {
    return this.http.get<VisNode>(`${this.apiUrl}/node/${id}`).pipe(
      map(node => ({ ...node, id: String(node.id) })),
      catchError(this.handleError)
    );
  }

  // Assumes backend GET /api/edge/:id returns a single VisEdge object
  getEdge(id: string | number): Observable<VisEdge> {
    return this.http.get<VisEdge>(`${this.apiUrl}/edge/${id}`).pipe(
      map(edge => ({
        ...edge,
        id: String(edge.id),
        from: String(edge.from),
        to: String(edge.to)
      })),
      catchError(this.handleError)
    );
  }

  createNode(label: string, properties: any): Observable<VisNode> {
    return this.http.post<VisNode>(`${this.apiUrl}/node`, { label, properties }).pipe(
      map(node => ({ ...node, id: String(node.id) })),
      catchError(this.handleError)
    );
  }

  updateNode(id: string | number, changes: { label?: string, properties?: any }): Observable<VisNode> {
    return this.http.put<VisNode>(`${this.apiUrl}/node/${id}`, changes).pipe(
      map(node => ({ ...node, id: String(node.id) })),
      catchError(this.handleError)
    );
  }

  deleteNode(id: string | number): Observable<any> { // Backend returns { message: string, deletedNodeId: string }
    return this.http.delete<any>(`${this.apiUrl}/node/${id}`).pipe(
      catchError(this.handleError)
    );
  }

  createEdge(from: string | number, to: string | number, label: string, properties: any): Observable<VisEdge> {
    return this.http.post<VisEdge>(`${this.apiUrl}/edge`, { from: String(from), to: String(to), label, properties }).pipe(
      map(edge => ({
        ...edge,
        id: String(edge.id),
        from: String(edge.from),
        to: String(edge.to)
      })),
      catchError(this.handleError)
    );
  }

  updateEdge(id: string | number, changes: { label?: string, properties?: any }): Observable<VisEdge> {
    const payload: any = { properties: { ...changes.properties } };
    if (changes.label) {
      payload.properties.label = changes.label; // Add label to properties if it exists
    }

    return this.http.put<VisEdge>(`${this.apiUrl}/edge/${id}`, payload).pipe(
      map(edge => ({
        ...edge,
        id: String(edge.id),
        from: String(edge.from),
        to: String(edge.to)
      })),
      catchError(this.handleError)
    );
  }

  deleteEdge(id: string | number): Observable<{ id: string, message: string }> { // Ensure ID in response is string
    return this.http.delete<{ id: string, message: string }>(`${this.apiUrl}/edge/${id}`).pipe(
      map(response => ({ ...response, id: String(response.id) })), 
      catchError(this.handleError)
    );
  }

  searchGraph(searchTerm: string): Observable<GraphData> {
    return this.http.get<GraphData>(`${this.apiUrl}/search?term=${encodeURIComponent(searchTerm)}`).pipe(
      map(response => {
        const nodes = response.nodes.map(node => ({ ...node, id: String(node.id) }));
        const edges = response.edges.map(edge => ({
          ...edge,
          id: String(edge.id),
          from: String(edge.from),
          to: String(edge.to)
        }));
        return { nodes, edges };
      }),
      catchError(this.handleError)
    );
  }

  // Updated method for RCA with richer context
  getRcaSummary(requestPayload: RcaRequest): Observable<RcaResult> {
    // The backend endpoint is now POST /api/perform-rca
    // The entire requestPayload is sent as the body.
    return this.http.post<RcaResult>(`${this.apiUrl}/perform-rca`, requestPayload).pipe(
      catchError(this.handleError)
    );
  }

  // Methods to update selected node and edge
  selectNode(node: VisNode | null): void {
    this.selectedNodeSubject.next(node);
    if (node) {
      this.selectedEdgeSubject.next(null); // Clear selected edge if a node is selected
    }
  }

  selectEdge(edge: VisEdge | null): void {
    this.selectedEdgeSubject.next(edge);
    if (edge) {
      this.selectedNodeSubject.next(null); // Clear selected node if an edge is selected
    }
  }

  // Method to request graph refresh
  requestGraphRefresh(): void {
    this.graphRefreshSource.next();
  }
}
