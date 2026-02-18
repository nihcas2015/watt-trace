/**
 * WattTrace — Sidebar Carbon Footprint Dashboard (Webview Provider)
 *
 * Renders a left-sidebar webview that shows:
 *   1. Overall carbon footprint summary with animated grade badge
 *   2. Per-function hotspot list with progress bars & risk indicators
 *   3. "Suggest greener code" buttons wired to Ollama (qwen2.5-coder:3b)
 *
 * Supports cool CSS animations: gradient backgrounds, fade-ins,
 * pulse effects, slide-in rows, animated bar fills, and glow effects.
 */
import * as vscode from 'vscode';
import { AnalysisResult } from '../../carbonFootprint/models';
import { OllamaService } from '../services/ollamaService';
export declare class CarbonDashboardProvider implements vscode.WebviewViewProvider {
    private readonly extensionUri;
    private readonly ollamaService;
    static readonly viewType = "watttrace.carbonDashboard";
    private _view?;
    private _result;
    private _isAnalyzing;
    private _pendingSuggestion;
    constructor(extensionUri: vscode.Uri, ollamaService: OllamaService);
    resolveWebviewView(webviewView: vscode.WebviewView, _ctx: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    updateResult(result: AnalysisResult): void;
    setAnalyzing(): void;
    clear(): void;
    private handleSuggestFix;
    private extractFunctionCode;
    /** Extract a Python function using indentation depth */
    private extractPythonFunction;
    /** Extract a brace-delimited function ({…}) */
    private extractBraceFunction;
    private showSuggestionPanel;
    private render;
    private revealFunction;
    private buildHtml;
    private renderOllamaLoading;
    private renderOverview;
    private renderBreakdown;
    private renderFunctionList;
    private getGrade;
    private getFunctionRisk;
}
//# sourceMappingURL=CarbonDashboardProvider.d.ts.map