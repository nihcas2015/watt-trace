/**
 * WattTrace — Ollama Code Generation Service
 *
 * Uses qwen2.5-coder:3b (via local Ollama) to suggest greener,
 * lower-carbon alternatives for functions identified as hotspots.
 */
export interface GreenSuggestion {
    originalName: string;
    explanation: string;
    improvedCode: string;
    estimatedReduction: string;
}
export declare class OllamaService {
    private get endpoint();
    private get model();
    /** Check if Ollama is reachable */
    ping(): Promise<boolean>;
    /**
     * Ask the model for a greener version of the given function.
     * Returns structured suggestion with explanation + improved code.
     */
    suggestGreenerCode(functionCode: string, functionName: string, language: string, carbonGrams: number, weightedOps: number): Promise<GreenSuggestion>;
    private buildPrompt;
    private generate;
    private parseGreenSuggestion;
    private fetchWithTimeout;
    private sleep;
}
//# sourceMappingURL=ollamaService.d.ts.map