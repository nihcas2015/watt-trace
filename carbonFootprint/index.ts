/**
 * Carbon Footprint Estimator — Main API & Factory
 *
 * TypeScript port of carbon_footprint_estimator.py's public API.
 *
 * Provides:
 *   - estimateCarbonFootprint()  — one-call analysis of source code
 *   - getAnalyzer()              — factory that returns the best available analyzer
 *   - initializeCarbonEstimator() — async setup for tree-sitter (call once at activation)
 *
 * Strategy: try tree-sitter first (accurate AST), fall back to regex (always available).
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */

import * as path from 'path';
import {
  initializeTreeSitter,
  parseCode,
  isTreeSitterReady,
  isGrammarAvailable,
  disposeTreeSitter,
} from './treeSitterManager';
import { detectLanguage, getTreeSitterGrammarName, SupportedLanguage } from './languageDetection';
import { AnalysisResult } from './models';
import { PythonTreeSitterAnalyzer } from './pythonTreeSitterAnalyzer';
import { CFamilyTreeSitterAnalyzer } from './cFamilyTreeSitterAnalyzer';
import { RegexAnalyzer } from './regexAnalyzer';

// Re-export public types
export { OpType } from './constants';
export {
  ENERGY_PER_OPERATION_JOULES,
  CARBON_INTENSITY_G_PER_KWH,
  DEFAULT_LOOP_ITERATIONS,
  DEFAULT_RECURSION_DEPTH,
  ASSUMED_DAILY_USER_EXECUTIONS,
  ASSUMED_DAILY_SERVER_REQUESTS,
  SERVER_PUE,
  DEV_ENVIRONMENT_MULTIPLIER,
} from './constants';
export { OperationCount, FunctionAnalysis, AnalysisResult, CarbonBreakdown, CategoryFootprint } from './models';
export { SupportedLanguage, detectLanguage } from './languageDetection';
export { initializeTreeSitter, isTreeSitterReady, disposeTreeSitter } from './treeSitterManager';

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Initialize the carbon footprint estimator.
 * Call this once during extension activation.
 *
 * @param extensionPath — absolute path to the extension root
 *   (used to find tree-sitter WASM grammar files in `parsers/` subdirectory)
 */
export async function initializeCarbonEstimator(extensionPath: string): Promise<void> {
  try {
    await initializeTreeSitter(extensionPath);
    console.log('[CarbonEstimator] Tree-sitter initialized successfully');
  } catch (err) {
    console.warn('[CarbonEstimator] Tree-sitter initialization failed, using regex fallback:', err);
  }
}

/**
 * Estimate the carbon footprint of source code.
 *
 * This is the main entry point — it detects the language, picks the best
 * available analyzer (tree-sitter or regex), analyzes the code, and
 * returns a full AnalysisResult.
 */
export async function estimateCarbonFootprint(
  code: string,
  filePath?: string,
  languageOverride?: string,
): Promise<AnalysisResult> {
  // Detect language
  const language = (languageOverride as SupportedLanguage)
    || detectLanguage(filePath, code);

  if (!language) {
    const result = new AnalysisResult('unknown', filePath || null);
    result.assumptions.push('Language could not be detected — no analysis performed');
    return result;
  }

  // Try tree-sitter first
  if (isTreeSitterReady()) {
    const grammarName = getTreeSitterGrammarName(language);
    if (grammarName && isGrammarAvailable(grammarName)) {
      try {
        const rootNode = await parseCode(code, grammarName);
        if (rootNode) {
          if (language === 'python') {
            const analyzer = new PythonTreeSitterAnalyzer();
            return analyzer.analyze(rootNode, filePath);
          } else {
            const analyzer = new CFamilyTreeSitterAnalyzer(language);
            return analyzer.analyze(rootNode, filePath);
          }
        }
      } catch (err) {
        console.warn(`[CarbonEstimator] Tree-sitter analysis failed for ${language}, falling back to regex:`, err);
      }
    }
  }

  // Fallback to regex analyzer
  const regexAnalyzer = new RegexAnalyzer(language);
  return regexAnalyzer.analyze(code, filePath);
}

/**
 * Synchronous version — uses regex analyzer only (no tree-sitter).
 * Useful when you can't await or tree-sitter isn't needed.
 */
export function estimateCarbonFootprintSync(
  code: string,
  filePath?: string,
  languageOverride?: string,
): AnalysisResult {
  const language = (languageOverride as SupportedLanguage)
    || detectLanguage(filePath, code);

  if (!language) {
    const result = new AnalysisResult('unknown', filePath || null);
    result.assumptions.push('Language could not be detected — no analysis performed');
    return result;
  }

  const regexAnalyzer = new RegexAnalyzer(language);
  return regexAnalyzer.analyze(code, filePath);
}

/**
 * Get a JSON-serializable results dictionary.
 * Convenience wrapper around estimateCarbonFootprint + toDict.
 */
export async function analyzeToJson(
  code: string,
  filePath?: string,
  language?: string,
): Promise<Record<string, unknown>> {
  const result = await estimateCarbonFootprint(code, filePath, language);
  return result.toDict();
}

/**
 * Save analysis results to a JSON file.
 */
export async function saveResultJson(
  result: AnalysisResult,
  outputPath: string,
): Promise<void> {
  const fs = await import('fs');
  const json = JSON.stringify(result.toDict(), null, 2);
  fs.writeFileSync(outputPath, json, 'utf-8');
}
