// filepath: c:\\Projects\\GithubLocal\\pg-graph\\src\\app\\components\\rca-dialog\\rca-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list'; // Import MatListModule
import { MatExpansionModule } from '@angular/material/expansion'; // Import MatExpansionModule
import { MatProgressBarModule } from '@angular/material/progress-bar'; // Import MatProgressBarModule
import { RcaResult } from '../../models/rca.models'; // Import RcaResult
import { DragDropModule } from '@angular/cdk/drag-drop'; // Import DragDropModule

export interface RcaDialogData {
  nodeId: string;
  rcaResult?: RcaResult; // Updated to hold the full RcaResult
  error?: string;
  // Removed summary and confidence as they are part of rcaResult
}

@Component({
  selector: 'app-rca-dialog',
  templateUrl: './rca-dialog.component.html',
  styleUrls: ['./rca-dialog.component.css'],
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatCardModule,
    MatButtonModule,
    MatListModule, // Add MatListModule
    MatExpansionModule, // Add MatExpansionModule
    MatProgressBarModule, // Add MatProgressBarModule
    DragDropModule // Add DragDropModule to imports
  ]
})
export class RcaDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: RcaDialogData) {
    // Log the received data for debugging
    console.log('RcaDialogComponent data:', this.data);
  }
}
