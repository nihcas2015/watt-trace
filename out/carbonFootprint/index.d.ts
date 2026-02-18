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
import { AnalysisResult } from './models';
export { OpType } from './constants';
export { ENERGY_PER_OPERATION_JOULES, CARBON_INTENSITY_G_PER_KWH, DEFAULT_LOOP_ITERATIONS, DEFAULT_RECURSION_DEPTH, ASSUMED_DAILY_USER_EXECUTIONS, ASSUMED_DAILY_SERVER_REQUESTS, SERVER_PUE, DEV_ENVIRONMENT_MULTIPLIER, } from './constants';
export { OperationCount, FunctionAnalysis, AnalysisResult, CarbonBreakdown, CategoryFootprint } from './models';
export { SupportedLanguage, detectLanguage } from './languageDetection';
export { initializeTreeSitter, isTreeSitterReady, disposeTreeSitter } from './treeSitterManager';
/**
 * Initialize the carbon footprint estimator.
 * Call this once during extension activation.
 *
 * @param extensionPath — absolute path to the extension root
 *   (used to find tree-sitter WASM grammar files in `parsers/` subdirectory)
 */
export declare function initializeCarbonEstimator(extensionPath: string): Promise<void>;
/**
 * Estimate the carbon footprint of source code.
 *
 * This is the main entry point — it detects the language, picks the best
 * available analyzer (tree-sitter or regex), analyzes the code, and
 * returns a full AnalysisResult.
 */
export declare function estimateCarbonFootprint(code: string, filePath?: string, languageOverride?: string): Promise<AnalysisResult>;
/**
 * Synchronous version — uses regex analyzer only (no tree-sitter).
 * Useful when you can't await or tree-sitter isn't needed.
 */
export declare function estimateCarbonFootprintSync(code: string, filePath?: string, languageOverride?: string): AnalysisResult;
/**
 * Get a JSON-serializable results dictionary.
 * Convenience wrapper around estimateCarbonFootprint + toDict.
 */
export declare function analyzeToJson(code: string, filePath?: string, language?: string): Promise<Record<string, unknown>>;
/**
 * Save analysis results to a JSON file.
 */
export declare function saveResultJson(result: AnalysisResult, outputPath: string): Promise<void>;
//# sourceMappingURL=index.d.ts.map