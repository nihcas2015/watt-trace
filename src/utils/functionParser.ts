/**
 * WattTrace — Function Parser Utilities
 *
 * Extracts function-level blocks from source code using regex heuristics.
 * Supports JavaScript, TypeScript, Python, Java, C#, Go, Rust, C/C++.
 */

import { ParsedFunction } from '../models/energyModels';

/**
 * Extract functions from source code. Returns an array of ParsedFunction.
 */
export function extractFunctions(source: string, languageId: string): ParsedFunction[] {
  switch (languageId) {
    case 'python':
      return extractPythonFunctions(source);
    case 'go':
      return extractBraceFunctions(source, goFunctionPattern());
    case 'rust':
      return extractBraceFunctions(source, rustFunctionPattern());
    case 'java':
    case 'csharp':
      return extractBraceFunctions(source, javaLikeFunctionPattern());
    case 'c':
    case 'cpp':
      return extractBraceFunctions(source, cFunctionPattern());
    case 'javascript':
    case 'typescript':
    case 'javascriptreact':
    case 'typescriptreact':
    default:
      return extractJSTSFunctions(source);
  }
}

// ── JS / TS ────────────────────────────────────────────────────

function extractJSTSFunctions(source: string): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const lines = source.split('\n');

  // Patterns: function declarations, arrow functions assigned to const/let/var, methods
  const patterns = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/,                       // function foo(
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/,  // const foo = (...) =>
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(/, // const foo = function(
    /(?:public|private|protected|static|\s)*(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\S+\s*)?\{/, // class method
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of patterns) {
      const m = line.match(pat);
      if (m && m[1] && !isKeyword(m[1])) {
        const endLine = findClosingBrace(lines, i);
        if (endLine > i) {
          results.push({
            name: m[1],
            startLine: i + 1,
            endLine: endLine + 1,
            body: lines.slice(i, endLine + 1).join('\n'),
          });
        }
        break;
      }
    }
  }

  return deduplicateByRange(results);
}

// ── Python ─────────────────────────────────────────────────────

function extractPythonFunctions(source: string): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const lines = source.split('\n');
  const defPattern = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(defPattern);
    if (m) {
      const indent = m[1].length;
      const name = m[2];
      let end = i;
      for (let j = i + 1; j < lines.length; j++) {
        const trimmed = lines[j].trim();
        if (trimmed === '' || trimmed.startsWith('#')) {
          continue; // blank / comment
        }
        const lineIndent = lines[j].search(/\S/);
        if (lineIndent <= indent) {
          break;
        }
        end = j;
      }
      results.push({
        name,
        startLine: i + 1,
        endLine: end + 1,
        body: lines.slice(i, end + 1).join('\n'),
      });
    }
  }

  return results;
}

// ── Brace-based languages ──────────────────────────────────────

function extractBraceFunctions(source: string, pattern: RegExp): ParsedFunction[] {
  const results: ParsedFunction[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(pattern);
    if (m && m[1]) {
      const endLine = findClosingBrace(lines, i);
      if (endLine > i) {
        results.push({
          name: m[1],
          startLine: i + 1,
          endLine: endLine + 1,
          body: lines.slice(i, endLine + 1).join('\n'),
        });
      }
    }
  }

  return deduplicateByRange(results);
}

function goFunctionPattern(): RegExp {
  return /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/;
}

function rustFunctionPattern(): RegExp {
  return /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*[(<]/;
}

function javaLikeFunctionPattern(): RegExp {
  return /(?:public|private|protected|static|\s)+\S+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+\S+\s*)?\{?/;
}

function cFunctionPattern(): RegExp {
  return /^(?:\w[\w\s*]*)\s+(\w+)\s*\([^)]*\)\s*\{?/;
}

// ── Helpers ────────────────────────────────────────────────────

function findClosingBrace(lines: string[], startIdx: number): number {
  let depth = 0;
  let foundOpen = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        foundOpen = true;
      } else if (ch === '}') {
        depth--;
        if (foundOpen && depth === 0) {
          return i;
        }
      }
    }
  }
  // If no braces found (arrow function one-liner), return startIdx + few lines
  return Math.min(startIdx + 1, lines.length - 1);
}

const JS_KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return',
  'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof',
  'import', 'export', 'default', 'class', 'extends', 'super',
  'constructor', 'this', 'void', 'with',
]);

function isKeyword(name: string): boolean {
  return JS_KEYWORDS.has(name);
}

function deduplicateByRange(arr: ParsedFunction[]): ParsedFunction[] {
  const seen = new Set<string>();
  return arr.filter(f => {
    const key = `${f.startLine}-${f.endLine}`;
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}
