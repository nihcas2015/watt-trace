"use strict";
/**
 * Carbon Footprint Estimator — Regex Fallback Analyzer
 *
 * Direct TypeScript port of RegexAnalyzer from carbon_footprint_estimator.py
 *
 * Used when tree-sitter grammars are NOT available. Performs line-by-line
 * analysis of C-family and Python source code using regex patterns.
 * Tracks brace depth for brace-based languages and indentation depth for
 * Python to determine loop nesting and cascade multipliers.
 *
 * KEY DESIGN: Lines inside nested loops get multiplied by each enclosing
 * loop's estimated iteration count. For brace-based languages, this is
 * determined by tracking { and } braces. For Python, by indentation.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegexAnalyzer = void 0;
const models_1 = require("./models");
const constants_1 = require("./constants");
// =============================================================================
// REGEX PATTERNS (same as Python's RegexAnalyzer)
// =============================================================================
/** Language-specific regex patterns for I/O detection */
const IO_PATTERNS = {
    python: /\b(print|input|open|read|write|readline|readlines)\b/,
    java: /\b(System\.(out|err|in)\.\w+|Scanner\.\w+|BufferedReader|FileReader|FileWriter|PrintWriter|println|printf|print|read|write|readLine)\b/,
    c: /\b(printf|scanf|fprintf|fscanf|fopen|fclose|fread|fwrite|puts|gets|getchar|putchar|fgets|fputs)\b/,
    cpp: /\b(cout|cin|cerr|clog|printf|scanf|ifstream|ofstream|fstream|getline)\b/,
    javascript: /\b(console\.(log|error|warn|info|debug|trace)|alert|prompt|confirm|document\.write|fs\.\w+|readFile|writeFile|process\.std(in|out|err))\b/,
};
/** Language-specific regex patterns for network detection */
const NETWORK_PATTERNS = {
    python: /\b(request|urlopen|socket|fetch|connect|send|recv)\b/,
    java: /\b(HttpURLConnection|URL|Socket|ServerSocket|HttpClient|HttpRequest|RestTemplate|WebClient)\b/,
    c: /\b(socket|connect|send|recv|bind|listen|accept|curl_)\b/,
    cpp: /\b(socket|connect|send|recv|boost::asio|curl_|httplib)\b/,
    javascript: /\b(fetch|axios|XMLHttpRequest|http\.request|https\.request|WebSocket|net\.connect)\b/,
};
/** Language-specific regex patterns for memory allocation detection */
const ALLOC_PATTERNS = {
    python: /\b(list|dict|set|tuple|bytearray|array|DataFrame|Series|ndarray|deepcopy|copy)\s*\(/,
    java: /\bnew\s+\w+/,
    c: /\b(malloc|calloc|realloc|free|alloca)\b/,
    cpp: /\b(new\s+\w+|make_shared|make_unique|malloc|calloc|std::vector|std::map|std::unordered_map)\b/,
    javascript: /\bnew\s+\w+|Array\(|Object\.create|Map\(|Set\(/,
};
/** Language-specific regex patterns for function declarations */
const FUNC_PATTERNS = {
    python: /(?:^|\n)\s*(?:async\s+)?def\s+(\w+)\s*\(/,
    java: /(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/,
    c: /(?:static\s+)?(?:inline\s+)?(?:unsigned\s+)?(?:const\s+)?\w+[\s*]+(\w+)\s*\([^)]*\)\s*\{/,
    cpp: /(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:unsigned\s+)?(?:const\s+)?[\w:<>]+[\s*&]+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/,
    javascript: /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>))|(\w+)\s*\([^)]*\)\s*\{/,
};
/** Function call pattern (matches lines that are a function call) */
const FUNC_CALL_REGEX = /\b\w+\s*\(/;
// Brace-based for loop patterns: for (...; var < N; ...)
const FOR_HEADER_REGEX = /for\s*\(\s*(?:(?:int|var|let|const|auto|size_t)\s+)?(\w+)\s*=\s*(\d+)\s*;\s*\w+\s*(<|<=|>|>=)\s*(\d+|[A-Z_]+)\s*;/;
// Range-based Python for pattern: for var in range(...)
const PYTHON_FOR_RANGE_REGEX = /for\s+\w+\s+in\s+range\s*\(([^)]*)\)/;
// C-style for loop with just an upper bound: for (i = 0; i < N; i++)
const FOR_SIMPLE_UPPER = /for\s*\([^;]*;\s*\w+\s*<\s*(\d+)\s*;/;
// While condition patterns
const WHILE_COND_REGEX = /while\s*\(\s*(\w+)\s*(<|>|<=|>=|!=)\s*(\d+|[A-Z_]+)\s*\)/;
// Python while pattern
const PYTHON_WHILE_REGEX = /while\s+(\w+)\s*(<|>|<=|>=|!=)\s*(\d+|\w+)\s*:/;
// =============================================================================
// REGEX ANALYZER
// =============================================================================
class RegexAnalyzer {
    language;
    result;
    variableConstants = new Map();
    // Cached regex patterns for this language
    ioPattern;
    networkPattern;
    allocPattern;
    funcPattern;
    isBraceBased;
    constructor(language) {
        this.language = language;
        const langKey = language === 'typescript' ? 'javascript' : language;
        this.ioPattern = IO_PATTERNS[langKey] || null;
        this.networkPattern = NETWORK_PATTERNS[langKey] || null;
        this.allocPattern = ALLOC_PATTERNS[langKey] || null;
        this.funcPattern = FUNC_PATTERNS[langKey] || null;
        this.isBraceBased = language !== 'python';
    }
    /**
     * Analyze source code using regex-based line-by-line parsing.
     * This is the fallback when tree-sitter grammars are unavailable.
     */
    analyze(code, filePath) {
        this.result = new models_1.AnalysisResult(this.language, filePath || null);
        this.variableConstants = new Map();
        this.result.assumptions.push(`Regex-based analysis (tree-sitter unavailable) for ${this.language}`);
        this.result.assumptions.push(`Energy per operation: ${constants_1.ENERGY_PER_OPERATION_JOULES} J`);
        this.result.assumptions.push(`Carbon intensity: ${constants_1.CARBON_INTENSITY_G_PER_KWH} gCO2/kWh (global average)`);
        // Remove comments
        const cleanCode = this.removeComments(code);
        // Extract variable constants
        this.extractConstants(cleanCode);
        // Extract functions
        this.extractFunctions(cleanCode);
        return this.result;
    }
    // ===========================================================================
    // COMMENT REMOVAL
    // ===========================================================================
    /**
     * Remove comments from source code.
     * Faithful port of Python's _remove_comments method.
     */
    removeComments(code) {
        if (this.language === 'python') {
            return this.removePythonComments(code);
        }
        return this.removeCStyleComments(code);
    }
    /** Remove Python comments and docstrings */
    removePythonComments(code) {
        const lines = code.split('\n');
        const cleaned = [];
        let inDocstring = false;
        let docDelim = '';
        for (const line of lines) {
            let processedLine = line;
            if (inDocstring) {
                const endIdx = processedLine.indexOf(docDelim);
                if (endIdx !== -1) {
                    processedLine = processedLine.substring(endIdx + 3);
                    inDocstring = false;
                }
                else {
                    cleaned.push('');
                    continue;
                }
            }
            // Check for docstring start
            for (const delim of ['"""', "'''"]) {
                const startIdx = processedLine.indexOf(delim);
                if (startIdx !== -1) {
                    const endIdx = processedLine.indexOf(delim, startIdx + 3);
                    if (endIdx !== -1) {
                        // Single-line docstring
                        processedLine = processedLine.substring(0, startIdx) + processedLine.substring(endIdx + 3);
                    }
                    else {
                        // Multi-line docstring starts
                        processedLine = processedLine.substring(0, startIdx);
                        inDocstring = true;
                        docDelim = delim;
                    }
                }
            }
            // Remove line comments
            const hashIdx = processedLine.indexOf('#');
            if (hashIdx !== -1) {
                processedLine = processedLine.substring(0, hashIdx);
            }
            cleaned.push(processedLine);
        }
        return cleaned.join('\n');
    }
    /** Remove C-style comments (// and /* ... *‍/) */
    removeCStyleComments(code) {
        // Remove block comments
        let result = code.replace(/\/\*[\s\S]*?\*\//g, '');
        // Remove line comments
        result = result.replace(/\/\/.*$/gm, '');
        return result;
    }
    // ===========================================================================
    // CONSTANT EXTRACTION
    // ===========================================================================
    /** Extract variable = integer_literal assignments for loop bound resolution */
    extractConstants(code) {
        if (this.language === 'python') {
            // Python: NAME = NUMBER
            const pyConstPattern = /^([A-Z_][A-Z0-9_]*)\s*=\s*(\d+)\s*$/gm;
            let match;
            while ((match = pyConstPattern.exec(code)) !== null) {
                this.variableConstants.set(match[1], parseInt(match[2], 10));
            }
        }
        else {
            // C-family: const/final/static type NAME = NUMBER; or #define NAME NUMBER
            const constPattern = /(?:const|final|static|#define)\s+(?:\w+\s+)?(\w+)\s*=?\s*(\d+)/g;
            let match;
            while ((match = constPattern.exec(code)) !== null) {
                this.variableConstants.set(match[1], parseInt(match[2], 10));
            }
        }
    }
    // ===========================================================================
    // FUNCTION EXTRACTION
    // ===========================================================================
    /**
     * Extract functions from source code and analyze each one.
     * Faithful port of Python's _extract_functions method.
     */
    extractFunctions(code) {
        if (this.language === 'python') {
            this.extractPythonFunctions(code);
        }
        else {
            this.extractBraceFunctions(code);
        }
    }
    /** Extract Python functions using indentation */
    extractPythonFunctions(code) {
        const lines = code.split('\n');
        let i = 0;
        const globalLines = [];
        while (i < lines.length) {
            const defMatch = lines[i].match(/^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/);
            if (defMatch) {
                const indent = defMatch[1].length;
                const funcName = defMatch[2];
                const startLine = i + 1;
                const funcLines = [];
                i++;
                while (i < lines.length) {
                    const lineStripped = lines[i].trimEnd();
                    if (lineStripped === '') {
                        funcLines.push(lines[i]);
                        i++;
                        continue;
                    }
                    const lineIndent = lines[i].length - lines[i].trimStart().length;
                    if (lineIndent <= indent) {
                        break;
                    }
                    funcLines.push(lines[i]);
                    i++;
                }
                const funcCode = funcLines.join('\n');
                const func = new models_1.FunctionAnalysis(funcName, startLine);
                // Detect recursion
                const callPattern = new RegExp(`\\b${this.escapeRegex(funcName)}\\s*\\(`, 'g');
                func.isRecursive = callPattern.test(funcCode);
                // Analyze function body
                this.analyzePythonBlock(funcCode, func.operations, 1);
                if (func.isRecursive) {
                    func.operations = func.operations.scale(constants_1.DEFAULT_RECURSION_DEPTH);
                    this.result.assumptions.push(`Function '${funcName}' is recursive — assumed ${constants_1.DEFAULT_RECURSION_DEPTH} recursive calls`);
                }
                func.maxNesting = this.countMaxNesting(funcCode);
                this.result.functions.push(func);
            }
            else {
                globalLines.push(lines[i]);
                i++;
            }
        }
        // Analyze global code
        const globalCode = globalLines.join('\n');
        this.analyzePythonBlock(globalCode, this.result.globalOperations, 1);
    }
    /** Analyze a Python block with indentation-based nesting */
    analyzePythonBlock(code, ops, multiplier) {
        const lines = code.split('\n');
        let i = 0;
        while (i < lines.length) {
            const line = lines[i].trim();
            if (line === '' || line.startsWith('#')) {
                i++;
                continue;
            }
            // For loop
            const forMatch = lines[i].match(/^(\s*)for\s+\w+\s+in\s+(.+):/);
            if (forMatch) {
                const indent = forMatch[1].length;
                const iterable = forMatch[2].trim();
                const iterations = this.estimatePythonForIterations(iterable);
                const innerMultiplier = multiplier * iterations;
                this.result.assumptions.push(`Line ${i + 1}: for-loop estimated ${iterations} iterations`);
                ops.add(constants_1.OpType.COMPARISON, multiplier * iterations);
                // Collect body lines
                const bodyLines = [];
                i++;
                while (i < lines.length) {
                    const bodyLine = lines[i].trimEnd();
                    if (bodyLine === '') {
                        bodyLines.push(lines[i]);
                        i++;
                        continue;
                    }
                    const bodyIndent = lines[i].length - lines[i].trimStart().length;
                    if (bodyIndent <= indent) {
                        break;
                    }
                    bodyLines.push(lines[i]);
                    i++;
                }
                this.analyzePythonBlock(bodyLines.join('\n'), ops, innerMultiplier);
                continue;
            }
            // While loop
            const whileMatch = lines[i].match(/^(\s*)while\s+(.+):/);
            if (whileMatch) {
                const indent = whileMatch[1].length;
                const condition = whileMatch[2].trim();
                const iterations = this.estimatePythonWhileIterations(condition);
                const innerMultiplier = multiplier * iterations;
                this.result.assumptions.push(`Line ${i + 1}: while-loop estimated ${iterations} iterations`);
                ops.add(constants_1.OpType.COMPARISON, multiplier * iterations);
                const bodyLines = [];
                i++;
                while (i < lines.length) {
                    const bodyLine = lines[i].trimEnd();
                    if (bodyLine === '') {
                        bodyLines.push(lines[i]);
                        i++;
                        continue;
                    }
                    const bodyIndent = lines[i].length - lines[i].trimStart().length;
                    if (bodyIndent <= indent) {
                        break;
                    }
                    bodyLines.push(lines[i]);
                    i++;
                }
                this.analyzePythonBlock(bodyLines.join('\n'), ops, innerMultiplier);
                continue;
            }
            // If/elif/else — just count as conditional + analyze body
            const ifMatch = lines[i].match(/^(\s*)(?:if|elif)\s+.+:/);
            if (ifMatch) {
                const indent = ifMatch[1].length;
                ops.add(constants_1.OpType.CONDITIONAL, multiplier);
                const bodyLines = [];
                i++;
                while (i < lines.length) {
                    const bodyLine = lines[i].trimEnd();
                    if (bodyLine === '') {
                        bodyLines.push(lines[i]);
                        i++;
                        continue;
                    }
                    const bodyIndent = lines[i].length - lines[i].trimStart().length;
                    if (bodyIndent <= indent) {
                        break;
                    }
                    bodyLines.push(lines[i]);
                    i++;
                }
                this.analyzePythonBlock(bodyLines.join('\n'), ops, multiplier);
                continue;
            }
            const elseMatch = lines[i].match(/^(\s*)else\s*:/);
            if (elseMatch) {
                const indent = elseMatch[1].length;
                const bodyLines = [];
                i++;
                while (i < lines.length) {
                    const bodyLine = lines[i].trimEnd();
                    if (bodyLine === '') {
                        bodyLines.push(lines[i]);
                        i++;
                        continue;
                    }
                    const bodyIndent = lines[i].length - lines[i].trimStart().length;
                    if (bodyIndent <= indent) {
                        break;
                    }
                    bodyLines.push(lines[i]);
                    i++;
                }
                this.analyzePythonBlock(bodyLines.join('\n'), ops, multiplier);
                continue;
            }
            // Regular line — count operations
            this.countLineOperations(line, ops, multiplier);
            i++;
        }
    }
    /** Extract brace-based functions and analyze each */
    extractBraceFunctions(code) {
        if (!this.funcPattern) {
            // No function pattern for this language — analyze everything as global
            this.analyzeCodeByDepth(code, this.result.globalOperations, 1);
            return;
        }
        const allMatches = [];
        const patternGlobal = new RegExp(this.funcPattern.source, 'gm');
        let match;
        while ((match = patternGlobal.exec(code)) !== null) {
            // Get the first captured group (function name)
            const funcName = match[1] || match[2] || match[3] || 'unknown';
            allMatches.push({ name: funcName, index: match.index });
        }
        if (allMatches.length === 0) {
            this.analyzeCodeByDepth(code, this.result.globalOperations, 1);
            return;
        }
        // For each function, extract its brace-delimited body
        let lastEnd = 0;
        for (const fm of allMatches) {
            // Global code before this function
            if (fm.index > lastEnd) {
                const globalChunk = code.substring(lastEnd, fm.index);
                this.analyzeCodeByDepth(globalChunk, this.result.globalOperations, 1);
            }
            // Find the opening brace
            const openBrace = code.indexOf('{', fm.index);
            if (openBrace === -1) {
                continue;
            }
            const funcBody = this.extractBraceBlock(code, openBrace);
            const lineNumber = code.substring(0, fm.index).split('\n').length;
            const func = new models_1.FunctionAnalysis(fm.name, lineNumber);
            // Detect recursion
            const callPattern = new RegExp(`\\b${this.escapeRegex(fm.name)}\\s*\\(`, 'g');
            func.isRecursive = callPattern.test(funcBody);
            // Analyze function body
            this.analyzeCodeByDepth(funcBody, func.operations, 1);
            if (func.isRecursive) {
                func.operations = func.operations.scale(constants_1.DEFAULT_RECURSION_DEPTH);
                this.result.assumptions.push(`Function '${fm.name}' is recursive — assumed ${constants_1.DEFAULT_RECURSION_DEPTH} recursive calls`);
            }
            func.maxNesting = this.countMaxNesting(funcBody);
            this.result.functions.push(func);
            lastEnd = openBrace + funcBody.length + 2; // +2 for { and }
        }
        // Remaining global code
        if (lastEnd < code.length) {
            const remaining = code.substring(lastEnd);
            this.analyzeCodeByDepth(remaining, this.result.globalOperations, 1);
        }
    }
    /**
     * Extract a brace-delimited block starting at `startIdx` (the position of `{`).
     * Returns the content between the matched braces (not including them).
     * Faithful port of Python's _extract_brace_block.
     */
    extractBraceBlock(code, startIdx) {
        let depth = 0;
        let i = startIdx;
        while (i < code.length) {
            if (code[i] === '{') {
                depth++;
            }
            else if (code[i] === '}') {
                depth--;
                if (depth === 0) {
                    return code.substring(startIdx + 1, i);
                }
            }
            i++;
        }
        return code.substring(startIdx + 1);
    }
    // ===========================================================================
    // DEPTH-AWARE ANALYSIS (for brace-based languages)
    // ===========================================================================
    /**
     * Analyze code by tracking brace depth for loop multipliers.
     * Faithful port of Python's _analyze_code_by_depth.
     *
     * KEY IDEA: We scan lines and track when we enter/exit loops.
     * When inside a loop, all operations are multiplied by the loop's
     * estimated iteration count. Nested loops cascade multipliers.
     */
    analyzeCodeByDepth(code, ops, baseMultiplier) {
        const lines = code.split('\n');
        const loopStack = [];
        let braceDepth = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === '') {
                continue;
            }
            // Count braces on this line
            for (const ch of line) {
                if (ch === '{') {
                    braceDepth++;
                }
                if (ch === '}') {
                    braceDepth--;
                    // Pop loop stack if we've exited a loop's scope
                    while (loopStack.length > 0 && braceDepth < loopStack[loopStack.length - 1].braceDepth) {
                        loopStack.pop();
                    }
                }
            }
            // Calculate current multiplier from loop stack
            let currentMultiplier = baseMultiplier;
            for (const loop of loopStack) {
                currentMultiplier *= loop.iterations;
            }
            // Check if this line starts a loop
            const forMatch = line.match(/^for\s*\(/);
            const whileMatch = line.match(/^while\s*\(/);
            const doMatch = line.match(/^do\s*\{?/);
            const foreachMatch = line.match(/^for\s*\(\s*(?:const|let|var|auto|final)?\s*(?:\w+\s+)?(\w+)\s*(?:of|in|:)/);
            if (forMatch && !foreachMatch) {
                const iterations = this.estimateForIterationsFromHeader(line);
                loopStack.push({ iterations, braceDepth });
                ops.add(constants_1.OpType.COMPARISON, currentMultiplier * iterations);
                this.result.assumptions.push(`Line ${i + 1}: for-loop estimated ${iterations} iterations`);
            }
            else if (foreachMatch) {
                loopStack.push({ iterations: constants_1.DEFAULT_LOOP_ITERATIONS, braceDepth });
                ops.add(constants_1.OpType.COMPARISON, currentMultiplier * constants_1.DEFAULT_LOOP_ITERATIONS);
                this.result.assumptions.push(`Line ${i + 1}: for-each loop assumed ${constants_1.DEFAULT_LOOP_ITERATIONS} iterations`);
            }
            else if (whileMatch) {
                const iterations = this.estimateWhileIterationsFromCondition(line);
                loopStack.push({ iterations, braceDepth });
                ops.add(constants_1.OpType.COMPARISON, currentMultiplier * iterations);
                this.result.assumptions.push(`Line ${i + 1}: while-loop estimated ${iterations} iterations`);
            }
            else if (doMatch) {
                loopStack.push({ iterations: constants_1.DEFAULT_LOOP_ITERATIONS, braceDepth });
                ops.add(constants_1.OpType.COMPARISON, currentMultiplier * constants_1.DEFAULT_LOOP_ITERATIONS);
                this.result.assumptions.push(`Line ${i + 1}: do-while loop assumed ${constants_1.DEFAULT_LOOP_ITERATIONS} iterations`);
            }
            else {
                // Regular line — count operations
                this.countLineOperations(line, ops, currentMultiplier);
            }
        }
    }
    // ===========================================================================
    // LINE-LEVEL OPERATION COUNTING
    // ===========================================================================
    /**
     * Count operations on a single line of code.
     * Faithful port of Python's _count_line_operations.
     */
    countLineOperations(line, ops, multiplier) {
        // Skip empty lines and preprocessor directives
        if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('import') || line.startsWith('using')) {
            return;
        }
        // I/O operations
        if (this.ioPattern?.test(line)) {
            ops.add(constants_1.OpType.IO_OPERATION, multiplier);
        }
        // Network operations
        if (this.networkPattern?.test(line)) {
            ops.add(constants_1.OpType.NETWORK_OP, multiplier);
        }
        // Memory allocation
        if (this.allocPattern?.test(line)) {
            ops.add(constants_1.OpType.MEMORY_ALLOC, multiplier);
        }
        // Arithmetic operators (count occurrences)
        const arithmeticOps = line.match(/(?<!=)[+\-*/%](?!=)/g);
        if (arithmeticOps) {
            for (const op of arithmeticOps) {
                // Skip if part of a comment marker or string
                if (op === '+' || op === '-') {
                    ops.add(constants_1.OpType.ADDITION, multiplier);
                }
                else if (op === '*') {
                    ops.add(constants_1.OpType.MULTIPLICATION, multiplier);
                }
                else if (op === '/' || op === '%') {
                    ops.add(constants_1.OpType.DIVISION, multiplier);
                }
            }
        }
        // Assignment (=, but not ==)
        const assignments = line.match(/(?<![=!<>])=(?!=)/g);
        if (assignments) {
            ops.add(constants_1.OpType.ASSIGNMENT, multiplier * assignments.length);
        }
        // Comparisons (==, !=, <, >, <=, >=)
        const comparisons = line.match(/(==|!=|<=|>=|<|>)/g);
        if (comparisons) {
            ops.add(constants_1.OpType.COMPARISON, multiplier * comparisons.length);
        }
        // Conditionals (if, else, switch, case, ternary ?)
        if (/\b(if|else|switch|case)\b/.test(line) || /\?[^?]/.test(line)) {
            ops.add(constants_1.OpType.CONDITIONAL, multiplier);
        }
        // Array access [...]
        const arrayAccess = line.match(/\[(?!\])/g);
        if (arrayAccess) {
            ops.add(constants_1.OpType.ARRAY_ACCESS, multiplier * arrayAccess.length);
        }
        // Function calls
        if (FUNC_CALL_REGEX.test(line) && !this.ioPattern?.test(line) && !this.networkPattern?.test(line) && !this.allocPattern?.test(line)) {
            ops.add(constants_1.OpType.FUNCTION_CALL, multiplier);
        }
    }
    // ===========================================================================
    // LOOP ITERATION ESTIMATION
    // ===========================================================================
    /**
     * Estimate for-loop iterations from the loop header string.
     * Faithful port of Python's _estimate_for_iterations_from_header.
     */
    estimateForIterationsFromHeader(header) {
        // Standard C-style: for (int i = start; i < end; i++)
        const standardMatch = header.match(FOR_HEADER_REGEX);
        if (standardMatch) {
            const startVal = parseInt(standardMatch[2], 10);
            const op = standardMatch[3];
            const endStr = standardMatch[4];
            let endVal;
            if (/^\d+$/.test(endStr)) {
                endVal = parseInt(endStr, 10);
            }
            else {
                // Try constant lookup
                const constVal = this.variableConstants.get(endStr);
                if (constVal !== undefined) {
                    endVal = constVal;
                }
                else {
                    return constants_1.DEFAULT_LOOP_ITERATIONS;
                }
            }
            switch (op) {
                case '<': return Math.max(0, endVal - startVal);
                case '<=': return Math.max(0, endVal - startVal + 1);
                case '>': return Math.max(0, startVal - endVal);
                case '>=': return Math.max(0, startVal - endVal + 1);
                default: return constants_1.DEFAULT_LOOP_ITERATIONS;
            }
        }
        // Simple upper bound: for (...; i < N; ...)
        const simpleMatch = header.match(FOR_SIMPLE_UPPER);
        if (simpleMatch) {
            return parseInt(simpleMatch[1], 10);
        }
        return constants_1.DEFAULT_LOOP_ITERATIONS;
    }
    /**
     * Estimate Python for-loop iterations from the iterable expression.
     */
    estimatePythonForIterations(iterable) {
        // range(N)
        const rangeMatch = iterable.match(/^range\s*\(\s*(\d+)\s*\)$/);
        if (rangeMatch) {
            return parseInt(rangeMatch[1], 10);
        }
        // range(start, stop)
        const range2Match = iterable.match(/^range\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)$/);
        if (range2Match) {
            return Math.max(0, parseInt(range2Match[2], 10) - parseInt(range2Match[1], 10));
        }
        // range(start, stop, step)
        const range3Match = iterable.match(/^range\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
        if (range3Match) {
            const start = parseInt(range3Match[1], 10);
            const stop = parseInt(range3Match[2], 10);
            const step = parseInt(range3Match[3], 10);
            return step > 0 ? Math.max(0, Math.ceil((stop - start) / step)) : constants_1.DEFAULT_LOOP_ITERATIONS;
        }
        // range(VARIABLE)
        const rangeVarMatch = iterable.match(/^range\s*\(\s*([A-Z_]\w*)\s*\)$/);
        if (rangeVarMatch) {
            const val = this.variableConstants.get(rangeVarMatch[1]);
            if (val !== undefined) {
                return val;
            }
        }
        // range(len(something))
        if (/^range\s*\(\s*len\s*\(/.test(iterable)) {
            return constants_1.DEFAULT_LOOP_ITERATIONS;
        }
        // enumerate(...) or zip(...)
        if (/^(enumerate|zip)\s*\(/.test(iterable)) {
            return constants_1.DEFAULT_LOOP_ITERATIONS;
        }
        // Literal list/tuple/set/dict
        const literalMatch = iterable.match(/^\[([^\]]*)\]$|^\(([^)]*)\)$|^\{([^}]*)\}$/);
        if (literalMatch) {
            const content = literalMatch[1] || literalMatch[2] || literalMatch[3] || '';
            if (content.trim() === '') {
                return 0;
            }
            return content.split(',').length;
        }
        return constants_1.DEFAULT_LOOP_ITERATIONS;
    }
    /**
     * Estimate while-loop iterations from the condition string.
     * Faithful port of Python's _estimate_while_iterations_from_condition.
     */
    estimateWhileIterationsFromCondition(header) {
        const braceMatch = header.match(WHILE_COND_REGEX);
        if (braceMatch) {
            const endStr = braceMatch[3];
            let endVal;
            if (/^\d+$/.test(endStr)) {
                endVal = parseInt(endStr, 10);
            }
            else {
                const constVal = this.variableConstants.get(endStr);
                if (constVal !== undefined) {
                    endVal = constVal;
                }
                else {
                    return constants_1.DEFAULT_LOOP_ITERATIONS;
                }
            }
            return endVal;
        }
        return constants_1.DEFAULT_LOOP_ITERATIONS;
    }
    /**
     * Estimate Python while-loop iterations from the condition.
     */
    estimatePythonWhileIterations(condition) {
        const match = condition.match(/^(\w+)\s*(<|>|<=|>=|!=)\s*(\d+|\w+)$/);
        if (match) {
            const endStr = match[3];
            let endVal;
            if (/^\d+$/.test(endStr)) {
                endVal = parseInt(endStr, 10);
            }
            else {
                const constVal = this.variableConstants.get(endStr);
                if (constVal !== undefined) {
                    endVal = constVal;
                }
                else {
                    return constants_1.DEFAULT_LOOP_ITERATIONS;
                }
            }
            return endVal > 0 ? endVal : constants_1.DEFAULT_LOOP_ITERATIONS;
        }
        return constants_1.DEFAULT_LOOP_ITERATIONS;
    }
    // ===========================================================================
    // UTILITIES
    // ===========================================================================
    /** Count maximum nesting depth of loops in code */
    countMaxNesting(code) {
        if (this.language === 'python') {
            return this.countPythonNesting(code);
        }
        return this.countBraceNesting(code);
    }
    /** Count Python loop nesting by indentation */
    countPythonNesting(code) {
        let maxDepth = 0;
        let currentDepth = 0;
        const lines = code.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (/^(for|while)\s+/.test(trimmed)) {
                currentDepth++;
                maxDepth = Math.max(maxDepth, currentDepth);
            }
        }
        return maxDepth;
    }
    /** Count brace-based loop nesting depth */
    countBraceNesting(code) {
        let maxDepth = 0;
        let currentDepth = 0;
        const loopRegex = /\b(for|while|do)\b/g;
        let match;
        while ((match = loopRegex.exec(code)) !== null) {
            currentDepth++;
            maxDepth = Math.max(maxDepth, currentDepth);
        }
        return maxDepth;
    }
    /** Escape special regex characters in a string */
    escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
exports.RegexAnalyzer = RegexAnalyzer;
//# sourceMappingURL=regexAnalyzer.js.map