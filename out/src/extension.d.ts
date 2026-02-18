/**
 * WattTrace — Extension Entry Point
 *
 * Registers the carbon-footprint sidebar dashboard, commands,
 * and auto-analyse-on-save listener.  Integrates the Ollama
 * code-generation service for greener-code suggestions.
 */
import * as vscode from 'vscode';
export declare function activate(context: vscode.ExtensionContext): void;
/** Tiered CO₂ display so tiny values are readable (not "0.0000 g") */
export declare function formatCo2(grams: number): string;
export declare function deactivate(): void;
//# sourceMappingURL=extension.d.ts.map