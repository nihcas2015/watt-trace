/**
 * WattTrace — Ollama Code Generation Service
 *
 * Uses qwen2.5-coder:3b (via local Ollama) to suggest greener,
 * lower-carbon alternatives for functions identified as hotspots.
 */

import * as vscode from 'vscode';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_MODEL = 'qwen2.5-coder:3b';
const TIMEOUT_MS = 120_000;
const MAX_RETRIES = 2;

export interface GreenSuggestion {
  originalName: string;
  explanation: string;
  improvedCode: string;
  estimatedReduction: string;
}

export class OllamaService {
  private get endpoint(): string {
    return (
      vscode.workspace
        .getConfiguration('watttrace')
        .get<string>('ollamaEndpoint') ?? DEFAULT_ENDPOINT
    );
  }

  private get model(): string {
    return (
      vscode.workspace
        .getConfiguration('watttrace')
        .get<string>('ollamaModel') ?? DEFAULT_MODEL
    );
  }

  /** Check if Ollama is reachable */
  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(
        `${this.endpoint}/api/tags`,
        { method: 'GET' },
        5000,
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Ask the model for a greener version of the given function.
   * Returns structured suggestion with explanation + improved code.
   */
  async suggestGreenerCode(
    functionCode: string,
    functionName: string,
    language: string,
    carbonGrams: number,
    weightedOps: number,
  ): Promise<GreenSuggestion> {
    const prompt = this.buildPrompt(
      functionCode,
      functionName,
      language,
      carbonGrams,
      weightedOps,
    );

    const raw = await this.generate(prompt);
    return this.parseGreenSuggestion(raw, functionName);
  }

  // ── Private ──────────────────────────────────────────────

  private buildPrompt(
    code: string,
    name: string,
    language: string,
    co2: number,
    ops: number,
  ): string {
    return `You are a green-coding expert. A carbon footprint analyzer detected that the function "${name}" has an estimated ${co2.toExponential(2)} grams CO₂ and ${ops.toFixed(0)} weighted operations.

Your job: rewrite this function to use LESS energy while keeping the same behavior.

Optimization strategies to consider:
- Eliminate redundant object creation (e.g. creating many similar widgets → use a loop or factory)
- Reduce memory allocations and unnecessary variable bindings
- Replace repetitive code blocks with data-driven loops
- Avoid creating objects that are immediately discarded
- Prefer efficient algorithms, batch operations, and lazy evaluation
- For GUI code: reduce widget count, reuse layouts, batch configurations
- For I/O heavy code: buffer writes, reduce syscalls, batch operations

Rules:
- Keep the same function signature and return type
- Keep the same visual/functional behavior
- The "improved_code" value MUST be a single string containing the complete rewritten function
- The "explanation" value MUST be a single string (use \\n for line breaks, not an array)
- Respond ONLY with valid JSON — no markdown fences, no extra text

Required JSON schema (all values are strings):
{
  "explanation": "- Change 1\\n- Change 2\\n- Change 3",
  "improved_code": "def ${name}(...):\\n    ...",
  "estimated_reduction": "~40% fewer operations"
}

Original ${language} function:
\`\`\`${language}
${code}
\`\`\`

Respond with ONLY the JSON object. All JSON values must be strings, not arrays or objects.`;
  }

  private async generate(prompt: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await this.fetchWithTimeout(
          `${this.endpoint}/api/generate`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: this.model,
              prompt,
              stream: false,
              options: { temperature: 0.2, num_predict: 3072 },
            }),
          },
          TIMEOUT_MS,
        );

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Ollama ${res.status}: ${text}`);
        }

        const json = (await res.json()) as { response: string };
        return json.response;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES) {
          await this.sleep(1000 * (attempt + 1));
        }
      }
    }

    throw new Error(
      `Ollama request failed after ${MAX_RETRIES + 1} attempts: ${lastError?.message}`,
    );
  }

  private parseGreenSuggestion(
    raw: string,
    fallbackName: string,
  ): GreenSuggestion {
    let cleaned = raw.trim();
    cleaned = cleaned
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in Ollama response');
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      // Handle `explanation` as string or array of strings
      let explanation = 'No explanation provided.';
      if (typeof parsed.explanation === 'string') {
        explanation = parsed.explanation;
      } else if (Array.isArray(parsed.explanation)) {
        explanation = parsed.explanation
          .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
          .join('\n');
      }

      // Handle `improved_code` as string or object (model might wrap it)
      let improvedCode = '';
      if (typeof parsed.improved_code === 'string') {
        improvedCode = parsed.improved_code;
      } else if (parsed.improved_code && typeof parsed.improved_code === 'object') {
        // If the model returned the code inside an object, try to extract it
        const codeObj = parsed.improved_code as Record<string, unknown>;
        const firstVal = Object.values(codeObj).find((v) => typeof v === 'string');
        improvedCode = typeof firstVal === 'string'
          ? firstVal
          : JSON.stringify(parsed.improved_code, null, 2);
      }

      const reduction = typeof parsed.estimated_reduction === 'string'
        ? parsed.estimated_reduction
        : 'unknown';

      return {
        originalName: fallbackName,
        explanation,
        improvedCode,
        estimatedReduction: reduction,
      };
    } catch {
      // If JSON.parse fails, return the raw text so the user still gets something
      return {
        originalName: fallbackName,
        explanation: 'Could not parse structured response — showing raw output.',
        improvedCode: raw.trim(),
        estimatedReduction: 'unknown',
      };
    }
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
