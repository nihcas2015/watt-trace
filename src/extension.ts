/**
 * WattTrace — Extension Entry Point
 *
 * Registers the carbon-footprint sidebar dashboard, commands,
 * and auto-analyse-on-save listener.  Integrates the Ollama
 * code-generation service for greener-code suggestions.
 */

import * as vscode from 'vscode';
import { CarbonDashboardProvider } from './panels/CarbonDashboardProvider';
import { OllamaService } from './services/ollamaService';
import {
  estimateCarbonFootprint,
  initializeCarbonEstimator,
  disposeTreeSitter,
  AnalysisResult,
} from '../carbonFootprint/index';
import { mapVSCodeLanguageId } from '../carbonFootprint/languageDetection';

let dashboardProvider: CarbonDashboardProvider;

const resultCache = new Map<string, AnalysisResult>();
let isAnalyzing = false;

// ── Activation ────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  initializeCarbonEstimator(context.extensionPath);

  const ollamaService = new OllamaService();

  // ── Sidebar dashboard ──────────────────────────────────

  dashboardProvider = new CarbonDashboardProvider(
    context.extensionUri,
    ollamaService,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CarbonDashboardProvider.viewType,
      dashboardProvider,
    ),
  );

  // ── Commands ───────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'watttrace.analyzeCurrentFile',
      () => runAnalysis(),
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('watttrace.openPanel', () => {
      vscode.commands.executeCommand('watttrace.carbonDashboard.focus');
    }),
  );

  // ── Auto-analyse on save ───────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const auto = vscode.workspace
        .getConfiguration('watttrace')
        .get<boolean>('autoAnalyzeOnSave', false);
      if (auto && vscode.window.activeTextEditor?.document === doc) {
        runAnalysis();
      }
    }),
  );

  // ── Re-apply cached results when the active editor changes ─

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const cached = resultCache.get(editor.document.uri.toString());
        if (cached) {
          dashboardProvider.updateResult(cached);
        }
      }
    }),
  );

  // ── Cleanup ────────────────────────────────────────────

  context.subscriptions.push({ dispose: () => disposeTreeSitter() });
}

// ── Analysis runner ──────────────────────────────────────

async function runAnalysis(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('WattTrace: No active editor.');
    return;
  }

  if (isAnalyzing) {
    vscode.window.showWarningMessage('WattTrace: Analysis already in progress.');
    return;
  }

  isAnalyzing = true;
  dashboardProvider.setAnalyzing();

  try {
    const doc = editor.document;
    const code = doc.getText();
    const filePath = doc.uri.fsPath;
    const language = mapVSCodeLanguageId(doc.languageId) || undefined;

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'WattTrace: Analyzing carbon footprint…',
        cancellable: false,
      },
      async () => estimateCarbonFootprint(code, filePath, language),
    );

    resultCache.set(doc.uri.toString(), result);
    dashboardProvider.updateResult(result);

    const bd = result.carbonBreakdown;
    vscode.window.showInformationMessage(
      `WattTrace: ${result.functions.length} function(s) — ${formatCo2(bd.total.carbonGrams)} CO₂/day (User: ${formatCo2(bd.userEnd.carbonGrams)}, Server: ${formatCo2(bd.serverSide.carbonGrams)}, Dev: ${formatCo2(bd.developerEnd.carbonGrams)})`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`WattTrace: Analysis failed — ${msg}`);
  } finally {
    isAnalyzing = false;
  }
}

/** Tiered CO₂ display so tiny values are readable (not "0.0000 g") */
export function formatCo2(grams: number): string {
  if (grams >= 1)           { return `${grams.toFixed(3)} g`; }
  if (grams >= 1e-3)        { return `${(grams * 1e3).toFixed(3)} mg`; }
  if (grams >= 1e-6)        { return `${(grams * 1e6).toFixed(3)} µg`; }
  if (grams >= 1e-9)        { return `${(grams * 1e9).toFixed(3)} ng`; }
  return `${grams.toExponential(2)} g`;
}

// ── Deactivation ─────────────────────────────────────────

export function deactivate(): void {
  disposeTreeSitter();
}
