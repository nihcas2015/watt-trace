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
import { AnalysisResult } from './models';
export declare class RegexAnalyzer {
    private language;
    private result;
    private variableConstants;
    private readonly ioPattern;
    private readonly networkPattern;
    private readonly allocPattern;
    private readonly funcPattern;
    private readonly isBraceBased;
    constructor(language: string);
    /**
     * Analyze source code using regex-based line-by-line parsing.
     * This is the fallback when tree-sitter grammars are unavailable.
     */
    analyze(code: string, filePath?: string): AnalysisResult;
    /**
     * Remove comments from source code.
     * Faithful port of Python's _remove_comments method.
     */
    private removeComments;
    /** Remove Python comments and docstrings */
    private removePythonComments;
    /** Remove C-style comments (// and /* ... *‍/) */
    private removeCStyleComments;
    /** Extract variable = integer_literal assignments for loop bound resolution */
    private extractConstants;
    /**
     * Extract functions from source code and analyze each one.
     * Faithful port of Python's _extract_functions method.
     */
    private extractFunctions;
    /** Extract Python functions using indentation */
    private extractPythonFunctions;
    /** Analyze a Python block with indentation-based nesting */
    private analyzePythonBlock;
    /** Extract brace-based functions and analyze each */
    private extractBraceFunctions;
    /**
     * Extract a brace-delimited block starting at `startIdx` (the position of `{`).
     * Returns the content between the matched braces (not including them).
     * Faithful port of Python's _extract_brace_block.
     */
    private extractBraceBlock;
    /**
     * Analyze code by tracking brace depth for loop multipliers.
     * Faithful port of Python's _analyze_code_by_depth.
     *
     * KEY IDEA: We scan lines and track when we enter/exit loops.
     * When inside a loop, all operations are multiplied by the loop's
     * estimated iteration count. Nested loops cascade multipliers.
     */
    private analyzeCodeByDepth;
    /**
     * Count operations on a single line of code.
     * Faithful port of Python's _count_line_operations.
     */
    private countLineOperations;
    /**
     * Estimate for-loop iterations from the loop header string.
     * Faithful port of Python's _estimate_for_iterations_from_header.
     */
    private estimateForIterationsFromHeader;
    /**
     * Estimate Python for-loop iterations from the iterable expression.
     */
    private estimatePythonForIterations;
    /**
     * Estimate while-loop iterations from the condition string.
     * Faithful port of Python's _estimate_while_iterations_from_condition.
     */
    private estimateWhileIterationsFromCondition;
    /**
     * Estimate Python while-loop iterations from the condition.
     */
    private estimatePythonWhileIterations;
    /** Count maximum nesting depth of loops in code */
    private countMaxNesting;
    /** Count Python loop nesting by indentation */
    private countPythonNesting;
    /** Count brace-based loop nesting depth */
    private countBraceNesting;
    /** Escape special regex characters in a string */
    private escapeRegex;
}
//# sourceMappingURL=regexAnalyzer.d.ts.map