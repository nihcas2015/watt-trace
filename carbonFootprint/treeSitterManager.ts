/**
 * Carbon Footprint Estimator — Tree-sitter Manager
 *
 * Manages tree-sitter parser initialization and grammar loading.
 * Uses web-tree-sitter (WASM-based) for VS Code extension compatibility.
 *
 * Grammar WASM files should be placed in the extension's `parsers/` directory.
 * Obtain them from https://github.com/nicolo-ribaudo/tree-sitter-wasms or build
 * from individual grammar repositories.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */

import * as path from 'path';
import * as fs from 'fs';
import Parser from 'web-tree-sitter';

type SyntaxNode = Parser.SyntaxNode;

/** Grammar name → loaded parser mapping */
const parserCache = new Map<string, Parser>();

/** Whether tree-sitter has been globally initialized */
let initialized = false;

/** Extension path for locating WASM files */
let extensionPath: string = '';

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Initialize the tree-sitter WASM runtime.
 * Must be called once before any parsing.
 *
 * @param extPath - Path to the VS Code extension root (for locating grammar WASM files)
 */
export async function initializeTreeSitter(extPath: string): Promise<void> {
  if (initialized) {
    return;
  }
  extensionPath = extPath;

  // Initialize the WASM runtime
  // web-tree-sitter needs to know where tree-sitter.wasm is
  const wasmPath = path.join(extPath, 'parsers', 'tree-sitter.wasm');
  if (fs.existsSync(wasmPath)) {
    await Parser.init({
      locateFile: () => wasmPath,
    });
  } else {
    // Fallback: let web-tree-sitter find its own WASM
    await Parser.init();
  }

  initialized = true;
}

/**
 * Load or retrieve a cached parser for the given language grammar.
 *
 * @param grammarName - Tree-sitter grammar name (e.g., 'python', 'javascript')
 * @returns Parser configured for the language, or undefined if grammar not available
 */
export async function getParser(grammarName: string): Promise<Parser | undefined> {
  if (!initialized) {
    return undefined;
  }

  // Return cached parser if available
  if (parserCache.has(grammarName)) {
    return parserCache.get(grammarName)!;
  }

  // Try to load the grammar WASM file
  const wasmFile = findGrammarWasm(grammarName);
  if (!wasmFile) {
    return undefined;
  }

  try {
    const language = await Parser.Language.load(wasmFile);
    const parser = new Parser();
    parser.setLanguage(language);
    parserCache.set(grammarName, parser);
    return parser;
  } catch (err) {
    console.warn(`[WattTrace] Failed to load tree-sitter grammar for ${grammarName}:`, err);
    return undefined;
  }
}

/**
 * Check if tree-sitter is initialized and ready.
 */
export function isTreeSitterReady(): boolean {
  return initialized;
}

/**
 * Check if a grammar is available for a given language.
 */
export function isGrammarAvailable(grammarName: string): boolean {
  return parserCache.has(grammarName) || findGrammarWasm(grammarName) !== undefined;
}

/**
 * Parse source code using tree-sitter.
 *
 * @param code - Source code string
 * @param grammarName - Tree-sitter grammar name
 * @returns Root syntax node, or undefined if parsing failed
 */
export async function parseCode(code: string, grammarName: string): Promise<SyntaxNode | undefined> {
  const parser = await getParser(grammarName);
  if (!parser) {
    return undefined;
  }

  try {
    const tree = parser.parse(code);
    return tree.rootNode;
  } catch (err) {
    console.warn(`[WattTrace] Tree-sitter parse error for ${grammarName}:`, err);
    return undefined;
  }
}

/**
 * Dispose all cached parsers and reset state.
 */
export function disposeTreeSitter(): void {
  for (const parser of parserCache.values()) {
    parser.delete();
  }
  parserCache.clear();
  initialized = false;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Find the WASM file for a grammar.
 * Searches in the extension's `parsers/` directory.
 */
function findGrammarWasm(grammarName: string): string | undefined {
  if (!extensionPath) {
    return undefined;
  }

  // Common naming patterns for grammar WASM files
  const candidates = [
    path.join(extensionPath, 'parsers', `tree-sitter-${grammarName}.wasm`),
    path.join(extensionPath, 'parsers', `${grammarName}.wasm`),
    // node_modules path (if using tree-sitter-wasms package)
    path.join(extensionPath, 'node_modules', 'tree-sitter-wasms', 'out', `tree-sitter-${grammarName}.wasm`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

// =============================================================================
// RE-EXPORT TYPES
// =============================================================================

export type { SyntaxNode };
export { Parser };
