/**
 * WattTrace — Ollama LLM Client
 *
 * Handles communication with the local Ollama API.
 */

import * as vscode from 'vscode';
import { OllamaAnalysisResponse } from '../models/energyModels';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5-coder:3b';
const MAX_RETRIES = 2;
const TIMEOUT_MS = 120_000; // 2 minutes per function

export class OllamaClient {
  private get endpoint(): string {
    return vscode.workspace.getConfiguration('watttrace').get<string>('ollamaEndpoint') ?? DEFAULT_ENDPOINT;
  }

  private get model(): string {
    return vscode.workspace.getConfiguration('watttrace').get<string>('ollamaModel') ?? DEFAULT_MODEL;
  }

  /**
   * Send a prompt to the Ollama generate API and return the raw text response.
   */
  async generate(prompt: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.fetchWithTimeout(`${this.endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.model,
            prompt,
            stream: false,
            options: {
              temperature: 0.1,   // deterministic
              num_predict: 2048,
            },
          }),
        }, TIMEOUT_MS);

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Ollama returned ${response.status}: ${text}`);
        }

        const json = await response.json() as { response: string };
        return json.response;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await this.sleep(1000 * (attempt + 1)); // back off
        }
      }
    }

    throw new Error(`Ollama request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`);
  }

  /**
   * Analyse a single function and return structured JSON.
   */
  async analyzeFunction(functionCode: string, language: string): Promise<OllamaAnalysisResponse> {
    const prompt = this.buildAnalysisPrompt(functionCode, language);
    const raw = await this.generate(prompt);
    return this.parseResponse(raw);
  }

  /**
   * Check whether the Ollama server is reachable.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(`${this.endpoint}/api/tags`, { method: 'GET' }, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── private helpers ────────────────────────────────────────────

  private buildAnalysisPrompt(code: string, language: string): string {
    return `You are a software energy-efficiency code reviewer.
Analyze the following ${language} function for energy efficiency.

Evaluate:
- Algorithm complexity (Big-O)
- Nested loop depth and iteration counts
- Repeated or redundant computation
- Inefficient data structures
- Unnecessary memory allocations
- Heavy CPU patterns (busy waits, excessive string concatenation, etc.)

Return ONLY valid JSON (no markdown fences, no explanation outside JSON) with this EXACT schema:

{
  "function_name": "<name of the function>",
  "energy_score": <0-100 integer, lower is more efficient>,
  "efficiency_percent": <0-100 integer>,
  "complexity": "<Big-O notation string>",
  "risk_level": "<low|medium|high>",
  "issues": ["<issue 1>", "<issue 2>"],
  "refactor_suggestions": ["<suggestion 1>", "<suggestion 2>"],
  "estimated_savings_percent": <0-100 integer>
}

Function code:
\`\`\`${language}
${code}
\`\`\`

Respond with ONLY the JSON object.`;
  }

  private parseResponse(raw: string): OllamaAnalysisResponse {
    // Strip markdown code fences if the model wraps them anyway
    let cleaned = raw.trim();
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    // Try to extract the first JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON object found in Ollama response');
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as OllamaAnalysisResponse;
      // Basic validation
      if (typeof parsed.energy_score !== 'number') {
        parsed.energy_score = 50;
      }
      if (typeof parsed.efficiency_percent !== 'number') {
        parsed.efficiency_percent = 100 - parsed.energy_score;
      }
      if (!Array.isArray(parsed.issues)) {
        parsed.issues = [];
      }
      if (!Array.isArray(parsed.refactor_suggestions)) {
        parsed.refactor_suggestions = [];
      }
      parsed.risk_level = parsed.risk_level || 'medium';
      parsed.complexity = parsed.complexity || 'Unknown';
      parsed.estimated_savings_percent = parsed.estimated_savings_percent ?? 0;
      parsed.function_name = parsed.function_name || 'anonymous';
      return parsed;
    } catch {
      throw new Error(`Failed to parse Ollama JSON: ${jsonMatch[0].slice(0, 200)}`);
    }
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
