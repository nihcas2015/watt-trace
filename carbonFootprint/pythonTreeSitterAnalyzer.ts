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
import { OperationCount, FunctionAnalysis, AnalysisResult } from './models';
import {
  OpType,
  ENERGY_PER_OPERATION_JOULES,
  CARBON_INTENSITY_G_PER_KWH,
  DEFAULT_LOOP_ITERATIONS,
  DEFAULT_RECURSION_DEPTH,
  IO_FUNCTIONS,
  NETWORK_FUNCTIONS,
  ALLOC_FUNCTIONS,
  IO_CALL_SUBSTRINGS,
  NETWORK_CALL_SUBSTRINGS,
} from './constants';

// =============================================================================
// PYTHON TREE-SITTER ANALYZER
// =============================================================================

export class PythonTreeSitterAnalyzer {
  private result!: AnalysisResult;
  private variableConstants: Map<string, number> = new Map();
  private allFunctionNames: Set<string> = new Set();

  // Language-specific function classification sets
  private readonly ioFunctions: Set<string>;
  private readonly networkFunctions: Set<string>;
  private readonly allocFunctions: Set<string>;
  private readonly ioCallSubstrings: string[];
  private readonly networkCallSubstrings: string[];

  constructor() {
    this.ioFunctions = IO_FUNCTIONS['python'] || new Set();
    this.networkFunctions = NETWORK_FUNCTIONS['python'] || new Set();
    this.allocFunctions = ALLOC_FUNCTIONS['python'] || new Set();
    this.ioCallSubstrings = IO_CALL_SUBSTRINGS['python'] || [];
    this.networkCallSubstrings = NETWORK_CALL_SUBSTRINGS['python'] || [];
  }

  /**
   * Analyze Python source code using tree-sitter AST.
   *
   * @param rootNode - Tree-sitter root syntax node (module)
   * @param filePath - Optional file path
   * @returns Complete analysis result
   */
  analyze(rootNode: SyntaxNode, filePath?: string): AnalysisResult {
    this.result = new AnalysisResult('python', filePath || null);
    this.variableConstants = new Map();
    this.allFunctionNames = new Set();

    // Build variable constant table for loop bound resolution
    this.extractConstants(rootNode);

    // Add model assumptions
    this.result.assumptions.push(
      `Energy per operation: ${ENERGY_PER_OPERATION_JOULES} J`,
    );
    this.result.assumptions.push(
      `Carbon intensity: ${CARBON_INTENSITY_G_PER_KWH} gCO2/kWh (global average)`,
    );

    // Collect all function names for recursion detection
    this.collectFunctionNames(rootNode);

    // Analyze top-level statements (global scope)
    for (const child of rootNode.namedChildren) {
      const nodeType = child.type;

      if (nodeType === 'function_definition') {
        this.result.functions.push(this.analyzeFunction(child));
      } else if (nodeType === 'decorated_definition') {
        // Decorated function/class — find the actual definition inside
        const innerDef = child.namedChildren.find(
          (c) => c.type === 'function_definition' || c.type === 'class_definition',
        );
        if (innerDef) {
          if (innerDef.type === 'function_definition') {
            this.result.functions.push(this.analyzeFunction(innerDef));
          } else if (innerDef.type === 'class_definition') {
            this.analyzeClass(innerDef);
          }
        }
      } else if (nodeType === 'class_definition') {
        this.analyzeClass(child);
      } else {
        const ops = this.analyzeNode(child, 1);
        this.result.globalOperations.merge(ops);
      }
    }

    return this.result;
  }

  // ===========================================================================
  // CONSTANT EXTRACTION
  // ===========================================================================

