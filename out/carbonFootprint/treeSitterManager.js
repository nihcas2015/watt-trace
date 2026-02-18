"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
exports.initializeTreeSitter = initializeTreeSitter;
exports.getParser = getParser;
exports.isTreeSitterReady = isTreeSitterReady;
exports.isGrammarAvailable = isGrammarAvailable;
exports.parseCode = parseCode;
exports.disposeTreeSitter = disposeTreeSitter;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const web_tree_sitter_1 = __importDefault(require("web-tree-sitter"));
exports.Parser = web_tree_sitter_1.default;
/** Grammar name → loaded parser mapping */
const parserCache = new Map();
/** Whether tree-sitter has been globally initialized */
let initialized = false;
/** Extension path for locating WASM files */
let extensionPath = '';
// =============================================================================
// PUBLIC API
// =============================================================================
/**
 * Initialize the tree-sitter WASM runtime.
 * Must be called once before any parsing.
 *
 * @param extPath - Path to the VS Code extension root (for locating grammar WASM files)
 */
async function initializeTreeSitter(extPath) {
    if (initialized) {
        return;
    }
    extensionPath = extPath;
    // Initialize the WASM runtime
    // web-tree-sitter needs to know where tree-sitter.wasm is
    const wasmPath = path.join(extPath, 'parsers', 'tree-sitter.wasm');
    if (fs.existsSync(wasmPath)) {
        await web_tree_sitter_1.default.init({
            locateFile: () => wasmPath,
        });
    }
    else {
        // Fallback: let web-tree-sitter find its own WASM
        await web_tree_sitter_1.default.init();
    }
    initialized = true;
}
/**
 * Load or retrieve a cached parser for the given language grammar.
 *
 * @param grammarName - Tree-sitter grammar name (e.g., 'python', 'javascript')
 * @returns Parser configured for the language, or undefined if grammar not available
 */
async function getParser(grammarName) {
    if (!initialized) {
        return undefined;
    }
    // Return cached parser if available
    if (parserCache.has(grammarName)) {
        return parserCache.get(grammarName);
    }
    // Try to load the grammar WASM file
    const wasmFile = findGrammarWasm(grammarName);
    if (!wasmFile) {
        return undefined;
    }
    try {
        const language = await web_tree_sitter_1.default.Language.load(wasmFile);
        const parser = new web_tree_sitter_1.default();
        parser.setLanguage(language);
        parserCache.set(grammarName, parser);
        return parser;
    }
    catch (err) {
        console.warn(`[WattTrace] Failed to load tree-sitter grammar for ${grammarName}:`, err);
        return undefined;
    }
}
/**
 * Check if tree-sitter is initialized and ready.
 */
function isTreeSitterReady() {
    return initialized;
}
/**
 * Check if a grammar is available for a given language.
 */
function isGrammarAvailable(grammarName) {
    return parserCache.has(grammarName) || findGrammarWasm(grammarName) !== undefined;
}
/**
 * Parse source code using tree-sitter.
 *
 * @param code - Source code string
 * @param grammarName - Tree-sitter grammar name
 * @returns Root syntax node, or undefined if parsing failed
 */
async function parseCode(code, grammarName) {
    const parser = await getParser(grammarName);
    if (!parser) {
        return undefined;
    }
    try {
        const tree = parser.parse(code);
        return tree.rootNode;
    }
    catch (err) {
        console.warn(`[WattTrace] Tree-sitter parse error for ${grammarName}:`, err);
        return undefined;
    }
}
/**
 * Dispose all cached parsers and reset state.
 */
function disposeTreeSitter() {
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
function findGrammarWasm(grammarName) {
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
//# sourceMappingURL=treeSitterManager.js.map