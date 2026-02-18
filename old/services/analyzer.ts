/**
 * WattTrace — Analysis Engine
 *
 * Core service that orchestrates function extraction, LLM calls,
 * and result aggregation.
 */

import * as vscode from 'vscode';
import { OllamaClient } from './ollamaClient';
import { extractFunctions } from '../utils/functionParser';
import {
  FunctionEnergyMetric,
  EnergyScoreSummary,
  RefactorSuggestion,
  normalizeRisk,
  scoreToGrade,
  ParsedFunction,
} from '../models/energyModels';

export class Analyzer {
  private readonly ollama: OllamaClient;

  constructor() {
    this.ollama = new OllamaClient();
  }

  /**
   * Analyse every function in the given document.
   * Reports progress via the VS Code progress API.
   */
  async analyzeDocument(
    document: vscode.TextDocument,
    progress?: vscode.Progress<{ message?: string; increment?: number }>,
    token?: vscode.CancellationToken,
  ): Promise<EnergyScoreSummary> {
    const source = document.getText();
    const languageId = document.languageId;
    const functions = extractFunctions(source, languageId);

    if (functions.length === 0) {
      return this.emptySummary(document.fileName);
    }

    const metrics: FunctionEnergyMetric[] = [];
    const increment = 100 / functions.length;

    for (const fn of functions) {
      if (token?.isCancellationRequested) {
        break;
      }

      progress?.report({ message: `Analyzing ${fn.name}…`, increment });

      try {
        const metric = await this.analyzeFunction(fn, languageId);
        metrics.push(metric);
      } catch (err) {
        // If one function fails, create a fallback metric and continue
        metrics.push(this.fallbackMetric(fn, err));
      }
    }

    return this.buildSummary(document.fileName, metrics);
  }

  /**
   * Check Ollama connectivity.
   */
  async checkConnection(): Promise<boolean> {
    return this.ollama.ping();
  }

  // ── private ────────────────────────────────────────────────────

  private async analyzeFunction(fn: ParsedFunction, languageId: string): Promise<FunctionEnergyMetric> {
    const result = await this.ollama.analyzeFunction(fn.body, languageId);

    return {
      name: result.function_name || fn.name,
      startLine: fn.startLine,
      endLine: fn.endLine,
      energyScore: clamp(result.energy_score, 0, 100),
      efficiencyPercent: clamp(result.efficiency_percent, 0, 100),
      energyRisk: normalizeRisk(result.risk_level),
      complexity: result.complexity,
      issues: result.issues,
      suggestions: result.refactor_suggestions,
      estimatedSavingsPercent: clamp(result.estimated_savings_percent, 0, 100),
      sourceCode: fn.body,
    };
  }

  private fallbackMetric(fn: ParsedFunction, _err: unknown): FunctionEnergyMetric {
    return {
      name: fn.name,
      startLine: fn.startLine,
      endLine: fn.endLine,
      energyScore: 50,
      efficiencyPercent: 50,
      energyRisk: 'medium',
      complexity: 'Unknown',
      issues: ['Analysis failed — check Ollama connection'],
      suggestions: [],
      estimatedSavingsPercent: 0,
      sourceCode: fn.body,
    };
  }

  private buildSummary(fileName: string, metrics: FunctionEnergyMetric[]): EnergyScoreSummary {
    const total = metrics.length;
    const avgScore = total > 0
      ? Math.round(metrics.reduce((s, m) => s + m.energyScore, 0) / total)
      : 0;
    const avgEfficiency = total > 0
      ? Math.round(metrics.reduce((s, m) => s + m.efficiencyPercent, 0) / total)
      : 100;

    const refactorSuggestions: RefactorSuggestion[] = [];
    for (const m of metrics) {
      for (const s of m.suggestions) {
        refactorSuggestions.push({
          functionName: m.name,
          suggestion: s,
          estimatedSavingsPercent: m.estimatedSavingsPercent,
          priority: m.energyRisk,
        });
      }
    }

    // Sort by priority: high > medium > low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    refactorSuggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return {
      fileName,
      overallScore: avgScore,
      overallGrade: scoreToGrade(avgScore),
      totalFunctions: total,
      highRiskCount: metrics.filter(m => m.energyRisk === 'high').length,
      mediumRiskCount: metrics.filter(m => m.energyRisk === 'medium').length,
      lowRiskCount: metrics.filter(m => m.energyRisk === 'low').length,
      averageEfficiency: avgEfficiency,
      functions: metrics,
      refactorSuggestions,
      analyzedAt: new Date(),
    };
  }

  private emptySummary(fileName: string): EnergyScoreSummary {
    return {
      fileName,
      overallScore: 0,
      overallGrade: 'A',
      totalFunctions: 0,
      highRiskCount: 0,
      mediumRiskCount: 0,
      lowRiskCount: 0,
      averageEfficiency: 100,
      functions: [],
      refactorSuggestions: [],
      analyzedAt: new Date(),
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
