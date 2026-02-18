/**
 * WattTrace — Extension Entry Point
 *
 * Registers commands, sidebar provider, decorations, status bar,
 * and auto-analyse-on-save listener.
 */

import * as vscode from 'vscode';
import { Analyzer } from './services/analyzer';
import { WattTraceSidebarProvider } from './panels/WattTracePanel';
import { StatusBarController } from './utils/statusBar';
import {
  applyBadges,
  applyHeatmap,
  clearDecorations,
  disposeAllDecorations,
} from '../src/decorations/energyDecorations';
import { AnalysisState, EnergyScoreSummary } from './models/energyModels';

let analyzer: Analyzer;
let sidebarProvider: WattTraceSidebarProvider;
let statusBar: StatusBarController;

const state: AnalysisState = {
  isAnalyzing: false,
  lastResult: null,
  heatmapEnabled: true,
};

// Keep results per-file so switching editors re-applies decorations
const resultCache = new Map<string, EnergyScoreSummary>();

export function activate(context: vscode.ExtensionContext): void {
  analyzer = new Analyzer();
  statusBar = new StatusBarController();
  sidebarProvider = new WattTraceSidebarProvider(context.extensionUri);

  // ── Sidebar ────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WattTraceSidebarProvider.viewType,
      sidebarProvider,
    ),
  );

  // ── Commands ───────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('watttrace.analyzeCurrentFile', () => runAnalysis()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('watttrace.toggleHeatmap', () => {
      state.heatmapEnabled = !state.heatmapEnabled;
      const editor = vscode.window.activeTextEditor;
      if (editor && state.lastResult) {
        if (state.heatmapEnabled) {
          applyHeatmap(editor, state.lastResult);
        } else {
          clearDecorations(editor);
          applyBadges(editor, state.lastResult);
        }
      }
      vscode.window.showInformationMessage(
        `WattTrace: Energy heatmap ${state.heatmapEnabled ? 'enabled' : 'disabled'}`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('watttrace.openPanel', () => {
      vscode.commands.executeCommand('watttrace.sidebarView.focus');
    }),
  );

  // ── Auto-analyse on save ───────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const autoAnalyze = vscode.workspace.getConfiguration('watttrace').get<boolean>('autoAnalyzeOnSave', false);
      if (autoAnalyze && vscode.window.activeTextEditor?.document === doc) {
        runAnalysis();
      }
    }),
  );

  // ── Re-apply decorations when editor changes ──────────────

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const cached = resultCache.get(editor.document.uri.toString());
        if (cached) {
          state.lastResult = cached;
          applyBadges(editor, cached);
          if (state.heatmapEnabled) {
            applyHeatmap(editor, cached);
          }
          statusBar.setResult(cached);
          sidebarProvider.updateResults(cached);
        } else {
          statusBar.setIdle();
        }
      }
    }),
  );

  // ── Cleanup ────────────────────────────────────────────────

  context.subscriptions.push({ dispose: () => statusBar.dispose() });
  context.subscriptions.push({ dispose: () => disposeAllDecorations() });
}

// ── Analysis runner ──────────────────────────────────────────

async function runAnalysis(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('WattTrace: No active editor.');
    return;
  }

  if (state.isAnalyzing) {
    vscode.window.showWarningMessage('WattTrace: Analysis already in progress.');
    return;
  }

  // Quick connectivity check
  const alive = await analyzer.checkConnection();
  if (!alive) {
    vscode.window.showErrorMessage(
      'WattTrace: Cannot reach Ollama. Ensure it is running at ' +
      vscode.workspace.getConfiguration('watttrace').get<string>('ollamaEndpoint', 'http://localhost:11434'),
    );
    statusBar.setError('Ollama not reachable');
    return;
  }

  state.isAnalyzing = true;
  statusBar.setAnalyzing();
  sidebarProvider.setAnalyzing();

  try {
    const summary = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'WattTrace: Analyzing energy efficiency…',
        cancellable: true,
      },
      (progress, token) => analyzer.analyzeDocument(editor.document, progress, token),
    );

    state.lastResult = summary;
    resultCache.set(editor.document.uri.toString(), summary);

    // Update UI
    applyBadges(editor, summary);
    if (state.heatmapEnabled) {
      applyHeatmap(editor, summary);
    }
    statusBar.setResult(summary);
    sidebarProvider.updateResults(summary);

    vscode.window.showInformationMessage(
      `WattTrace: Analyzed ${summary.totalFunctions} function(s) — Grade ${summary.overallGrade}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`WattTrace: Analysis failed — ${msg}`);
    statusBar.setError(msg);
  } finally {
    state.isAnalyzing = false;
  }
}

export function deactivate(): void {
  disposeAllDecorations();
}
