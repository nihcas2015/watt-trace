"use strict";
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
exports.disposeTreeSitter = exports.isTreeSitterReady = exports.initializeTreeSitter = exports.detectLanguage = exports.AnalysisResult = exports.FunctionAnalysis = exports.OperationCount = exports.DEV_ENVIRONMENT_MULTIPLIER = exports.SERVER_PUE = exports.ASSUMED_DAILY_SERVER_REQUESTS = exports.ASSUMED_DAILY_USER_EXECUTIONS = exports.DEFAULT_RECURSION_DEPTH = exports.DEFAULT_LOOP_ITERATIONS = exports.CARBON_INTENSITY_G_PER_KWH = exports.ENERGY_PER_OPERATION_JOULES = exports.OpType = void 0;
exports.initializeCarbonEstimator = initializeCarbonEstimator;
exports.estimateCarbonFootprint = estimateCarbonFootprint;
exports.estimateCarbonFootprintSync = estimateCarbonFootprintSync;
exports.analyzeToJson = analyzeToJson;
exports.saveResultJson = saveResultJson;
const treeSitterManager_1 = require("./treeSitterManager");
const languageDetection_1 = require("./languageDetection");
const models_1 = require("./models");
const pythonTreeSitterAnalyzer_1 = require("./pythonTreeSitterAnalyzer");
const cFamilyTreeSitterAnalyzer_1 = require("./cFamilyTreeSitterAnalyzer");
const regexAnalyzer_1 = require("./regexAnalyzer");
// Re-export public types
var constants_1 = require("./constants");
Object.defineProperty(exports, "OpType", { enumerable: true, get: function () { return constants_1.OpType; } });
var constants_2 = require("./constants");
Object.defineProperty(exports, "ENERGY_PER_OPERATION_JOULES", { enumerable: true, get: function () { return constants_2.ENERGY_PER_OPERATION_JOULES; } });
Object.defineProperty(exports, "CARBON_INTENSITY_G_PER_KWH", { enumerable: true, get: function () { return constants_2.CARBON_INTENSITY_G_PER_KWH; } });
Object.defineProperty(exports, "DEFAULT_LOOP_ITERATIONS", { enumerable: true, get: function () { return constants_2.DEFAULT_LOOP_ITERATIONS; } });
Object.defineProperty(exports, "DEFAULT_RECURSION_DEPTH", { enumerable: true, get: function () { return constants_2.DEFAULT_RECURSION_DEPTH; } });
Object.defineProperty(exports, "ASSUMED_DAILY_USER_EXECUTIONS", { enumerable: true, get: function () { return constants_2.ASSUMED_DAILY_USER_EXECUTIONS; } });
Object.defineProperty(exports, "ASSUMED_DAILY_SERVER_REQUESTS", { enumerable: true, get: function () { return constants_2.ASSUMED_DAILY_SERVER_REQUESTS; } });
Object.defineProperty(exports, "SERVER_PUE", { enumerable: true, get: function () { return constants_2.SERVER_PUE; } });
Object.defineProperty(exports, "DEV_ENVIRONMENT_MULTIPLIER", { enumerable: true, get: function () { return constants_2.DEV_ENVIRONMENT_MULTIPLIER; } });
var models_2 = require("./models");
Object.defineProperty(exports, "OperationCount", { enumerable: true, get: function () { return models_2.OperationCount; } });
Object.defineProperty(exports, "FunctionAnalysis", { enumerable: true, get: function () { return models_2.FunctionAnalysis; } });
Object.defineProperty(exports, "AnalysisResult", { enumerable: true, get: function () { return models_2.AnalysisResult; } });
var languageDetection_2 = require("./languageDetection");
Object.defineProperty(exports, "detectLanguage", { enumerable: true, get: function () { return languageDetection_2.detectLanguage; } });
var treeSitterManager_2 = require("./treeSitterManager");
Object.defineProperty(exports, "initializeTreeSitter", { enumerable: true, get: function () { return treeSitterManager_2.initializeTreeSitter; } });
Object.defineProperty(exports, "isTreeSitterReady", { enumerable: true, get: function () { return treeSitterManager_2.isTreeSitterReady; } });
Object.defineProperty(exports, "disposeTreeSitter", { enumerable: true, get: function () { return treeSitterManager_2.disposeTreeSitter; } });
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
async function initializeCarbonEstimator(extensionPath) {
    try {
        await (0, treeSitterManager_1.initializeTreeSitter)(extensionPath);
        console.log('[CarbonEstimator] Tree-sitter initialized successfully');
    }
    catch (err) {
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
async function estimateCarbonFootprint(code, filePath, languageOverride) {
    // Detect language
    const language = languageOverride
        || (0, languageDetection_1.detectLanguage)(filePath, code);
    if (!language) {
        const result = new models_1.AnalysisResult('unknown', filePath || null);
        result.assumptions.push('Language could not be detected — no analysis performed');
        return result;
    }
    // Try tree-sitter first
    if ((0, treeSitterManager_1.isTreeSitterReady)()) {
        const grammarName = (0, languageDetection_1.getTreeSitterGrammarName)(language);
        if (grammarName && (0, treeSitterManager_1.isGrammarAvailable)(grammarName)) {
            try {
                const rootNode = await (0, treeSitterManager_1.parseCode)(code, grammarName);
                if (rootNode) {
                    if (language === 'python') {
                        const analyzer = new pythonTreeSitterAnalyzer_1.PythonTreeSitterAnalyzer();
                        return analyzer.analyze(rootNode, filePath);
                    }
                    else {
                        const analyzer = new cFamilyTreeSitterAnalyzer_1.CFamilyTreeSitterAnalyzer(language);
                        return analyzer.analyze(rootNode, filePath);
                    }
                }
            }
            catch (err) {
                console.warn(`[CarbonEstimator] Tree-sitter analysis failed for ${language}, falling back to regex:`, err);
            }
        }
    }
    // Fallback to regex analyzer
    const regexAnalyzer = new regexAnalyzer_1.RegexAnalyzer(language);
    return regexAnalyzer.analyze(code, filePath);
}
/**
 * Synchronous version — uses regex analyzer only (no tree-sitter).
 * Useful when you can't await or tree-sitter isn't needed.
 */
function estimateCarbonFootprintSync(code, filePath, languageOverride) {
    const language = languageOverride
        || (0, languageDetection_1.detectLanguage)(filePath, code);
    if (!language) {
        const result = new models_1.AnalysisResult('unknown', filePath || null);
        result.assumptions.push('Language could not be detected — no analysis performed');
        return result;
    }
    const regexAnalyzer = new regexAnalyzer_1.RegexAnalyzer(language);
    return regexAnalyzer.analyze(code, filePath);
}
/**
 * Get a JSON-serializable results dictionary.
 * Convenience wrapper around estimateCarbonFootprint + toDict.
 */
async function analyzeToJson(code, filePath, language) {
    const result = await estimateCarbonFootprint(code, filePath, language);
    return result.toDict();
}
/**
 * Save analysis results to a JSON file.
 */
async function saveResultJson(result, outputPath) {
    const fs = await Promise.resolve().then(() => __importStar(require('fs')));
    const json = JSON.stringify(result.toDict(), null, 2);
    fs.writeFileSync(outputPath, json, 'utf-8');
}
//# sourceMappingURL=index.js.map