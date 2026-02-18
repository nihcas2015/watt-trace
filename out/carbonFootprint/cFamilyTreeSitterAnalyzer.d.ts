/**
 * Carbon Footprint Estimator — C-family Tree-sitter Analyzer
 *
 * TypeScript port of RegexAnalyzer from carbon_footprint_estimator.py
 * but using tree-sitter AST instead of regex for much higher accuracy.
 *
 * Supports: Java, C, C++, JavaScript, TypeScript
 *
 * KEY DESIGN: Uses tree-sitter to get a proper AST, then walks nodes
 * with depth-aware loop multipliers — exactly like PythonTreeSitterAnalyzer.
 * Each statement inside a loop body is individually analyzed with the
 * correct nesting multiplier.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */
import type { SyntaxNode } from './treeSitterManager';
import { AnalysisResult } from './models';
export declare class CFamilyTreeSitterAnalyzer {
    private result;
    private language;
    private variableConstants;
    private readonly ioFunctions;
    private readonly networkFunctions;
    private readonly allocFunctions;
    private readonly ioCallSubstrings;
    private readonly networkCallSubstrings;
    constructor(language: string);
    /**
     * Analyze source code using tree-sitter AST.
     */
    analyze(rootNode: SyntaxNode, filePath?: string): AnalysisResult;
    /** Extract variable = number assignments for loop bound resolution */
    private extractConstants;
    /** Extract constants from declaration nodes */
    private extractFromDeclaration;
    /** Get the name from a declarator node (handles pointer declarators, etc.) */
    private getDeclaratorName;
    /** Resolve an expression to a constant integer */
    private resolveConstantExpr;
    /** Check if a node is a function definition */
    private isFunctionDef;
    /** Check if a node is a class definition */
    private isClassDef;
    /** Check if a node is a variable declaration */
    private isVariableDeclaration;
    /** Check if a node is a number literal */
    private isNumberLiteral;
    /** Analyze a class definition — extract methods */
    private analyzeClass;
    /** Analyze a single function/method definition */
    private analyzeFunction;
    /** Get the function name from various function definition node types */
    private getFunctionName;
    /** Get the function body block */
    private getFunctionBody;
    /** Check if a node contains a call to a named function */
    private containsCallTo;
    /**
     * Recursively analyze an AST node and count operations.
     * Loop multipliers cascade for nested loops.
     */
    private analyzeNode;
    /** Analyze an expression node for operations */
    private analyzeExpression;
    /**
     * Estimate iterations for a C-family for loop.
     * Parses: for(int i = 0; i < 100; i++)
     */
    private estimateForIterations;
    /** Extract initial value from a for-loop initializer */
    private extractInitValue;
    /** Extract step value from a for-loop update expression */
    private extractStep;
    /**
     * Estimate while loop iterations.
     */
    private estimateWhileIterations;
    /** Find the maximum loop nesting depth */
    private getMaxLoopDepth;
    /** Check if a node is a call */
    private isCallNode;
    /** Get the simple function/method name from a call node */
    private getCallName;
    /** Get the full dotted call name */
    private getFullCallName;
    /** Get operator text from a binary/augmented expression */
    private getOperatorText;
    /** Get the update operator (++ or --) */
    private getUpdateOp;
    /** Get the unary operator */
    private getUnaryOp;
    /** Check if a node is a block/compound statement */
    private isBlockNode;
    /** Get the body of a statement (handles different grammar variations) */
    private getStatementBody;
    /** Parse a numeric literal string to a number */
    private parseNumericLiteral;
}
//# sourceMappingURL=cFamilyTreeSitterAnalyzer.d.ts.map