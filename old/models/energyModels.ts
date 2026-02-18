/**
 * WattTrace — Energy Analysis Data Models
 */

/** Risk level for energy consumption */
export type EnergyRisk = 'low' | 'medium' | 'high';

/** Efficiency grade */
export type EfficiencyGrade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Raw response from the Ollama LLM */
export interface OllamaAnalysisResponse {
  function_name: string;
  energy_score: number;          // 0–100, lower = more efficient
  efficiency_percent: number;    // 0–100
  complexity: string;            // e.g. "O(n^2)"
  risk_level: string;            // "low" | "medium" | "high"
  issues: string[];
  refactor_suggestions: string[];
  estimated_savings_percent: number;
}

/** Per-function energy metric used internally */
export interface FunctionEnergyMetric {
  name: string;
  startLine: number;
  endLine: number;
  energyScore: number;           // 0–100
  efficiencyPercent: number;     // 0–100
  energyRisk: EnergyRisk;
  complexity: string;
  issues: string[];
  suggestions: string[];
  estimatedSavingsPercent: number;
  sourceCode: string;
}

/** A single refactoring suggestion */
export interface RefactorSuggestion {
  functionName: string;
  suggestion: string;
  estimatedSavingsPercent: number;
  priority: EnergyRisk;
}

/** Summary of the whole file analysis */
export interface EnergyScoreSummary {
  fileName: string;
  overallScore: number;
  overallGrade: EfficiencyGrade;
  totalFunctions: number;
  highRiskCount: number;
  mediumRiskCount: number;
  lowRiskCount: number;
  averageEfficiency: number;
  functions: FunctionEnergyMetric[];
  refactorSuggestions: RefactorSuggestion[];
  analyzedAt: Date;
}

/** Parsed function block extracted from source code */
export interface ParsedFunction {
  name: string;
  startLine: number;
  endLine: number;
  body: string;
}

/** Extension state */
export interface AnalysisState {
  isAnalyzing: boolean;
  lastResult: EnergyScoreSummary | null;
  heatmapEnabled: boolean;
}

/** Compute efficiency grade from overall score */
export function scoreToGrade(score: number): EfficiencyGrade {
  if (score <= 20) { return 'A'; }
  if (score <= 40) { return 'B'; }
  if (score <= 60) { return 'C'; }
  if (score <= 80) { return 'D'; }
  return 'F';
}

/** Normalise risk string from LLM to typed enum */
export function normalizeRisk(risk: string): EnergyRisk {
  const r = risk.trim().toLowerCase();
  if (r === 'low') { return 'low'; }
  if (r === 'medium' || r === 'moderate') { return 'medium'; }
  return 'high';
}
