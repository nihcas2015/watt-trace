"use strict";
/**
 * WattTrace — Extension Entry Point
 *
 * Registers the carbon-footprint sidebar dashboard, commands,
 * and auto-analyse-on-save listener.  Integrates the Ollama
 * code-generation service for greener-code suggestions.
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
exports.activate = activate;
exports.formatCo2 = formatCo2;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const CarbonDashboardProvider_1 = require("./panels/CarbonDashboardProvider");
const ollamaService_1 = require("./services/ollamaService");
const index_1 = require("../carbonFootprint/index");
const languageDetection_1 = require("../carbonFootprint/languageDetection");
let dashboardProvider;
const resultCache = new Map();
let isAnalyzing = false;
// ── Activation ────────────────────────────────────────────
function activate(context) {
    (0, index_1.initializeCarbonEstimator)(context.extensionPath);
    const ollamaService = new ollamaService_1.OllamaService();
    // ── Sidebar dashboard ──────────────────────────────────
    dashboardProvider = new CarbonDashboardProvider_1.CarbonDashboardProvider(context.extensionUri, ollamaService);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(CarbonDashboardProvider_1.CarbonDashboardProvider.viewType, dashboardProvider));
    // ── Commands ───────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('watttrace.analyzeCurrentFile', () => runAnalysis()));
    context.subscriptions.push(vscode.commands.registerCommand('watttrace.openPanel', () => {
        vscode.commands.executeCommand('watttrace.carbonDashboard.focus');
    }));
    // ── Auto-analyse on save ───────────────────────────────
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((doc) => {
        const auto = vscode.workspace
            .getConfiguration('watttrace')
            .get('autoAnalyzeOnSave', false);
        if (auto && vscode.window.activeTextEditor?.document === doc) {
            runAnalysis();
        }
    }));
    // ── Re-apply cached results when the active editor changes ─
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
            const cached = resultCache.get(editor.document.uri.toString());
            if (cached) {
                dashboardProvider.updateResult(cached);
            }
        }
    }));
    // ── Cleanup ────────────────────────────────────────────
    context.subscriptions.push({ dispose: () => (0, index_1.disposeTreeSitter)() });
}
// ── Analysis runner ──────────────────────────────────────
async function runAnalysis() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('WattTrace: No active editor.');
        return;
    }
    if (isAnalyzing) {
        vscode.window.showWarningMessage('WattTrace: Analysis already in progress.');
        return;
    }
    isAnalyzing = true;
    dashboardProvider.setAnalyzing();
    try {
        const doc = editor.document;
        const code = doc.getText();
        const filePath = doc.uri.fsPath;
        const language = (0, languageDetection_1.mapVSCodeLanguageId)(doc.languageId) || undefined;
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'WattTrace: Analyzing carbon footprint…',
            cancellable: false,
        }, async () => (0, index_1.estimateCarbonFootprint)(code, filePath, language));
        resultCache.set(doc.uri.toString(), result);
        dashboardProvider.updateResult(result);
        const bd = result.carbonBreakdown;
        vscode.window.showInformationMessage(`WattTrace: ${result.functions.length} function(s) — ${formatCo2(bd.total.carbonGrams)} CO₂/day (User: ${formatCo2(bd.userEnd.carbonGrams)}, Server: ${formatCo2(bd.serverSide.carbonGrams)}, Dev: ${formatCo2(bd.developerEnd.carbonGrams)})`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`WattTrace: Analysis failed — ${msg}`);
    }
    finally {
        isAnalyzing = false;
    }
}
/** Tiered CO₂ display so tiny values are readable (not "0.0000 g") */
function formatCo2(grams) {
    if (grams >= 1) {
        return `${grams.toFixed(3)} g`;
    }
    if (grams >= 1e-3) {
        return `${(grams * 1e3).toFixed(3)} mg`;
    }
    if (grams >= 1e-6) {
        return `${(grams * 1e6).toFixed(3)} µg`;
    }
    if (grams >= 1e-9) {
        return `${(grams * 1e9).toFixed(3)} ng`;
    }
    return `${grams.toExponential(2)} g`;
}
// ── Deactivation ─────────────────────────────────────────
function deactivate() {
    (0, index_1.disposeTreeSitter)();
}
//# sourceMappingURL=extension.js.map