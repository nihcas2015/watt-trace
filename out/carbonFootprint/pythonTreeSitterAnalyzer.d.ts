/**
 * Carbon Footprint Estimator — Python Tree-sitter Analyzer
 *
 * TypeScript port of PythonAnalyzer from carbon_footprint_estimator.py
 * Uses tree-sitter instead of Python's ast module for AST-based analysis.
 *
 * KEY DESIGN: Every statement inside a loop body is individually analyzed
 * with the loop's iteration multiplier. So if a for-loop with 100 iterations
 * contains 10 print() calls, that counts as 100 * 10 = 1000 IO operations.
 * Nested loops multiply: for i in range(50): for j in range(20): print()
 * = 50 * 20 * 1 = 1000 IO operations.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */
import type { SyntaxNode } from './treeSitterManager';
import { AnalysisResult } from './models';
export declare class PythonTreeSitterAnalyzer {
    private result;
    private variableConstants;
    private allFunctionNames;
    private readonly ioFunctions;
    private readonly networkFunctions;
    private readonly allocFunctions;
    private readonly ioCallSubstrings;
    private readonly networkCallSubstrings;
    constructor();
    /**
     * Analyze Python source code using tree-sitter AST.
     *
     * @param rootNode - Tree-sitter root syntax node (module)
     * @param filePath - Optional file path
     * @returns Complete analysis result
     */
    analyze(rootNode: SyntaxNode, filePath?: string): AnalysisResult;
    /**
     * Walk the AST and record variable = constant_int assignments.
     * e.g. `n = 100` or `size = 50` — so we can resolve `range(n)` later.
     */
    private extractConstants;
    /**
     * Try to resolve an expression node to a constant integer.
     * Handles: literal ints, simple arithmetic, variable references, len() heuristic.
     */
    private resolveConstantExpr;
    /** Collect all function/method names in the AST for recursion detection */
    private collectFunctionNames;
    /** Analyze a class definition — extract methods */
    private analyzeClass;
    /**
     * Analyze a single function definition.
     */
    private analyzeFunction;
    /** Walk AST to find all function calls (for recursion detection) */
    private walkForCalls;
    /**
     * Recursively analyze an AST node and count operations.
     *
     * CRITICAL: loopMultiplier is passed down into every child statement
     * inside a loop body. This means if a loop runs N times and contains
     * 5 print statements + 3 additions, we count N*5 IO ops + N*3 additions.
     * For nested loops, multipliers cascade: outer_N * inner_M * ops_in_body.
     */
    private analyzeNode;
    /**
     * Analyze an expression node for operations.
     */
    private analyzeExpression;
    /**
     * Estimate the number of iterations for a Python for loop.
     *
     * Handles:
     * - range(N) where N is a literal or known variable
     * - range(start, stop) / range(start, stop, step)
     * - range(len(x)) — heuristic default
     * - for x in some_list — try to resolve list size
     * - for x in literal_list — count elements
     * - Fallback to DEFAULT_LOOP_ITERATIONS
     */
    private estimateForIterations;
    /**
     * Estimate while loop iterations by analyzing the condition.
     *
     * Handles patterns:
     * - while i < N: ... i += 1  (simple counter pattern)
     * - while condition: with a decrement (binary search halving)
     * - Fallback to DEFAULT_LOOP_ITERATIONS
     */
    private estimateWhileIterations;
    /**
     * Estimate iterations for a list/set/dict comprehension.
     */
    private estimateComprehensionIterations;
    /** Find the maximum loop nesting depth */
    private getMaxLoopDepth;
    /** Extract the simple function name from a call node */
    private getCallName;
    /** Extract the full dotted call name like 'sys.stdout.write' */
    private getFullCallName;
    /** Get positional arguments from a call node */
    private getCallArguments;
    /** Get the operator text from a binary_operator or unary_operator node */
    private getOperatorText;
    /** Get the augmented assignment operator (+=, -=, etc.) */
    private getAugmentedOperator;
    /** Check if a string is a comparison operator */
    private isComparisonOp;
    /** Check if a node is a statement type */
    private isStatementNode;
    /** Find first child of a given type */
    private findChildByType;
    /** Find a block child (used for try/except/finally bodies) */
    private findBlockChild;
    /** Parse a Python integer literal (handles 0x, 0o, 0b, underscores) */
    private parseIntLiteral;
}
//# sourceMappingURL=pythonTreeSitterAnalyzer.d.ts.map