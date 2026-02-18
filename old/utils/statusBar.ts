/**
 * WattTrace — Status Bar Controller
 *
 * Manages the status bar item that shows overall energy score,
 * grade, and analysis state.
 */

import * as vscode from 'vscode';
import { EnergyScoreSummary } from '../models/energyModels';

export class StatusBarController {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'watttrace.analyzeCurrentFile';
    this.item.tooltip = 'WattTrace — Click to analyze current file';
    this.setIdle();
    this.item.show();
  }

  /** Show idle state */
  setIdle(): void {
    this.item.text = '$(lightbulb) WattTrace';
    this.item.backgroundColor = undefined;
    this.item.tooltip = 'WattTrace — Click to analyze current file';
  }

  /** Show "analysing" state */
  setAnalyzing(): void {
    this.item.text = '$(sync~spin) WattTrace: Analyzing…';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  /** Show results */
  setResult(summary: EnergyScoreSummary): void {
    const icon = summary.overallGrade <= 'B' ? '$(check)' : summary.overallGrade <= 'C' ? '$(warning)' : '$(error)';
    this.item.text = `${icon} WattTrace: ${summary.overallGrade} (${summary.overallScore}/100)  •  ${summary.averageEfficiency}% eff.`;
    this.item.backgroundColor = undefined;
    this.item.tooltip = `WattTrace — ${summary.totalFunctions} functions analyzed\n` +
      `🔴 ${summary.highRiskCount} high  🟡 ${summary.mediumRiskCount} med  🟢 ${summary.lowRiskCount} low\n` +
      `Click to re-analyze`;
  }

  /** Show error */
  setError(message: string): void {
    this.item.text = '$(error) WattTrace: Error';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.item.tooltip = `WattTrace Error: ${message}`;
  }

  dispose(): void {
    this.item.dispose();
  }
}
