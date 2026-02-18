/**
 * Carbon Footprint Estimator — Language Detection
 *
 * TypeScript port of carbon_footprint_estimator.py detect_language()
 * Detects programming language from file extension or code heuristics.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */

import * as path from 'path';

/** Supported language identifiers */
export type SupportedLanguage = 'python' | 'java' | 'c' | 'cpp' | 'javascript' | 'typescript';

/** File extension → language mapping */
const EXT_MAP: Record<string, SupportedLanguage> = {
  '.py': 'python',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.h': 'c',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
};

/**
 * Detect programming language from file extension or code heuristics.
 *
 * @param filePath - Optional file path for extension-based detection
 * @param code - Optional code string for heuristic detection
 * @returns Detected language identifier
 */
export function detectLanguage(filePath?: string, code?: string): SupportedLanguage {
  // Try extension-based detection first
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext in EXT_MAP) {
      return EXT_MAP[ext];
    }
  }

  // Heuristic detection from code content
  if (code) {
    // Python: def keyword with colon-terminated lines
    if (/\bdef\s+\w+\s*\(/.test(code) && /:\s*$/m.test(code)) {
      return 'python';
    }
    // Java: public class declaration
    if (/\bpublic\s+(static\s+)?class\b/.test(code)) {
      return 'java';
    }
    // C: #include with printf
    if (/#include\s*</.test(code) && /\bprintf\b/.test(code)) {
      return 'c';
    }
    // C++: #include with cout/std::
    if (/#include\s*</.test(code) && /\bcout\b|\bstd::/.test(code)) {
      return 'cpp';
    }
    // TypeScript: type/interface keywords with braces
    if (/\b(interface|type)\s+\w+/.test(code) && /:\s*\w+/.test(code)) {
      return 'typescript';
    }
    // JavaScript: function keyword, arrow functions, console.log
    if (/\bfunction\b|\bconst\b.*=>|\bconsole\.log\b/.test(code)) {
      return 'javascript';
    }
  }

  // Default fallback
  return 'python';
}

/**
 * Map VS Code languageId to our supported language identifier.
 */
export function mapVSCodeLanguageId(languageId: string): SupportedLanguage {
  const mapping: Record<string, SupportedLanguage> = {
    python: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    javascript: 'javascript',
    javascriptreact: 'javascript',
    typescript: 'typescript',
    typescriptreact: 'typescript',
  };
  return mapping[languageId] || 'javascript';
}

/**
 * Get the tree-sitter grammar name for a language.
 * Tree-sitter uses JavaScript grammar for TypeScript in many cases,
 * but we prefer the TypeScript grammar when available.
 */
export function getTreeSitterGrammarName(language: SupportedLanguage): string {
  const grammarMap: Record<SupportedLanguage, string> = {
    python: 'python',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    javascript: 'javascript',
    typescript: 'typescript',
  };
  return grammarMap[language] || language;
}
