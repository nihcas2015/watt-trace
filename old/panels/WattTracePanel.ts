/**
 * WattTrace — Sidebar Webview Panel
 *
 * Renders the WattTrace sidebar with Energy Overview,
 * Carbon-per-Function list, and Refactoring Suggestions.
 */

import * as vscode from 'vscode';
import { EnergyScoreSummary, FunctionEnergyMetric } from '../models/energyModels';

export class WattTraceSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'watttrace.sidebarView';

  private _view?: vscode.WebviewView;
  private _summary: EnergyScoreSummary | null = null;
  private _isAnalyzing = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'revealFunction') {
        this.revealFunction(msg.startLine, msg.endLine);
      }
    });

    this.updateContent();
  }

  /** Push new analysis results to the panel */
  updateResults(summary: EnergyScoreSummary): void {
    this._summary = summary;
    this._isAnalyzing = false;
    this.updateContent();
  }

  /** Show "analysing…" state */
  setAnalyzing(): void {
    this._isAnalyzing = true;
    this.updateContent();
  }

  // ── private ─────────────────────────────────────────────

  private updateContent(): void {
    if (!this._view) { return; }
    this._view.webview.html = this.getHtml();
  }

  private revealFunction(startLine: number, endLine: number): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }
    const range = new vscode.Range(startLine - 1, 0, endLine - 1, 0);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    editor.selection = new vscode.Selection(range.start, range.end);
  }

  private getHtml(): string {
    const s = this._summary;

    return /*html*/ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${this.getCss()}</style>
</head>
<body>
  ${this._isAnalyzing ? this.renderAnalyzing() : ''}
  ${s ? this.renderOverview(s) : this.renderEmpty()}
  ${s ? this.renderFunctionList(s) : ''}
  ${s ? this.renderSuggestions(s) : ''}

  <script>
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-fn-start]').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({
          type: 'revealFunction',
          startLine: parseInt(el.getAttribute('data-fn-start')),
          endLine: parseInt(el.getAttribute('data-fn-end')),
        });
      });
    });
  </script>
