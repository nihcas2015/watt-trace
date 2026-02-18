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
import Parser from 'web-tree-sitter';
type SyntaxNode = Parser.SyntaxNode;
/**
 * Initialize the tree-sitter WASM runtime.
 * Must be called once before any parsing.
 *
 * @param extPath - Path to the VS Code extension root (for locating grammar WASM files)
 */
export declare function initializeTreeSitter(extPath: string): Promise<void>;
/**
 * Load or retrieve a cached parser for the given language grammar.
 *
 * @param grammarName - Tree-sitter grammar name (e.g., 'python', 'javascript')
 * @returns Parser configured for the language, or undefined if grammar not available
 */
export declare function getParser(grammarName: string): Promise<Parser | undefined>;
/**
 * Check if tree-sitter is initialized and ready.
 */
export declare function isTreeSitterReady(): boolean;
/**
 * Check if a grammar is available for a given language.
 */
export declare function isGrammarAvailable(grammarName: string): boolean;
/**
 * Parse source code using tree-sitter.
 *
 * @param code - Source code string
 * @param grammarName - Tree-sitter grammar name
 * @returns Root syntax node, or undefined if parsing failed
 */
export declare function parseCode(code: string, grammarName: string): Promise<SyntaxNode | undefined>;
/**
 * Dispose all cached parsers and reset state.
 */
export declare function disposeTreeSitter(): void;
export type { SyntaxNode };
export { Parser };
//# sourceMappingURL=treeSitterManager.d.ts.map