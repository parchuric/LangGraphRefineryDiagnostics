// filepath: c:\\Projects\\GithubLocal\\pg-graph\\src\\app\\components\\rca-dialog\\rca-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';

export interface RcaDialogData {
  nodeId: string;
  summary: string;
  confidence?: number;
  error?: string;
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
    MatButtonModule
  ]
})
export class RcaDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: RcaDialogData) {}
}
