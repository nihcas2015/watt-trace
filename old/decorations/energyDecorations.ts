/**
 * WattTrace — Editor Decorations
 *
 * Applies inline energy badges, gutter icons, and heatmap
 * background highlighting to the active editor.
 */

import * as vscode from 'vscode';
import { EnergyScoreSummary, FunctionEnergyMetric, EnergyRisk } from '../models/energyModels';

// ── Decoration types (created once per session) ─────────────────

const badgeDecorationTypes = new Map<EnergyRisk, vscode.TextEditorDecorationType>();

function getBadgeDecorationType(risk: EnergyRisk): vscode.TextEditorDecorationType {
  if (badgeDecorationTypes.has(risk)) {
    return badgeDecorationTypes.get(risk)!;
  }

  const colors: Record<EnergyRisk, { bg: string; fg: string; border: string }> = {
    low:    { bg: 'rgba(40,167,69,0.15)',  fg: '#28a745', border: '#28a745' },
    medium: { bg: 'rgba(255,193,7,0.15)',  fg: '#ffc107', border: '#ffc107' },
    high:   { bg: 'rgba(220,53,69,0.15)',  fg: '#dc3545', border: '#dc3545' },
  };

  const c = colors[risk];

  const type = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 1em',
      color: c.fg,
      fontWeight: 'normal',
      fontStyle: 'normal',
    },
    isWholeLine: false,
  });

  badgeDecorationTypes.set(risk, type);
  return type;
}

let heatmapDecorationType: vscode.TextEditorDecorationType | undefined;

function getHeatmapDecorationType(): vscode.TextEditorDecorationType {
  if (!heatmapDecorationType) {
    heatmapDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      // Actual ranges set per-decoration
    });
  }
  return heatmapDecorationType;
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Apply energy badges beside each analysed function definition line.
 */
export function applyBadges(editor: vscode.TextEditor, summary: EnergyScoreSummary): void {
  const showBadges = vscode.workspace.getConfiguration('watttrace').get<boolean>('showBadges', true);
  if (!showBadges) {
    clearDecorations(editor);
    return;
  }

  const byRisk: Record<EnergyRisk, vscode.DecorationOptions[]> = {
    low: [],
    medium: [],
    high: [],
  };

  for (const fn of summary.functions) {
    const line = fn.startLine - 1; // 0-indexed
    if (line < 0 || line >= editor.document.lineCount) { continue; }

    const label = badgeLabel(fn);
    const hoverMessage = buildHoverMarkdown(fn);

    const range = new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length);

    byRisk[fn.energyRisk].push({
      range,
      hoverMessage,
      renderOptions: {
        after: {
          contentText: label,
        },
      },
    });
  }

  for (const risk of ['low', 'medium', 'high'] as EnergyRisk[]) {
    editor.setDecorations(getBadgeDecorationType(risk), byRisk[risk]);
  }
}

/**
 * Apply heatmap background colouring across function ranges.
 */
export function applyHeatmap(editor: vscode.TextEditor, summary: EnergyScoreSummary): void {
  const enabled = vscode.workspace.getConfiguration('watttrace').get<boolean>('enableHeatmap', true);
  if (!enabled) {
    clearHeatmap(editor);
    return;
  }

  // Create per-function decoration types for individual colours
  disposeHeatmapTypes();

  for (const fn of summary.functions) {
    const color = heatmapColor(fn.energyScore);
    const type = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: color,
    });
    heatmapTypes.push(type);

    const startLine = Math.max(fn.startLine - 1, 0);
    const endLine = Math.min(fn.endLine - 1, editor.document.lineCount - 1);
    const range = new vscode.Range(startLine, 0, endLine, 0);

    editor.setDecorations(type, [{ range }]);
  }
}

/**
 * Clear all WattTrace decorations from the editor.
 */
export function clearDecorations(editor: vscode.TextEditor): void {
  for (const risk of ['low', 'medium', 'high'] as EnergyRisk[]) {
    if (badgeDecorationTypes.has(risk)) {
      editor.setDecorations(badgeDecorationTypes.get(risk)!, []);
    }
  }
  clearHeatmap(editor);
}

/**
 * Dispose all decoration types (call on deactivate).
 */
export function disposeAllDecorations(): void {
  for (const [, type] of badgeDecorationTypes) {
    type.dispose();
  }
  badgeDecorationTypes.clear();
  heatmapDecorationType?.dispose();
  heatmapDecorationType = undefined;
  disposeHeatmapTypes();
}

// ── private helpers ─────────────────────────────────────────────

const heatmapTypes: vscode.TextEditorDecorationType[] = [];

function disposeHeatmapTypes(): void {
  for (const t of heatmapTypes) { t.dispose(); }
  heatmapTypes.length = 0;
}

function clearHeatmap(editor: vscode.TextEditor): void {
  if (heatmapDecorationType) {
    editor.setDecorations(heatmapDecorationType, []);
  }
  disposeHeatmapTypes();
}

function badgeLabel(fn: FunctionEnergyMetric): string {
  const icon = fn.energyRisk === 'low' ? '⚡' : fn.energyRisk === 'medium' ? '⚠️' : '🔥';
  return `  ${icon} Energy: ${fn.energyScore}/100  •  ${fn.complexity}`;
}

function buildHoverMarkdown(fn: FunctionEnergyMetric): vscode.MarkdownString {
  const riskBadge = fn.energyRisk === 'low' ? '🟢' : fn.energyRisk === 'medium' ? '🟡' : '🔴';

  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = true;

  md.appendMarkdown(`### ${riskBadge} WattTrace — ${fn.name}\n\n`);
  md.appendMarkdown(`| Metric | Value |\n|---|---|\n`);
  md.appendMarkdown(`| Energy Score | **${fn.energyScore}** / 100 |\n`);
  md.appendMarkdown(`| Efficiency | **${fn.efficiencyPercent}%** |\n`);
  md.appendMarkdown(`| Complexity | \`${fn.complexity}\` |\n`);
  md.appendMarkdown(`| Risk Level | **${fn.energyRisk.toUpperCase()}** |\n`);
  md.appendMarkdown(`| Est. Savings | **${fn.estimatedSavingsPercent}%** |\n\n`);

  if (fn.issues.length > 0) {
    md.appendMarkdown(`**Issues:**\n`);
    for (const issue of fn.issues) {
      md.appendMarkdown(`- ${issue}\n`);
    }
    md.appendMarkdown('\n');
  }

  if (fn.suggestions.length > 0) {
    md.appendMarkdown(`**Suggestions:**\n`);
    for (const s of fn.suggestions) {
      md.appendMarkdown(`- ${s}\n`);
    }
  }

  return md;
}

function heatmapColor(score: number): string {
  // 0 → green, 50 → yellow, 100 → red (with low alpha)
  if (score <= 30) {
    return 'rgba(40,167,69,0.07)';
  }
  if (score <= 60) {
    return 'rgba(255,193,7,0.07)';
  }
  return 'rgba(220,53,69,0.07)';
}
