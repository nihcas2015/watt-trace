"use strict";
/**
 * Carbon Footprint Estimator — Language Detection
 *
 * TypeScript port of carbon_footprint_estimator.py detect_language()
 * Detects programming language from file extension or code heuristics.
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectLanguage = detectLanguage;
exports.mapVSCodeLanguageId = mapVSCodeLanguageId;
exports.getTreeSitterGrammarName = getTreeSitterGrammarName;
const path = __importStar(require("path"));
/** File extension → language mapping */
const EXT_MAP = {
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
function detectLanguage(filePath, code) {
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
function mapVSCodeLanguageId(languageId) {
    const mapping = {
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
function getTreeSitterGrammarName(language) {
    const grammarMap = {
        python: 'python',
        java: 'java',
        c: 'c',
        cpp: 'cpp',
        javascript: 'javascript',
        typescript: 'typescript',
    };
    return grammarMap[language] || language;
}
//# sourceMappingURL=languageDetection.js.map