  /**
   * Walk the AST and record variable = constant_int assignments.
   * e.g. `n = 100` or `size = 50` — so we can resolve `range(n)` later.
   */
  private extractConstants(node: SyntaxNode): void {
    if (node.type === 'assignment') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left && right && left.type === 'identifier') {
        const val = this.resolveConstantExpr(right);
        if (val !== undefined) {
          this.variableConstants.set(left.text, val);
        }
      }
    }
    // Recurse into all children
    for (const child of node.namedChildren) {
      this.extractConstants(child);
    }
  }

  /**
   * Try to resolve an expression node to a constant integer.
   * Handles: literal ints, simple arithmetic, variable references, len() heuristic.
   */
  private resolveConstantExpr(node: SyntaxNode): number | undefined {
    if (!node) { return undefined; }

    // Integer literal
    if (node.type === 'integer') {
      return this.parseIntLiteral(node.text);
    }

    // Float literal (truncate to int)
    if (node.type === 'float') {
      const val = parseFloat(node.text);
      return isNaN(val) ? undefined : Math.floor(val);
    }

    // Variable reference
    if (node.type === 'identifier') {
      return this.variableConstants.get(node.text);
    }

    // Parenthesized expression
    if (node.type === 'parenthesized_expression') {
      const inner = node.namedChildren[0];
      return inner ? this.resolveConstantExpr(inner) : undefined;
    }

    // Binary operation
    if (node.type === 'binary_operator') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      const operator = this.getOperatorText(node);

      if (left && right) {
        const leftVal = this.resolveConstantExpr(left);
        const rightVal = this.resolveConstantExpr(right);
        if (leftVal !== undefined && rightVal !== undefined) {
          switch (operator) {
            case '+': return leftVal + rightVal;
            case '-': return leftVal - rightVal;
            case '*': return leftVal * rightVal;
            case '//': return rightVal !== 0 ? Math.floor(leftVal / rightVal) : undefined;
            case '%': return rightVal !== 0 ? leftVal % rightVal : undefined;
          }
        }
      }
    }

    // Unary operator (e.g., -1)
    if (node.type === 'unary_operator') {
      const operand = node.namedChildren.find(
        (c) => c.type === 'integer' || c.type === 'float' || c.type === 'identifier',
      );
      const op = this.getOperatorText(node);
      if (operand) {
        const val = this.resolveConstantExpr(operand);
        if (val !== undefined && op === '-') { return -val; }
        if (val !== undefined && op === '+') { return val; }
      }
    }

    // len(something) — heuristic: we can't know size, use default
    if (node.type === 'call') {
      const callName = this.getCallName(node);
      if (callName === 'len') {
        return DEFAULT_LOOP_ITERATIONS;
      }
    }

    return undefined;
  }

  // ===========================================================================
  // FUNCTION NAME COLLECTION
  // ===========================================================================

  /** Collect all function/method names in the AST for recursion detection */
  private collectFunctionNames(node: SyntaxNode): void {
    if (node.type === 'function_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        this.allFunctionNames.add(nameNode.text);
      }
    }
    for (const child of node.namedChildren) {
      this.collectFunctionNames(child);
    }
  }

  // ===========================================================================
  // CLASS ANALYSIS
  // ===========================================================================

  /** Analyze a class definition — extract methods */
  private analyzeClass(classNode: SyntaxNode): void {
    const className = classNode.childForFieldName('name')?.text || 'UnknownClass';
    const body = classNode.childForFieldName('body');
    if (!body) { return; }

    for (const item of body.namedChildren) {
      if (item.type === 'function_definition') {
        this.result.functions.push(this.analyzeFunction(item, className));
      } else if (item.type === 'decorated_definition') {
        const innerDef = item.namedChildren.find((c) => c.type === 'function_definition');
        if (innerDef) {
          this.result.functions.push(this.analyzeFunction(innerDef, className));
        }
      }
    }
  }

  // ===========================================================================
  // FUNCTION ANALYSIS
  // ===========================================================================

  /**
   * Analyze a single function definition.
   */
  private analyzeFunction(node: SyntaxNode, className?: string): FunctionAnalysis {
    const nameNode = node.childForFieldName('name');
    const funcName = nameNode?.text || 'unknown';
    const name = className ? `${className}.${funcName}` : funcName;
    const func = new FunctionAnalysis(name, node.startPosition.row + 1);

    // Save and extend variable scope
    const savedVars = new Map(this.variableConstants);
    this.extractConstants(node);

    // Detect recursion: does the function call itself?
    this.walkForCalls(node, func, funcName);

    // Analyze every statement in the function body individually
    const body = node.childForFieldName('body');
    if (body) {
      for (const stmt of body.namedChildren) {
        const ops = this.analyzeNode(stmt, 1);
        func.operations.merge(ops);
      }
    }

    // If recursive, scale by estimated recursion depth
    if (func.isRecursive) {
      func.operations = func.operations.scale(DEFAULT_RECURSION_DEPTH);
      this.result.assumptions.push(
        `Function '${name}' is recursive — assumed ${DEFAULT_RECURSION_DEPTH} recursive calls`,
      );
    }

    // Track max loop nesting
    func.maxNesting = this.getMaxLoopDepth(node);

    // Restore variable scope
    this.variableConstants = savedVars;

    return func;
  }

  /** Walk AST to find all function calls (for recursion detection) */
  private walkForCalls(node: SyntaxNode, func: FunctionAnalysis, funcName: string): void {
    if (node.type === 'call') {
      const callName = this.getCallName(node);
      if (callName) {
        func.calls.push(callName);
        if (callName === funcName) {
          func.isRecursive = true;
        }
      }
    }
    for (const child of node.namedChildren) {
      this.walkForCalls(child, func, funcName);
    }
  }

  // ===========================================================================
  // NODE ANALYSIS (Statement-level)
  // ===========================================================================

  /**
   * Recursively analyze an AST node and count operations.
   *
   * CRITICAL: loopMultiplier is passed down into every child statement
   * inside a loop body. This means if a loop runs N times and contains
   * 5 print statements + 3 additions, we count N*5 IO ops + N*3 additions.
   * For nested loops, multipliers cascade: outer_N * inner_M * ops_in_body.
   */
  private analyzeNode(node: SyntaxNode, loopMultiplier: number): OperationCount {
    const ops = new OperationCount();
    if (!node) { return ops; }

    switch (node.type) {
      // --- Assignments ---
      case 'assignment': {
        ops.add(OpType.ASSIGNMENT, loopMultiplier);
        const right = node.childForFieldName('right');
        if (right) {
          ops.merge(this.analyzeExpression(right, loopMultiplier));
        }
        break;
      }

      case 'augmented_assignment': {
        ops.add(OpType.ASSIGNMENT, loopMultiplier);
        const right = node.childForFieldName('right');
        if (right) {
          ops.merge(this.analyzeExpression(right, loopMultiplier));
        }
        // Count the arithmetic operation from the augmented operator
        const augOp = this.getAugmentedOperator(node);
        switch (augOp) {
          case '+=': ops.add(OpType.ADDITION, loopMultiplier); break;
          case '-=': ops.add(OpType.SUBTRACTION, loopMultiplier); break;
          case '*=': case '@=': ops.add(OpType.MULTIPLICATION, loopMultiplier); break;
          case '/=': case '//=': case '%=': ops.add(OpType.DIVISION, loopMultiplier); break;
        }
        break;
      }

      // Type-annotated assignment (e.g., x: int = 5)
      case 'type_alias_statement': {
        ops.add(OpType.ASSIGNMENT, loopMultiplier);
        break;
      }

      // --- For loops ---
      case 'for_statement': {
        const iterable = node.childForFieldName('right');
        const iterations = iterable
          ? this.estimateForIterations(iterable, node)
          : DEFAULT_LOOP_ITERATIONS;
        const innerMultiplier = loopMultiplier * iterations;

        if (iterations !== DEFAULT_LOOP_ITERATIONS) {
          this.result.assumptions.push(
            `Line ${node.startPosition.row + 1}: for-loop resolved to ${iterations} iterations`,
          );
        } else {
          this.result.assumptions.push(
            `Line ${node.startPosition.row + 1}: for-loop iterations unknown, assumed ${DEFAULT_LOOP_ITERATIONS}`,
          );
        }

        // Loop condition checked once per iteration
        ops.add(OpType.COMPARISON, loopMultiplier * iterations);

        // EACH statement in the loop body is analyzed with innerMultiplier
        const forBody = node.childForFieldName('body');
        if (forBody) {
          for (const stmt of forBody.namedChildren) {
            ops.merge(this.analyzeNode(stmt, innerMultiplier));
          }
        }

        // else clause
        const forAlt = this.findChildByType(node, 'else_clause');
        if (forAlt) {
          const altBody = forAlt.childForFieldName('body') || forAlt.namedChildren.find((c) => c.type === 'block');
          if (altBody) {
            for (const stmt of altBody.namedChildren) {
              ops.merge(this.analyzeNode(stmt, loopMultiplier));
            }
          }
        }
        break;
      }

      // --- While loops ---
      case 'while_statement': {
        const condition = node.childForFieldName('condition');
        const iterations = condition
          ? this.estimateWhileIterations(condition, node)
          : DEFAULT_LOOP_ITERATIONS;
        const innerMultiplier = loopMultiplier * iterations;

        this.result.assumptions.push(
          `Line ${node.startPosition.row + 1}: while-loop estimated ${iterations} iterations`,
        );

        ops.add(OpType.COMPARISON, loopMultiplier * iterations);
        if (condition) {
          ops.merge(this.analyzeExpression(condition, loopMultiplier));
        }

        // Each body statement gets the full multiplier
        const whileBody = node.childForFieldName('body');
        if (whileBody) {
          for (const stmt of whileBody.namedChildren) {
            ops.merge(this.analyzeNode(stmt, innerMultiplier));
          }
        }

        // else clause
        const whileAlt = this.findChildByType(node, 'else_clause');
        if (whileAlt) {
          const altBody = whileAlt.childForFieldName('body') || whileAlt.namedChildren.find((c) => c.type === 'block');
          if (altBody) {
            for (const stmt of altBody.namedChildren) {
              ops.merge(this.analyzeNode(stmt, loopMultiplier));
            }
          }
        }
        break;
      }

      // --- Conditionals ---
      case 'if_statement':
      case 'elif_clause': {
        ops.add(OpType.CONDITIONAL, loopMultiplier);

        const ifCondition = node.childForFieldName('condition');
        if (ifCondition) {
          ops.merge(this.analyzeExpression(ifCondition, loopMultiplier));
        }

        const consequence = node.childForFieldName('consequence') || node.childForFieldName('body');
        if (consequence) {
          for (const stmt of consequence.namedChildren) {
            ops.merge(this.analyzeNode(stmt, loopMultiplier));
          }
        }

        // Handle alternative (elif or else)
        const alternative = node.childForFieldName('alternative');
        if (alternative) {
          if (alternative.type === 'elif_clause') {
            ops.merge(this.analyzeNode(alternative, loopMultiplier));
          } else if (alternative.type === 'else_clause') {
            const elseBody = alternative.childForFieldName('body')
              || alternative.namedChildren.find((c) => c.type === 'block');
            if (elseBody) {
              for (const stmt of elseBody.namedChildren) {
                ops.merge(this.analyzeNode(stmt, loopMultiplier));
              }
            } else {
              // Some grammars put statements directly inside else_clause
              for (const stmt of alternative.namedChildren) {
                ops.merge(this.analyzeNode(stmt, loopMultiplier));
              }
            }
          }
        }
        break;
      }

      // --- Expression statements (function calls, etc.) ---
      case 'expression_statement': {
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, loopMultiplier));
        }
        break;
      }

      // --- Return ---
      case 'return_statement': {
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, loopMultiplier));
        }
        break;
      }

      // --- Try/Except ---
      case 'try_statement': {
        for (const child of node.namedChildren) {
          if (child.type === 'block') {
            // Try body
            for (const stmt of child.namedChildren) {
              ops.merge(this.analyzeNode(stmt, loopMultiplier));
            }
          } else if (child.type === 'except_clause') {
            // Except handler body
            const handlerBody = this.findBlockChild(child);
            if (handlerBody) {
              for (const stmt of handlerBody.namedChildren) {
                ops.merge(this.analyzeNode(stmt, loopMultiplier));
              }
            }
          } else if (child.type === 'finally_clause') {
            const finallyBody = this.findBlockChild(child);
            if (finallyBody) {
              for (const stmt of finallyBody.namedChildren) {
                ops.merge(this.analyzeNode(stmt, loopMultiplier));
              }
            }
          } else if (child.type === 'else_clause') {
            const elseBody = this.findBlockChild(child);
            if (elseBody) {
              for (const stmt of elseBody.namedChildren) {
                ops.merge(this.analyzeNode(stmt, loopMultiplier));
              }
            }
          }
        }
        break;
      }

      // --- With statement ---
      case 'with_statement': {
        // with statements often involve I/O (file open)
        // Analyze the with items (context expressions)
        const withClause = this.findChildByType(node, 'with_clause');
        if (withClause) {
          for (const item of withClause.namedChildren) {
            if (item.type === 'with_item') {
              const valueNode = item.childForFieldName('value') || item.namedChildren[0];
              if (valueNode) {
                ops.merge(this.analyzeExpression(valueNode, loopMultiplier));
              }
            }
          }
        } else {
          // Older grammar: with items are direct children
          for (const child of node.namedChildren) {
            if (child.type === 'with_item') {
              const valueNode = child.namedChildren[0];
              if (valueNode) {
                ops.merge(this.analyzeExpression(valueNode, loopMultiplier));
              }
            }
          }
        }
        // Analyze body
        const withBody = node.childForFieldName('body');
        if (withBody) {
          for (const stmt of withBody.namedChildren) {
            ops.merge(this.analyzeNode(stmt, loopMultiplier));
          }
        }
        break;
      }

      // --- Delete ---
      case 'delete_statement': {
        ops.add(OpType.MEMORY_ALLOC, loopMultiplier); // deallocation cost
        break;
      }

      // --- Global/Nonlocal/Pass/Break/Continue — negligible cost ---
      case 'global_statement':
      case 'nonlocal_statement':
      case 'pass_statement':
      case 'break_statement':
      case 'continue_statement':
        break;

      // --- Raise ---
      case 'raise_statement': {
        ops.add(OpType.FUNCTION_CALL, loopMultiplier); // exception overhead
        break;
      }

      // --- Assert ---
      case 'assert_statement': {
        ops.add(OpType.COMPARISON, loopMultiplier);
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, loopMultiplier));
        }
        break;
      }

      // --- Import statements — minimal cost ---
      case 'import_statement':
      case 'import_from_statement':
        break;

      // --- Function/Class definitions encountered at non-top-level ---
      case 'function_definition':
      case 'class_definition':
      case 'decorated_definition':
        // These define scope but don't execute immediately
        break;

      // --- Fallback: walk children for any other compound statement ---
      default: {
        for (const child of node.namedChildren) {
          if (this.isStatementNode(child)) {
            ops.merge(this.analyzeNode(child, loopMultiplier));
          }
        }
        break;
      }
    }

    return ops;
  }

  // ===========================================================================
  // EXPRESSION ANALYSIS
  // ===========================================================================

  /**
   * Analyze an expression node for operations.
   */
  private analyzeExpression(node: SyntaxNode, multiplier: number = 1): OperationCount {
    const ops = new OperationCount();
    if (!node) { return ops; }

    switch (node.type) {
      // --- Binary operations ---
      case 'binary_operator': {
        const operator = this.getOperatorText(node);
        switch (operator) {
          case '+': ops.add(OpType.ADDITION, multiplier); break;
          case '-': ops.add(OpType.SUBTRACTION, multiplier); break;
          case '*': case '@': ops.add(OpType.MULTIPLICATION, multiplier); break;
          case '/': case '//': case '%': ops.add(OpType.DIVISION, multiplier); break;
          case '**':
            // Exponentiation is expensive — roughly equivalent to multiple multiplications
            ops.add(OpType.MULTIPLICATION, multiplier * 10);
            break;
          default:
            // Bitwise ops ~ addition cost
            ops.add(OpType.ADDITION, multiplier);
            break;
        }
        const binLeft = node.childForFieldName('left');
        const binRight = node.childForFieldName('right');
        if (binLeft) { ops.merge(this.analyzeExpression(binLeft, multiplier)); }
        if (binRight) { ops.merge(this.analyzeExpression(binRight, multiplier)); }
        break;
      }

      // --- Comparisons ---
      case 'comparison_operator': {
        // Count comparison operators (anonymous children like <, >, ==, etc.)
        let compCount = 0;
        for (const child of node.children) {
          if (!child.isNamed && this.isComparisonOp(child.type)) {
            compCount++;
          }
        }
        ops.add(OpType.COMPARISON, multiplier * Math.max(1, compCount));
        // Analyze operand expressions
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, multiplier));
        }
        break;
      }

      // --- Boolean operations ---
      case 'boolean_operator': {
        // Each 'and'/'or' is a comparison
        ops.add(OpType.COMPARISON, multiplier);
        const boolLeft = node.childForFieldName('left');
        const boolRight = node.childForFieldName('right');
        if (boolLeft) { ops.merge(this.analyzeExpression(boolLeft, multiplier)); }
        if (boolRight) { ops.merge(this.analyzeExpression(boolRight, multiplier)); }
        break;
      }

      // --- Not operator ---
      case 'not_operator': {
        ops.add(OpType.COMPARISON, multiplier);
        const notArg = node.namedChildren[0];
        if (notArg) { ops.merge(this.analyzeExpression(notArg, multiplier)); }
        break;
      }

      // --- Function calls ---
      case 'call': {
        const callName = this.getCallName(node);
        const fullCallName = this.getFullCallName(node);

        if (callName) {
          if (
            this.ioFunctions.has(callName) ||
            (fullCallName && this.ioCallSubstrings.some((io) => fullCallName.includes(io)))
          ) {
            ops.add(OpType.IO_OPERATION, multiplier);
          } else if (
            this.networkFunctions.has(callName) ||
            (fullCallName && this.networkCallSubstrings.some((net) => fullCallName.includes(net)))
          ) {
            ops.add(OpType.NETWORK_OP, multiplier);
          } else if (this.allocFunctions.has(callName)) {
            ops.add(OpType.MEMORY_ALLOC, multiplier);
          } else if (callName === 'sorted' || callName === 'sort') {
            // Sorting is O(n log n)
            ops.add(OpType.COMPARISON, multiplier * DEFAULT_LOOP_ITERATIONS * 7);
            ops.add(OpType.ASSIGNMENT, multiplier * DEFAULT_LOOP_ITERATIONS * 7);
          } else if (['sum', 'min', 'max', 'any', 'all'].includes(callName)) {
            // These iterate over their argument — O(n)
            ops.add(OpType.ADDITION, multiplier * DEFAULT_LOOP_ITERATIONS);
            ops.add(OpType.COMPARISON, multiplier * DEFAULT_LOOP_ITERATIONS);
          } else if (['enumerate', 'zip', 'map', 'filter', 'reversed'].includes(callName)) {
            // Iterator wrappers — cost realized when iterated, minimal direct cost
            ops.add(OpType.FUNCTION_CALL, multiplier);
          } else if (callName === 'range') {
            // range() itself is cheap, cost is in the for loop
            ops.add(OpType.FUNCTION_CALL, multiplier);
          } else if (callName === 'len') {
            ops.add(OpType.FUNCTION_CALL, multiplier);
          } else if (callName === 'append') {
            ops.add(OpType.MEMORY_ALLOC, multiplier);
          } else {
            ops.add(OpType.FUNCTION_CALL, multiplier);
          }
        } else {
          ops.add(OpType.FUNCTION_CALL, multiplier);
        }

        // Analyze arguments
        const argsNode = node.childForFieldName('arguments');
        if (argsNode) {
          for (const arg of argsNode.namedChildren) {
            if (arg.type === 'keyword_argument') {
              const valNode = arg.childForFieldName('value');
              if (valNode) { ops.merge(this.analyzeExpression(valNode, multiplier)); }
            } else {
              ops.merge(this.analyzeExpression(arg, multiplier));
            }
          }
        }
        break;
      }

      // --- Subscript (array/dict access) ---
      case 'subscript': {
        ops.add(OpType.ARRAY_ACCESS, multiplier);
        const subValue = node.childForFieldName('value') || node.namedChildren[0];
        const subSlice = node.childForFieldName('subscript') || node.namedChildren[1];
        if (subValue) { ops.merge(this.analyzeExpression(subValue, multiplier)); }
        if (subSlice) { ops.merge(this.analyzeExpression(subSlice, multiplier)); }
        break;
      }

      // --- List/Set comprehensions and generator expressions ---
      case 'list_comprehension':
      case 'set_comprehension':
      case 'generator_expression': {
        const compIter = this.estimateComprehensionIterations(node);
        const innerMult = multiplier * compIter;
        ops.add(OpType.MEMORY_ALLOC, multiplier); // creating the collection

        // Body expression runs once per iteration
        const compBody = node.childForFieldName('body') || node.namedChildren[0];
        if (compBody && compBody.type !== 'for_in_clause' && compBody.type !== 'if_clause') {
          ops.merge(this.analyzeExpression(compBody, innerMult));
        }

        // for_in_clause and if_clause
        for (const child of node.namedChildren) {
          if (child.type === 'for_in_clause') {
            ops.add(OpType.COMPARISON, innerMult);
            const iterExpr = child.childForFieldName('value') || child.namedChildren.find(
              (c) => c.type !== 'identifier' && c.type !== 'pattern_list',
            );
            if (iterExpr) {
              ops.merge(this.analyzeExpression(iterExpr, multiplier));
            }
          } else if (child.type === 'if_clause') {
            ops.add(OpType.CONDITIONAL, innerMult);
            for (const ifChild of child.namedChildren) {
              ops.merge(this.analyzeExpression(ifChild, innerMult));
            }
          }
        }
        break;
      }

      // --- Dictionary comprehension ---
      case 'dictionary_comprehension': {
        const dictCompIter = this.estimateComprehensionIterations(node);
        const dictInnerMult = multiplier * dictCompIter;
        ops.add(OpType.MEMORY_ALLOC, multiplier);

        // Key and value expressions
        const pair = node.namedChildren.find((c) => c.type === 'pair');
        if (pair) {
          const key = pair.childForFieldName('key') || pair.namedChildren[0];
          const value = pair.childForFieldName('value') || pair.namedChildren[1];
          if (key) { ops.merge(this.analyzeExpression(key, dictInnerMult)); }
          if (value) { ops.merge(this.analyzeExpression(value, dictInnerMult)); }
        }

        for (const child of node.namedChildren) {
          if (child.type === 'for_in_clause') {
            const iterExpr = child.namedChildren[child.namedChildCount - 1];
            if (iterExpr) {
              ops.merge(this.analyzeExpression(iterExpr, multiplier));
            }
          }
        }
        break;
      }

      // --- Unary operations ---
      case 'unary_operator': {
        ops.add(OpType.ADDITION, multiplier);
        const operand = node.namedChildren[0];
        if (operand) { ops.merge(this.analyzeExpression(operand, multiplier)); }
        break;
      }

      // --- Attribute access ---
      case 'attribute': {
        const attrObj = node.childForFieldName('object') || node.namedChildren[0];
        if (attrObj) { ops.merge(this.analyzeExpression(attrObj, multiplier)); }
        break;
      }

      // --- Ternary if-expression ---
      case 'conditional_expression': {
        ops.add(OpType.CONDITIONAL, multiplier);
        // Children: body, "if", condition, "else", orelse
        const named = node.namedChildren;
        if (named.length >= 3) {
          ops.merge(this.analyzeExpression(named[0], multiplier)); // body
          ops.merge(this.analyzeExpression(named[1], multiplier)); // condition
          ops.merge(this.analyzeExpression(named[2], multiplier)); // orelse
        } else {
          for (const child of named) {
            ops.merge(this.analyzeExpression(child, multiplier));
          }
        }
        break;
      }

      // --- Collection literals ---
      case 'list':
      case 'tuple':
      case 'set': {
        if (node.namedChildCount > 0) {
          ops.add(OpType.MEMORY_ALLOC, multiplier);
          ops.add(OpType.ASSIGNMENT, multiplier * node.namedChildCount);
        }
        for (const elt of node.namedChildren) {
          ops.merge(this.analyzeExpression(elt, multiplier));
        }
        break;
      }

      case 'dictionary': {
        const pairs = node.namedChildren.filter((c) => c.type === 'pair');
        if (pairs.length > 0) {
          ops.add(OpType.MEMORY_ALLOC, multiplier);
          ops.add(OpType.ASSIGNMENT, multiplier * pairs.length);
        }
        for (const p of pairs) {
          const key = p.childForFieldName('key') || p.namedChildren[0];
          const value = p.childForFieldName('value') || p.namedChildren[1];
          if (key) { ops.merge(this.analyzeExpression(key, multiplier)); }
          if (value) { ops.merge(this.analyzeExpression(value, multiplier)); }
        }
        // Handle dictionary unpacking (**dict)
        for (const child of node.namedChildren) {
          if (child.type === 'dictionary_splat') {
            ops.merge(this.analyzeExpression(child.namedChildren[0], multiplier));
          }
        }
        break;
      }

      // --- F-strings / formatted strings ---
      case 'string':
      case 'concatenated_string': {
        // Look for interpolation nodes inside strings (f-strings)
        for (const child of node.namedChildren) {
          if (child.type === 'interpolation') {
            const interpExpr = child.namedChildren[0];
            if (interpExpr) {
              ops.merge(this.analyzeExpression(interpExpr, multiplier));
              ops.add(OpType.FUNCTION_CALL, multiplier); // formatting cost
            }
          }
        }
        break;
      }

      // --- Starred expression ---
      case 'list_splat':
      case 'dictionary_splat': {
        const splatExpr = node.namedChildren[0];
        if (splatExpr) { ops.merge(this.analyzeExpression(splatExpr, multiplier)); }
        break;
      }

      // --- Parenthesized expression ---
      case 'parenthesized_expression': {
        const inner = node.namedChildren[0];
        if (inner) { ops.merge(this.analyzeExpression(inner, multiplier)); }
        break;
      }

      // --- Await expression ---
      case 'await': {
        const awaitExpr = node.namedChildren[0];
        if (awaitExpr) { ops.merge(this.analyzeExpression(awaitExpr, multiplier)); }
        break;
      }

      // --- Yield expression ---
      case 'yield': {
        const yieldExpr = node.namedChildren[0];
        if (yieldExpr) { ops.merge(this.analyzeExpression(yieldExpr, multiplier)); }
        break;
      }

      // --- Lambda ---
      case 'lambda': {
        ops.add(OpType.FUNCTION_CALL, multiplier);
        const lambdaBody = node.childForFieldName('body');
        if (lambdaBody) { ops.merge(this.analyzeExpression(lambdaBody, multiplier)); }
        break;
      }

      // --- Walrus operator (:=) ---
      case 'named_expression': {
        ops.add(OpType.ASSIGNMENT, multiplier);
        const namedValue = node.childForFieldName('value') || node.namedChildren[1];
        if (namedValue) { ops.merge(this.analyzeExpression(namedValue, multiplier)); }
        break;
      }

      // --- Assignment expression in comprehension context ---
      case 'assignment': {
        ops.add(OpType.ASSIGNMENT, multiplier);
        const assignRight = node.childForFieldName('right');
        if (assignRight) { ops.merge(this.analyzeExpression(assignRight, multiplier)); }
        break;
      }

      // --- Identifiers, literals — no operations ---
      case 'identifier':
      case 'integer':
      case 'float':
      case 'true':
      case 'false':
      case 'none':
      case 'ellipsis':
      case 'comment':
        break;

      // --- Default: recurse into children ---
      default: {
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, multiplier));
        }
        break;
      }
    }

    return ops;
  }

  // ===========================================================================
  // LOOP ITERATION ESTIMATION
  // ===========================================================================

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
  private estimateForIterations(iterable: SyntaxNode, _forNode: SyntaxNode): number {
    // range() call
    if (iterable.type === 'call') {
      const callName = this.getCallName(iterable);

      if (callName === 'range') {
        const args = this.getCallArguments(iterable);
        const resolvedArgs = args.map((a) => this.resolveConstantExpr(a));

        if (args.length === 1 && resolvedArgs[0] !== undefined) {
          return Math.max(0, resolvedArgs[0]);
        }
        if (args.length === 2 && resolvedArgs[0] !== undefined && resolvedArgs[1] !== undefined) {
          return Math.max(0, resolvedArgs[1] - resolvedArgs[0]);
        }
        if (args.length === 3 && resolvedArgs.every((r) => r !== undefined)) {
          const [start, stop, step] = resolvedArgs as number[];
          if (step !== 0) {
            return Math.max(0, Math.ceil((stop - start) / step));
          }
        }

        // range(n) where n is a variable — try to resolve
        if (args.length === 1 && args[0].type === 'identifier') {
          const varName = args[0].text;
          if (this.variableConstants.has(varName)) {
            return this.variableConstants.get(varName)!;
          }
        }

        // range(len(...)) — use heuristic
        if (args.length === 1 && args[0].type === 'call') {
          const innerName = this.getCallName(args[0]);
          if (innerName === 'len') {
            return DEFAULT_LOOP_ITERATIONS;
          }
        }

        return DEFAULT_LOOP_ITERATIONS;
      }

      if (callName === 'enumerate') {
        // enumerate(iterable) — try to resolve the iterable length
        const enumArgs = this.getCallArguments(iterable);
        if (enumArgs.length > 0) {
          const innerIterable = enumArgs[0];
          if (innerIterable.type === 'call') {
            const innerName = this.getCallName(innerIterable);
            if (innerName === 'range') {
              // Recursively estimate
              return this.estimateForIterations(innerIterable, _forNode);
            }
          }
        }
        return DEFAULT_LOOP_ITERATIONS;
      }

      if (callName === 'zip') {
        return DEFAULT_LOOP_ITERATIONS;
      }
    }

    // Iterating over a variable — check if we know its size
    if (iterable.type === 'identifier') {
      if (this.variableConstants.has(iterable.text)) {
        return this.variableConstants.get(iterable.text)!;
      }
    }

    // Iterating over a string literal
    if (iterable.type === 'string') {
      // Rough estimate: string length minus quotes
      const text = iterable.text;
      const content = text.slice(1, -1); // Remove quotes
      return content.length || DEFAULT_LOOP_ITERATIONS;
    }

    // Iterating over a list/tuple literal
    if (iterable.type === 'list' || iterable.type === 'tuple') {
      return iterable.namedChildCount;
    }

    // Iterating over a dict literal
    if (iterable.type === 'dictionary') {
      return iterable.namedChildren.filter((c) => c.type === 'pair').length;
    }

    return DEFAULT_LOOP_ITERATIONS;
  }

  /**
   * Estimate while loop iterations by analyzing the condition.
   *
   * Handles patterns:
   * - while i < N: ... i += 1  (simple counter pattern)
   * - while condition: with a decrement (binary search halving)
   * - Fallback to DEFAULT_LOOP_ITERATIONS
   */
  private estimateWhileIterations(condition: SyntaxNode, whileNode: SyntaxNode): number {
    // Pattern: while var < const or while var > 0
    if (condition.type === 'comparison_operator') {
      const named = condition.namedChildren;
      if (named.length >= 2) {
        const leftExpr = named[0];
        const rightExpr = named[named.length - 1];

        // Find the comparison operator
        const compOps: string[] = [];
        for (const child of condition.children) {
          if (!child.isNamed && this.isComparisonOp(child.type)) {
            compOps.push(child.type);
          }
        }

        if (leftExpr.type === 'identifier' && compOps.length === 1) {
          const varName = leftExpr.text;
          const op = compOps[0];

          // while x < N pattern
          if (op === '<' || op === '<=') {
            const upper = this.resolveConstantExpr(rightExpr);
            if (upper !== undefined) {
              // Check if the loop body increments the variable
              const body = whileNode.childForFieldName('body');
              if (body) {
                for (const stmt of body.namedChildren) {
                  if (stmt.type === 'augmented_assignment') {
                    const augLeft = stmt.childForFieldName('left');
                    const augRight = stmt.childForFieldName('right');
                    const augOp = this.getAugmentedOperator(stmt);
                    if (augLeft?.text === varName && augOp === '+=') {
                      const step = augRight ? this.resolveConstantExpr(augRight) : undefined;
                      if (step && step > 0) {
                        return Math.max(1, Math.floor(upper / step));
                      }
                    }
                  }
                }
              }
              return upper;
            }
          }

          // while x > 0 pattern (decreasing)
          if (op === '>' || op === '>=') {
            const lower = this.resolveConstantExpr(rightExpr);
            if (lower !== undefined) {
              const start = this.variableConstants.get(varName);
              if (start !== undefined) {
                return Math.max(1, Math.abs(start - lower));
              }
            }
          }

          // while low <= high pattern (binary search)
          if (op === '<=') {
            return 20; // ~log2(1_000_000)
          }
        }
      }
    }

    return DEFAULT_LOOP_ITERATIONS;
  }

  /**
   * Estimate iterations for a list/set/dict comprehension.
   */
  private estimateComprehensionIterations(node: SyntaxNode): number {
    const forClause = node.namedChildren.find((c) => c.type === 'for_in_clause');
    if (!forClause) { return DEFAULT_LOOP_ITERATIONS; }

    // The iterable is typically the last named child of the for_in_clause
    // Structure: for_in_clause -> "for" identifier "in" iterable
    const iterableNode = forClause.namedChildren[forClause.namedChildCount - 1];
    if (!iterableNode) { return DEFAULT_LOOP_ITERATIONS; }

    if (iterableNode.type === 'call') {
      const callName = this.getCallName(iterableNode);
      if (callName === 'range') {
        const args = this.getCallArguments(iterableNode);
        const resolved = args.map((a) => this.resolveConstantExpr(a));
        if (args.length === 1 && resolved[0] !== undefined) {
          return resolved[0];
        }
        if (args.length >= 2 && resolved[0] !== undefined && resolved[1] !== undefined) {
          return Math.max(0, resolved[1] - resolved[0]);
        }
      }
    }

    if (iterableNode.type === 'list' || iterableNode.type === 'tuple') {
      return iterableNode.namedChildCount;
    }

    if (iterableNode.type === 'identifier' && this.variableConstants.has(iterableNode.text)) {
      return this.variableConstants.get(iterableNode.text)!;
    }

    return DEFAULT_LOOP_ITERATIONS;
  }

  // ===========================================================================
  // LOOP DEPTH
  // ===========================================================================

  /** Find the maximum loop nesting depth */
  private getMaxLoopDepth(node: SyntaxNode, currentDepth: number = 0): number {
    let maxDepth = currentDepth;
    for (const child of node.namedChildren) {
      if (child.type === 'for_statement' || child.type === 'while_statement') {
        maxDepth = Math.max(maxDepth, this.getMaxLoopDepth(child, currentDepth + 1));
      } else {
        maxDepth = Math.max(maxDepth, this.getMaxLoopDepth(child, currentDepth));
      }
    }
    return maxDepth;
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /** Extract the simple function name from a call node */
  private getCallName(node: SyntaxNode): string | undefined {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) { return undefined; }

    if (funcNode.type === 'identifier') {
      return funcNode.text;
    }
    if (funcNode.type === 'attribute') {
      const attrNode = funcNode.childForFieldName('attribute');
      return attrNode?.text;
    }
    return undefined;
  }

  /** Extract the full dotted call name like 'sys.stdout.write' */
  private getFullCallName(node: SyntaxNode): string | undefined {
    const funcNode = node.childForFieldName('function');
    if (!funcNode) { return undefined; }

    const parts: string[] = [];
    let current: SyntaxNode | null = funcNode;

    while (current && current.type === 'attribute') {
      const attr = current.childForFieldName('attribute');
      if (attr) { parts.unshift(attr.text); }
      current = current.childForFieldName('object') || null;
    }

    if (current && current.type === 'identifier') {
      parts.unshift(current.text);
    }

    return parts.length > 0 ? parts.join('.') : undefined;
  }

  /** Get positional arguments from a call node */
  private getCallArguments(callNode: SyntaxNode): SyntaxNode[] {
    const argsNode = callNode.childForFieldName('arguments');
    if (!argsNode) { return []; }

    return argsNode.namedChildren.filter(
      (c) => c.type !== 'keyword_argument' && c.type !== 'dictionary_splat' && c.type !== 'list_splat',
    );
  }

  /** Get the operator text from a binary_operator or unary_operator node */
  private getOperatorText(node: SyntaxNode): string {
    // Try field name first
    const opNode = node.childForFieldName('operator');
    if (opNode) { return opNode.type; }

    // Fallback: find the non-named child that is an operator
    for (const child of node.children) {
      if (!child.isNamed) {
        const t = child.type;
        if (['+', '-', '*', '/', '//', '%', '**', '@',
          '|', '&', '^', '<<', '>>', '~',
          '+=', '-=', '*=', '/=', '//=', '%=', '**=', '@=',
          '>>=', '<<=', '&=', '^=', '|=',
          'not', 'and', 'or',
        ].includes(t)) {
          return t;
        }
      }
    }

    return '';
  }

  /** Get the augmented assignment operator (+=, -=, etc.) */
  private getAugmentedOperator(node: SyntaxNode): string {
    // The operator in augmented_assignment is typically a non-named child
    for (const child of node.children) {
      if (!child.isNamed) {
        const t = child.type;
        if (['+=', '-=', '*=', '/=', '//=', '%=', '**=', '@=',
          '>>=', '<<=', '&=', '^=', '|='].includes(t)) {
          return t;
        }
      }
    }
    return '';
  }

  /** Check if a string is a comparison operator */
  private isComparisonOp(type: string): boolean {
    return ['<', '>', '<=', '>=', '==', '!=', '<>',
      'in', 'is', 'not'].includes(type);
  }

  /** Check if a node is a statement type */
  private isStatementNode(node: SyntaxNode): boolean {
    const stmtTypes = new Set([
      'expression_statement', 'assignment', 'augmented_assignment',
      'return_statement', 'if_statement', 'for_statement', 'while_statement',
      'try_statement', 'with_statement', 'delete_statement', 'raise_statement',
      'pass_statement', 'break_statement', 'continue_statement',
      'global_statement', 'nonlocal_statement', 'assert_statement',
      'import_statement', 'import_from_statement',
      'function_definition', 'class_definition', 'decorated_definition',
    ]);
    return stmtTypes.has(node.type);
  }

  /** Find first child of a given type */
  private findChildByType(node: SyntaxNode, type: string): SyntaxNode | undefined {
    return node.namedChildren.find((c) => c.type === type);
  }

  /** Find a block child (used for try/except/finally bodies) */
  private findBlockChild(node: SyntaxNode): SyntaxNode | undefined {
    return node.namedChildren.find((c) => c.type === 'block');
  }

  /** Parse a Python integer literal (handles 0x, 0o, 0b, underscores) */
  private parseIntLiteral(text: string): number | undefined {
    const cleaned = text.replace(/_/g, '');
    const val = Number(cleaned);
    return isNaN(val) ? undefined : Math.floor(val);
  }
}
