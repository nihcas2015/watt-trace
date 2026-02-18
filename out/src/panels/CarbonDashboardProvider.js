"use strict";
/**
 * WattTrace — Sidebar Carbon Footprint Dashboard (Webview Provider)
 *
 * Renders a left-sidebar webview that shows:
 *   1. Overall carbon footprint summary with animated grade badge
 *   2. Per-function hotspot list with progress bars & risk indicators
 *   3. "Suggest greener code" buttons wired to Ollama (qwen2.5-coder:3b)
 *
 * Supports cool CSS animations: gradient backgrounds, fade-ins,
 * pulse effects, slide-in rows, animated bar fills, and glow effects.
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
exports.CarbonDashboardProvider = void 0;
const vscode = __importStar(require("vscode"));
const extension_1 = require("../extension");
class CarbonDashboardProvider {
    extensionUri;
    ollamaService;
    static viewType = 'watttrace.carbonDashboard';
    _view;
    _result = null;
    _isAnalyzing = false;
    _pendingSuggestion = null; // fn name being processed
    constructor(extensionUri, ollamaService) {
        this.extensionUri = extensionUri;
        this.ollamaService = ollamaService;
    }
    // ── WebviewViewProvider ──────────────────────────────────
    resolveWebviewView(webviewView, _ctx, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'revealFunction':
                    this.revealFunction(msg.line);
                    break;
                case 'suggestFix':
                    await this.handleSuggestFix(msg.functionName, msg.line);
                    break;
                case 'reanalyze':
                    vscode.commands.executeCommand('watttrace.analyzeCurrentFile');
                    break;
            }
        });
        this.render();
    }
    // ── Public API ───────────────────────────────────────────
    updateResult(result) {
        this._result = result;
        this._isAnalyzing = false;
        this._pendingSuggestion = null;
        this.render();
    }
    setAnalyzing() {
        this._isAnalyzing = true;
        this.render();
    }
    clear() {
        this._result = null;
        this._isAnalyzing = false;
        this._pendingSuggestion = null;
        this.render();
    }
    // ── Ollama integration ──────────────────────────────────
    async handleSuggestFix(functionName, line) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !this._result) {
            vscode.window.showWarningMessage('WattTrace: No active editor or analysis results.');
            return;
        }
        // Find the function in results
        const fnData = this._result.functions.find((f) => f.name === functionName && f.lineNumber === line);
        if (!fnData) {
            vscode.window.showWarningMessage(`WattTrace: Could not find function "${functionName}".`);
            return;
        }
        // Extract the function source code from the editor
        const doc = editor.document;
        const functionCode = this.extractFunctionCode(doc, fnData);
        if (!functionCode) {
            vscode.window.showWarningMessage('WattTrace: Could not extract function source code.');
            return;
        }
        // Check Ollama connectivity
        const alive = await this.ollamaService.ping();
        if (!alive) {
            vscode.window.showErrorMessage('WattTrace: Cannot reach Ollama. Make sure it is running (ollama serve).');
            return;
        }
        // Show loading state in dashboard
        this._pendingSuggestion = functionName;
        this.render();
        try {
            const suggestion = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `WattTrace: Generating greener "${functionName}"…`,
                cancellable: false,
            }, () => this.ollamaService.suggestGreenerCode(functionCode, functionName, this._result.language, fnData.carbonGrams, fnData.weightedOps));
            this._pendingSuggestion = null;
            this.render();
            await this.showSuggestionPanel(suggestion, functionCode);
        }
        catch (err) {
            this._pendingSuggestion = null;
            this.render();
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`WattTrace: Ollama error — ${msg}`);
        }
    }
    extractFunctionCode(doc, fn) {
        const startLine = fn.lineNumber - 1; // 0-based
        if (startLine < 0 || startLine >= doc.lineCount) {
            return null;
        }
        const endLine = Math.min(startLine + 200, doc.lineCount);
        const firstLine = doc.lineAt(startLine).text;
        const isPython = this._result?.language === 'python';
        // ── Python: indentation-based extraction ──────────────
        if (isPython || /^\s*(?:async\s+)?def\s+/.test(firstLine)) {
            return this.extractPythonFunction(doc, startLine, endLine);
        }
        // ── Brace-based languages (C, Java, JS, TS, etc.) ────
        return this.extractBraceFunction(doc, startLine, endLine);
    }
    /** Extract a Python function using indentation depth */
    extractPythonFunction(doc, startLine, endLine) {
        const defLine = doc.lineAt(startLine).text;
        const baseIndent = defLine.search(/\S/);
        const lines = [defLine];
        for (let i = startLine + 1; i < endLine; i++) {
            const lt = doc.lineAt(i).text;
            // Blank lines inside the function body are fine
            if (lt.trim() === '') {
                lines.push(lt);
                continue;
            }
            const indent = lt.search(/\S/);
            // A line at the same or lesser indentation means the function ended
            if (indent <= baseIndent) {
                break;
            }
            lines.push(lt);
        }
        // Trim trailing blank lines
        while (lines.length > 1 && lines[lines.length - 1].trim() === '') {
            lines.pop();
        }
        return lines.join('\n');
    }
    /** Extract a brace-delimited function ({…}) */
    extractBraceFunction(doc, startLine, endLine) {
        const lines = [];
        let braceDepth = 0;
        let started = false;
        for (let i = startLine; i < endLine; i++) {
            const lineText = doc.lineAt(i).text;
            lines.push(lineText);
            for (const ch of lineText) {
                if (ch === '{') {
                    braceDepth++;
                    started = true;
                }
                if (ch === '}') {
                    braceDepth--;
                }
            }
            if (started && braceDepth <= 0 && lines.length > 1) {
                break;
            }
        }
        return lines.join('\n');
    }
    async showSuggestionPanel(suggestion, originalCode) {
        const doc = await vscode.workspace.openTextDocument({
            content: `// ═══════════════════════════════════════════════════════════════════
// 🌱 WattTrace — Greener Code Suggestion for "${suggestion.originalName}"
// ═══════════════════════════════════════════════════════════════════
//
// 📉 Estimated Reduction: ${suggestion.estimatedReduction}
//
// 💡 Explanation:
${suggestion.explanation.split('\n').map((l) => `//   ${l}`).join('\n')}
//
// ═══════════════════════════════════════════════════════════════════

// ── Original Code ──────────────────────────────────────────────────
/*
${originalCode}
*/

// ── Improved Code ──────────────────────────────────────────────────
${suggestion.improvedCode}
`,
            language: this._result?.language ?? 'plaintext',
        });
        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
        });
    }
    // ── Private render ──────────────────────────────────────
    render() {
        if (!this._view) {
            return;
        }
        this._view.webview.html = this.buildHtml();
    }
    revealFunction(line) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || line < 1) {
            return;
        }
        const pos = new vscode.Position(line - 1, 0);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(pos, pos);
    }
    // ── HTML ─────────────────────────────────────────────────
    buildHtml() {
        const r = this._result;
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${CSS}</style>
</head>
<body>
  ${this._isAnalyzing ? ANALYZING_HTML : ''}
  ${this._pendingSuggestion ? this.renderOllamaLoading() : ''}
  ${r ? this.renderOverview(r) : ''}
  ${r ? this.renderBreakdown(r) : ''}
  ${r ? this.renderFunctionList(r) : ''}
  ${!r && !this._isAnalyzing ? EMPTY_HTML : ''}
  <script>${SCRIPT}</script>
</body>
</html>`;
    }
    // ── Ollama loading indicator ────────────────────────────
    renderOllamaLoading() {
        return /* html */ `
    <div class="section ollama-loading">
      <div class="ai-spinner"></div>
      <p class="ai-text">🤖 Asking <strong>qwen2.5-coder:3b</strong> for a greener version of <em>${escapeHtml(this._pendingSuggestion)}</em>…</p>
    </div>`;
    }
    // ── Overview card ───────────────────────────────────────
    renderOverview(r) {
        const bd = r.carbonBreakdown;
        const carbonDisplay = (0, extension_1.formatCo2)(bd.total.carbonGrams);
        const energyDisplay = bd.total.energyJoules >= 1
            ? `${bd.total.energyJoules.toFixed(4)} J`
            : bd.total.energyJoules >= 1e-3
                ? `${(bd.total.energyJoules * 1e3).toFixed(3)} mJ`
                : `${(bd.total.energyJoules * 1e6).toFixed(2)} µJ`;
        const grade = this.getGrade(bd.total.carbonGrams);
        const gradeColor = gradeToColor(grade);
        const lang = r.language.charAt(0).toUpperCase() + r.language.slice(1);
        return /* html */ `
    <div class="section overview anim-fadein">
      <div class="overview-header">
        <span class="grade-badge anim-pulse" style="--grade-color:${gradeColor}">${grade}</span>
        <div class="overview-title">
          <h3>Carbon Footprint</h3>
          <span class="lang-tag">${escapeHtml(lang)}</span>
        </div>
      </div>

      <div class="metrics-grid">
        <div class="metric-card accent anim-slidein" style="--delay:0.1s">
          <div class="metric-value glow">${carbonDisplay}</div>
          <div class="metric-label">Total CO₂ / day</div>
        </div>
        <div class="metric-card anim-slidein" style="--delay:0.2s">
          <div class="metric-value">${energyDisplay}</div>
          <div class="metric-label">Total Energy / day</div>
        </div>
        <div class="metric-card anim-slidein" style="--delay:0.3s">
          <div class="metric-value">${formatNumber(r.totalWeightedOps)}</div>
          <div class="metric-label">Weighted Ops</div>
        </div>
        <div class="metric-card anim-slidein" style="--delay:0.4s">
          <div class="metric-value">${r.functions.length}</div>
          <div class="metric-label">Functions</div>
        </div>
      </div>

      <button class="reanalyze-btn anim-fadein" id="reanalyzeBtn" style="--delay:0.5s">⟳ Re-analyze</button>
    </div>`;
    }
    // ── 3-tier breakdown ────────────────────────────────────
    renderBreakdown(r) {
        const bd = r.carbonBreakdown;
        const totalCO2 = bd.total.carbonGrams || 1e-20;
        const tiers = [
            { tier: bd.userEnd, icon: '🖥️', color: '#3b82f6', delay: '0.15' },
            { tier: bd.developerEnd, icon: '👨‍💻', color: '#a855f7', delay: '0.25' },
            { tier: bd.serverSide, icon: '🌐', color: '#f59e0b', delay: '0.35' },
        ];
        const rows = tiers.map(({ tier, icon, color, delay }) => {
            const pct = ((tier.carbonGrams / totalCO2) * 100).toFixed(1);
            const co2 = (0, extension_1.formatCo2)(tier.carbonGrams);
            return /* html */ `
      <div class="tier-row anim-slidein" style="--delay:${delay}s">
        <div class="tier-header">
          <span class="tier-icon">${icon}</span>
          <span class="tier-label">${escapeHtml(tier.label)}</span>
          <span class="tier-pct" style="color:${color}">${pct}%</span>
        </div>
        <div class="tier-value">${co2} CO₂ / day</div>
        <div class="tier-desc">${escapeHtml(tier.description)}</div>
        <div class="tier-bar-track">
          <div class="tier-bar-fill" style="width:${Math.min(100, parseFloat(pct))}%;background:${color}"></div>
        </div>
      </div>`;
        }).join('');
        return /* html */ `
    <div class="section anim-fadein" style="--delay:0.1s">
      <h3>📊 Carbon Breakdown</h3>
      <div class="tier-list">${rows}</div>
      <p class="tier-note">* Traffic is assumed — values are daily estimates</p>
    </div>`;
    }
    // ── Per-function list ───────────────────────────────────
    renderFunctionList(r) {
        if (r.functions.length === 0) {
            return /* html */ `
      <div class="section anim-fadein">
        <h3>Functions</h3>
        <p class="muted">No functions detected.</p>
      </div>`;
        }
        const sorted = [...r.functions].sort((a, b) => b.weightedOps - a.weightedOps);
        const totalWeighted = r.totalWeightedOps || 1;
        const rows = sorted.map((fn, i) => {
            const pct = ((fn.weightedOps / totalWeighted) * 100).toFixed(1);
            const risk = this.getFunctionRisk(fn, totalWeighted);
            const icon = risk === 'high' ? '🔴' : risk === 'medium' ? '🟡' : '🟢';
            const carbonStr = (0, extension_1.formatCo2)(fn.carbonGrams);
            const delay = (0.1 + i * 0.08).toFixed(2);
            const isLoading = this._pendingSuggestion === fn.name;
            return /* html */ `
      <div class="fn-row anim-slidein" style="--delay:${delay}s" data-line="${fn.lineNumber}" data-name="${escapeHtml(fn.name)}">
        <div class="fn-header">
          <span class="fn-icon">${icon}</span>
          <span class="fn-name">${escapeHtml(fn.name)}</span>
          <span class="fn-pct">${pct}%</span>
        </div>
        <div class="fn-meta">
          <span>Line ${fn.lineNumber}</span>
          <span>${carbonStr} CO₂</span>
          ${fn.isRecursive ? '<span class="tag recursive">recursive</span>' : ''}
          ${fn.maxNesting > 1 ? `<span class="tag nesting">depth ${fn.maxNesting}</span>` : ''}
        </div>
        <div class="fn-bar-track"><div class="fn-bar-fill ${risk}" style="width:${Math.min(100, parseFloat(pct))}%"></div></div>
        <button class="suggest-btn ${isLoading ? 'loading' : ''}" data-name="${escapeHtml(fn.name)}" data-line="${fn.lineNumber}"
          ${isLoading ? 'disabled' : ''}>
          ${isLoading ? '<span class="btn-spinner"></span> Generating…' : '🤖 Suggest greener code'}
        </button>
      </div>`;
        }).join('');
        return /* html */ `
    <div class="section anim-fadein">
      <h3>🔋 Functions by Impact</h3>
      <div class="fn-list">${rows}</div>
    </div>`;
    }
    // ── Helpers ─────────────────────────────────────────────
    getGrade(carbonGrams) {
        // Thresholds based on daily total across all three tiers
        if (carbonGrams <= 1e-4) {
            return 'A';
        }
        if (carbonGrams <= 1e-2) {
            return 'B';
        }
        if (carbonGrams <= 1) {
            return 'C';
        }
        if (carbonGrams <= 100) {
            return 'D';
        }
        return 'F';
    }
    getFunctionRisk(fn, totalWeighted) {
        const pct = (fn.weightedOps / totalWeighted) * 100;
        if (pct > 40 || fn.maxNesting > 3) {
            return 'high';
        }
        if (pct > 15 || fn.maxNesting > 2) {
            return 'medium';
        }
        return 'low';
    }
}
exports.CarbonDashboardProvider = CarbonDashboardProvider;
// =====================================================================
// STATIC HTML / CSS / JS
// =====================================================================
const EMPTY_HTML = /* html */ `
<div class="section empty anim-fadein">
  <div class="hero-glow">
    <p class="hero-icon">⚡</p>
  </div>
  <h2>WattTrace</h2>
  <p class="subtitle">Green Coding Assistant</p>
  <p class="hint">Open a file and run<br/><strong>WattTrace: Analyze Current File</strong><br/>to see its carbon footprint.</p>
  <button class="cta-btn anim-pulse-soft" id="analyzeBtn">⚡ Analyze Now</button>
</div>`;
const ANALYZING_HTML = /* html */ `
<div class="section analyzing anim-fadein">
  <div class="spinner"></div>
  <p>Analyzing carbon footprint…</p>
</div>`;
const SCRIPT = /* js */ `
  const vscode = acquireVsCodeApi();

  document.querySelectorAll('.fn-row').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.suggest-btn')) return;
      vscode.postMessage({
        type: 'revealFunction',
        line: parseInt(el.getAttribute('data-line')),
      });
    });
  });

  document.querySelectorAll('.suggest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      vscode.postMessage({
        type: 'suggestFix',
        functionName: btn.getAttribute('data-name'),
        line: parseInt(btn.getAttribute('data-line')),
      });
    });
  });

  const analyzeBtn = document.getElementById('analyzeBtn');
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'reanalyze' });
    });
  }

  const reanalyzeBtn = document.getElementById('reanalyzeBtn');
  if (reanalyzeBtn) {
    reanalyzeBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'reanalyze' });
    });
  }
`;
const CSS = /* css */ `
  :root {
    --glow-green: #22c55e;
    --glow-blue: #3b82f6;
    --accent-gradient: linear-gradient(135deg, #22c55e 0%, #10b981 50%, #059669 100%);
    --dark-card: rgba(255,255,255,0.04);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 0;
    overflow-y: auto;
  }
  .section {
    padding: 14px 14px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  h3 {
    margin-bottom: 10px;
    font-size: 13px;
    font-weight: 600;
  }

  /* ═══ Animations ═══════════════════════════════ */
  @keyframes fadein {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slidein {
    from { opacity: 0; transform: translateX(-12px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 var(--grade-color, #22c55e); }
    50%      { transform: scale(1.08); box-shadow: 0 0 20px 4px var(--grade-color, #22c55e); }
  }
  @keyframes pulse-soft {
    0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.3); }
    50%      { box-shadow: 0 0 16px 4px rgba(34,197,94,0.25); }
  }
  @keyframes glow-text {
    0%, 100% { text-shadow: 0 0 8px rgba(34,197,94,0.3); }
    50%      { text-shadow: 0 0 18px rgba(34,197,94,0.6); }
  }
  @keyframes gradient-shift {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes bar-fill {
    from { width: 0; }
  }
  @keyframes ai-pulse {
    0%, 100% { opacity: 0.6; }
    50%      { opacity: 1; }
  }
  @keyframes btn-spin { to { transform: rotate(360deg); } }

  .anim-fadein {
    animation: fadein 0.5s ease-out both;
    animation-delay: var(--delay, 0s);
  }
  .anim-slidein {
    animation: slidein 0.4s ease-out both;
    animation-delay: var(--delay, 0s);
  }
  .anim-pulse {
    animation: pulse 2.5s ease-in-out infinite;
  }
  .anim-pulse-soft {
    animation: pulse-soft 2.5s ease-in-out infinite;
  }

  /* ═══ Empty state ══════════════════════════════ */
  .empty { text-align: center; padding: 36px 14px; }
  .hero-glow {
    width: 72px; height: 72px; margin: 0 auto 14px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(34,197,94,0.15) 0%, transparent 70%);
  }
  .hero-icon { font-size: 40px; filter: drop-shadow(0 0 10px rgba(34,197,94,.5)); }
  .empty h2 {
    margin-bottom: 4px;
    background: var(--accent-gradient);
    background-size: 200% 200%;
    animation: gradient-shift 4s ease infinite;
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    font-size: 20px;
  }
  .subtitle { opacity: 0.5; margin-bottom: 8px; font-size: 11px; text-transform: uppercase; letter-spacing: 1.2px; }
  .hint { opacity: 0.7; font-size: 12px; line-height: 1.5; margin-bottom: 6px; }
  .cta-btn {
    margin-top: 16px;
    padding: 8px 24px;
    border: none;
    border-radius: 6px;
    background: var(--accent-gradient);
    background-size: 200% 200%;
    animation: gradient-shift 3s ease infinite, pulse-soft 2.5s ease-in-out infinite;
    color: #fff;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s;
  }
  .cta-btn:hover { transform: scale(1.05); }

  /* ═══ Analyzing spinner ════════════════════════ */
  .analyzing { text-align: center; padding: 18px; }
  .spinner {
    width: 28px; height: 28px; margin: 0 auto 8px;
    border: 3px solid rgba(34,197,94,0.25);
    border-top-color: var(--glow-green);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  /* ═══ Ollama loading ═══════════════════════════ */
  .ollama-loading {
    text-align: center; padding: 14px;
    background: linear-gradient(135deg, rgba(59,130,246,0.06) 0%, rgba(34,197,94,0.06) 100%);
    animation: ai-pulse 1.5s ease-in-out infinite;
  }
  .ai-spinner {
    width: 20px; height: 20px; margin: 0 auto 6px;
    border: 2px solid rgba(59,130,246,0.3);
    border-top-color: var(--glow-blue);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  .ai-text { font-size: 11px; opacity: 0.85; }

  /* ═══ Overview ═════════════════════════════════ */
  .overview { position: relative; overflow: hidden; }
  .overview::before {
    content: '';
    position: absolute; top: -50%; left: -50%; width: 200%; height: 200%;
    background: radial-gradient(circle at 30% 30%, rgba(34,197,94,0.06) 0%, transparent 50%);
    pointer-events: none;
  }
  .overview-header {
    display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
    position: relative;
  }
  .grade-badge {
    width: 44px; height: 44px; display: flex; align-items: center;
    justify-content: center; border-radius: 10px; font-size: 22px;
    font-weight: 800; color: #fff;
    background: var(--grade-color, #28a745);
    box-shadow: 0 0 16px var(--grade-color, #28a745);
  }
  .overview-title h3 { margin-bottom: 2px; font-size: 15px; }
  .lang-tag {
    font-size: 10px; opacity: 0.5; text-transform: uppercase;
    letter-spacing: 0.6px;
  }

  .metrics-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
    position: relative;
  }
  .metric-card {
    background: var(--dark-card);
    backdrop-filter: blur(4px);
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 8px; padding: 12px; text-align: center;
    transition: transform 0.2s, border-color 0.2s;
  }
  .metric-card:hover {
    transform: translateY(-2px);
    border-color: rgba(34,197,94,0.3);
  }
  .metric-card.accent {
    border-color: var(--glow-green);
    box-shadow: 0 0 12px rgba(34,197,94,0.1);
  }
  .metric-value {
    font-size: 16px; font-weight: 700; line-height: 1.3;
    word-break: break-word;
  }
  .metric-value.glow {
    animation: glow-text 3s ease-in-out infinite;
  }
  .metric-label {
    font-size: 10px; opacity: 0.5; margin-top: 3px; text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .reanalyze-btn {
    margin-top: 12px;
    width: 100%;
    padding: 7px 0;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 6px;
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 11px;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
  }
  .reanalyze-btn:hover {
    background: rgba(34,197,94,0.1);
    border-color: var(--glow-green);
  }

  /* ═══ Function list ════════════════════════════ */
  .fn-list { display: flex; flex-direction: column; gap: 6px; }
  .fn-row {
    background: var(--dark-card);
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 8px; padding: 10px 12px; cursor: pointer;
    transition: background 0.2s, border-color 0.2s, transform 0.15s;
  }
  .fn-row:hover {
    background: var(--vscode-list-hoverBackground);
    border-color: rgba(34,197,94,0.2);
    transform: translateX(3px);
  }
  .fn-header { display: flex; align-items: center; gap: 6px; }
  .fn-icon { font-size: 13px; }
  .fn-name {
    flex: 1; font-weight: 600; font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .fn-pct {
    font-weight: 700; font-size: 13px; opacity: 0.85;
    font-variant-numeric: tabular-nums;
  }
  .fn-meta {
    display: flex; gap: 8px; font-size: 10px; opacity: 0.5;
    margin-top: 4px; margin-left: 22px; flex-wrap: wrap;
  }
  .tag {
    font-size: 9px; padding: 2px 6px; border-radius: 4px;
    font-weight: 600; text-transform: uppercase;
  }
  .tag.recursive { background: rgba(220,53,69,0.12); color: #dc3545; }
  .tag.nesting { background: rgba(255,193,7,0.12); color: #ffc107; }

  /* Progress bar */
  .fn-bar-track {
    height: 3px; background: rgba(255,255,255,0.06);
    border-radius: 2px; margin: 7px 0 7px 22px; overflow: hidden;
  }
  .fn-bar-fill {
    height: 100%; border-radius: 2px;
    animation: bar-fill 0.8s ease-out both;
    animation-delay: var(--delay, 0s);
  }
  .fn-bar-fill.low    { background: linear-gradient(90deg, #22c55e, #10b981); }
  .fn-bar-fill.medium { background: linear-gradient(90deg, #f59e0b, #eab308); }
  .fn-bar-fill.high   { background: linear-gradient(90deg, #ef4444, #dc2626); }

  /* Suggest button */
  .suggest-btn {
    display: flex; align-items: center; gap: 5px;
    margin: 4px 0 0 22px;
    border: 1px solid rgba(59,130,246,0.2);
    background: rgba(59,130,246,0.06);
    border-radius: 4px;
    color: var(--vscode-textLink-foreground);
    font-size: 11px; cursor: pointer; padding: 4px 10px;
    transition: background 0.2s, border-color 0.2s, transform 0.1s;
  }
  .suggest-btn:hover {
    background: rgba(59,130,246,0.12);
    border-color: rgba(59,130,246,0.4);
    transform: translateX(2px);
  }
  .suggest-btn.loading {
    opacity: 0.6; cursor: wait;
  }
  .btn-spinner {
    display: inline-block; width: 10px; height: 10px;
    border: 2px solid rgba(59,130,246,0.3);
    border-top-color: var(--glow-blue);
    border-radius: 50%;
    animation: btn-spin 0.6s linear infinite;
  }

  .muted { opacity: 0.5; font-size: 12px; }

  /* ═══ 3-tier breakdown ═════════════════════════ */
  .tier-list { display: flex; flex-direction: column; gap: 8px; }
  .tier-row {
    background: var(--dark-card);
    border: 1px solid rgba(255,255,255,0.04);
    border-radius: 8px; padding: 10px 12px;
    transition: border-color 0.2s, transform 0.15s;
  }
  .tier-row:hover {
    border-color: rgba(255,255,255,0.12);
    transform: translateX(3px);
  }
  .tier-header {
    display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
  }
  .tier-icon { font-size: 16px; }
  .tier-label { flex: 1; font-weight: 600; font-size: 12px; }
  .tier-pct { font-weight: 700; font-size: 14px; font-variant-numeric: tabular-nums; }
  .tier-value {
    font-size: 13px; font-weight: 700; margin-left: 24px; margin-bottom: 2px;
  }
  .tier-desc {
    font-size: 10px; opacity: 0.45; margin-left: 24px; margin-bottom: 6px;
    line-height: 1.4;
  }
  .tier-bar-track {
    height: 4px; background: rgba(255,255,255,0.06);
    border-radius: 3px; margin-left: 24px; overflow: hidden;
  }
  .tier-bar-fill {
    height: 100%; border-radius: 3px;
    animation: bar-fill 0.9s ease-out both;
    animation-delay: var(--delay, 0s);
  }
  .tier-note {
    font-size: 9px; opacity: 0.35; margin-top: 10px; text-align: center;
    font-style: italic;
  }

  /* ═══ Scrollbar ════════════════════════════════ */
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.15);
    border-radius: 3px;
  }
  ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.25); }
`;
// ── Utility ────────────────────────────────────────────────
function gradeToColor(grade) {
    switch (grade) {
        case 'A': return '#22c55e';
        case 'B': return '#4ade80';
        case 'C': return '#f59e0b';
        case 'D': return '#f97316';
        default: return '#ef4444';
    }
}
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function formatNumber(n) {
    if (n >= 1e9) {
        return (n / 1e9).toFixed(1) + 'B';
    }
    if (n >= 1e6) {
        return (n / 1e6).toFixed(1) + 'M';
    }
    if (n >= 1e3) {
        return (n / 1e3).toFixed(1) + 'K';
    }
    return n.toFixed(0);
}
//# sourceMappingURL=CarbonDashboardProvider.js.map