</body>
</html>`;
  }

  private renderAnalyzing(): string {
    return `<div class="section analyzing">
      <div class="spinner"></div>
      <p>Analyzing file…</p>
    </div>`;
  }

  private renderEmpty(): string {
    return `<div class="section empty">
      <p class="hero-icon">⚡</p>
      <h2>WattTrace</h2>
      <p class="subtitle">Green Coding Assistant</p>
      <p>Open a file and run <strong>WattTrace: Analyze Current File</strong> to see energy metrics.</p>
    </div>`;
  }

  private renderOverview(s: EnergyScoreSummary): string {
    const gradeColor = gradeToColor(s.overallGrade);
    return `<div class="section overview">
      <h3>⚡ Energy Overview</h3>
      <div class="overview-grid">
        <div class="metric-card">
          <div class="metric-value" style="color:${gradeColor}">${s.overallGrade}</div>
          <div class="metric-label">Grade</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${s.overallScore}</div>
          <div class="metric-label">Energy Score</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${s.averageEfficiency}%</div>
          <div class="metric-label">Efficiency</div>
        </div>
        <div class="metric-card">
          <div class="metric-value">${s.totalFunctions}</div>
          <div class="metric-label">Functions</div>
        </div>
      </div>
      <div class="risk-bar">
        <span class="risk-chip high">${s.highRiskCount} High</span>
        <span class="risk-chip medium">${s.mediumRiskCount} Med</span>
        <span class="risk-chip low">${s.lowRiskCount} Low</span>
      </div>
    </div>`;
  }

  private renderFunctionList(s: EnergyScoreSummary): string {
    if (s.functions.length === 0) { return ''; }

    const rows = s.functions
      .sort((a, b) => b.energyScore - a.energyScore) // worst first
      .map(fn => this.renderFunctionRow(fn))
      .join('');

    return `<div class="section">
      <h3>🔋 Carbon-per-Function</h3>
      <div class="fn-list">${rows}</div>
    </div>`;
  }

  private renderFunctionRow(fn: FunctionEnergyMetric): string {
    const icon = fn.energyRisk === 'low' ? '🟢' : fn.energyRisk === 'medium' ? '🟡' : '🔴';
    return `<div class="fn-row" data-fn-start="${fn.startLine}" data-fn-end="${fn.endLine}">
      <div class="fn-header">
        <span class="fn-icon">${icon}</span>
        <span class="fn-name">${escapeHtml(fn.name)}</span>
        <span class="fn-score">${fn.energyScore}</span>
      </div>
      <div class="fn-details">
        <span>${fn.complexity}</span>
        <span>${fn.efficiencyPercent}% eff.</span>
        <span>${fn.energyRisk} risk</span>
      </div>
      ${fn.issues.length > 0 ? `<div class="fn-issues">${fn.issues.map(i => `<span class="issue-tag">${escapeHtml(i)}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  private renderSuggestions(s: EnergyScoreSummary): string {
    if (s.refactorSuggestions.length === 0) { return ''; }

    const items = s.refactorSuggestions.slice(0, 10).map(r => {
      const icon = r.priority === 'high' ? '🔴' : r.priority === 'medium' ? '🟡' : '🟢';
      return `<div class="suggestion-row">
        <span class="sug-icon">${icon}</span>
        <div class="sug-content">
          <div class="sug-fn">${escapeHtml(r.functionName)}</div>
          <div class="sug-text">${escapeHtml(r.suggestion)}</div>
          ${r.estimatedSavingsPercent > 0 ? `<div class="sug-savings">~${r.estimatedSavingsPercent}% savings</div>` : ''}
        </div>
      </div>`;
    }).join('');

    return `<div class="section">
      <h3>🌿 Refactoring Suggestions</h3>
      ${items}
    </div>`;
  }

  private getCss(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        padding: 0;
      }
      .section { padding: 12px 14px; border-bottom: 1px solid var(--vscode-panel-border); }
      h3 { margin-bottom: 10px; font-size: 13px; font-weight: 600; }

      /* Empty / Analysing */
      .empty { text-align: center; padding: 30px 14px; }
      .hero-icon { font-size: 40px; margin-bottom: 8px; }
      .empty h2 { margin-bottom: 4px; }
      .subtitle { opacity: 0.6; margin-bottom: 12px; font-size: 12px; }
      .analyzing { text-align: center; padding: 18px; }
      .spinner {
        width: 24px; height: 24px; margin: 0 auto 8px;
        border: 3px solid var(--vscode-foreground);
        border-top-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* Overview */
      .overview-grid {
        display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
        margin-bottom: 10px;
      }
      .metric-card {
        background: var(--vscode-editor-background);
        border-radius: 6px; padding: 10px; text-align: center;
      }
      .metric-value { font-size: 22px; font-weight: 700; line-height: 1.2; }
      .metric-label { font-size: 11px; opacity: 0.65; margin-top: 2px; }
      .risk-bar { display: flex; gap: 6px; flex-wrap: wrap; }
      .risk-chip {
        font-size: 11px; padding: 2px 8px; border-radius: 10px; font-weight: 600;
      }
      .risk-chip.high { background: rgba(220,53,69,0.15); color: #dc3545; }
      .risk-chip.medium { background: rgba(255,193,7,0.15); color: #ffc107; }
      .risk-chip.low { background: rgba(40,167,69,0.15); color: #28a745; }

      /* Function list */
      .fn-list { display: flex; flex-direction: column; gap: 6px; }
      .fn-row {
        background: var(--vscode-editor-background);
        border-radius: 6px; padding: 8px 10px; cursor: pointer;
        transition: background 0.15s;
      }
      .fn-row:hover { background: var(--vscode-list-hoverBackground); }
      .fn-header { display: flex; align-items: center; gap: 6px; }
      .fn-icon { font-size: 14px; }
      .fn-name { flex: 1; font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fn-score { font-weight: 700; font-size: 14px; opacity: 0.85; }
      .fn-details { display: flex; gap: 10px; font-size: 11px; opacity: 0.6; margin-top: 4px; margin-left: 22px; }
      .fn-issues { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; margin-left: 22px; }
      .issue-tag {
        font-size: 10px; background: rgba(220,53,69,0.1); color: var(--vscode-errorForeground, #dc3545);
        padding: 1px 6px; border-radius: 4px;
      }

      /* Suggestions */
      .suggestion-row { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--vscode-panel-border); }
      .suggestion-row:last-child { border-bottom: none; }
      .sug-icon { font-size: 14px; margin-top: 2px; }
      .sug-fn { font-weight: 600; font-size: 12px; }
      .sug-text { font-size: 12px; opacity: 0.8; margin-top: 2px; }
      .sug-savings { font-size: 11px; color: #28a745; margin-top: 2px; }
    `;
  }
}

// ── helpers ────────────────────────────────────────────────────

function gradeToColor(grade: string): string {
  switch (grade) {
    case 'A': return '#28a745';
    case 'B': return '#71c054';
    case 'C': return '#ffc107';
    case 'D': return '#fd7e14';
    default:  return '#dc3545';
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
