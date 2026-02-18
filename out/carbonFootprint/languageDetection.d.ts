/**
 * Carbon Footprint Estimator — Language Detection
 *
 * TypeScript port of carbon_footprint_estimator.py detect_language()
 * Detects programming language from file extension or code heuristics.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */
/** Supported language identifiers */
export type SupportedLanguage = 'python' | 'java' | 'c' | 'cpp' | 'javascript' | 'typescript';
/**
 * Detect programming language from file extension or code heuristics.
 *
 * @param filePath - Optional file path for extension-based detection
 * @param code - Optional code string for heuristic detection
 * @returns Detected language identifier
 */
export declare function detectLanguage(filePath?: string, code?: string): SupportedLanguage;
/**
 * Map VS Code languageId to our supported language identifier.
 */
export declare function mapVSCodeLanguageId(languageId: string): SupportedLanguage;
/**
 * Get the tree-sitter grammar name for a language.
 * Tree-sitter uses JavaScript grammar for TypeScript in many cases,
 * but we prefer the TypeScript grammar when available.
 */
export declare function getTreeSitterGrammarName(language: SupportedLanguage): string;
//# sourceMappingURL=languageDetection.d.ts.map