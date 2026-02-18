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
// C-FAMILY TREE-SITTER ANALYZER
// =============================================================================

export class CFamilyTreeSitterAnalyzer {
  private result!: AnalysisResult;
  private language: string;
  private variableConstants: Map<string, number> = new Map();

  // Language-specific function classification
  private readonly ioFunctions: Set<string>;
  private readonly networkFunctions: Set<string>;
  private readonly allocFunctions: Set<string>;
  private readonly ioCallSubstrings: string[];
  private readonly networkCallSubstrings: string[];

  constructor(language: string) {
    this.language = language;

    // Use 'javascript' key for both JS and TS
    const langKey = language === 'typescript' ? 'javascript' : language;
    this.ioFunctions = IO_FUNCTIONS[langKey] || new Set();
    this.networkFunctions = NETWORK_FUNCTIONS[langKey] || new Set();
    this.allocFunctions = ALLOC_FUNCTIONS[langKey] || new Set();
    this.ioCallSubstrings = IO_CALL_SUBSTRINGS[langKey] || [];
    this.networkCallSubstrings = NETWORK_CALL_SUBSTRINGS[langKey] || [];
  }

  /**
   * Analyze source code using tree-sitter AST.
   */
  analyze(rootNode: SyntaxNode, filePath?: string): AnalysisResult {
    this.result = new AnalysisResult(this.language, filePath || null);
    this.variableConstants = new Map();

    this.result.assumptions.push(
      `Tree-sitter AST-based analysis for ${this.language}`,
    );
    this.result.assumptions.push(
      `Energy per operation: ${ENERGY_PER_OPERATION_JOULES} J`,
    );
    this.result.assumptions.push(
      `Carbon intensity: ${CARBON_INTENSITY_G_PER_KWH} gCO2/kWh (global average)`,
    );

    // Extract variable constants from assignments
    this.extractConstants(rootNode);

    // Walk top-level nodes
    for (const child of rootNode.namedChildren) {
      if (this.isFunctionDef(child)) {
        this.result.functions.push(this.analyzeFunction(child));
      } else if (this.isClassDef(child)) {
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

  /** Extract variable = number assignments for loop bound resolution */
  private extractConstants(node: SyntaxNode): void {
    // variable_declaration / local_variable_declaration / declaration
    if (this.isVariableDeclaration(node)) {
      this.extractFromDeclaration(node);
    }
    // assignment_expression
    if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      if (left && right && left.type === 'identifier') {
        const val = this.resolveConstantExpr(right);
        if (val !== undefined) {
          this.variableConstants.set(left.text, val);
        }
      }
    }
    for (const child of node.namedChildren) {
      this.extractConstants(child);
    }
  }

  /** Extract constants from declaration nodes */
  private extractFromDeclaration(node: SyntaxNode): void {
    // Walk all descendants looking for declarators with initial values
    for (const child of node.namedChildren) {
      const nameNode = child.childForFieldName('name') || child.childForFieldName('declarator');
      const valueNode = child.childForFieldName('value');
      if (nameNode && valueNode) {
        const name = this.getDeclaratorName(nameNode);
        if (name) {
          const val = this.resolveConstantExpr(valueNode);
          if (val !== undefined) {
            this.variableConstants.set(name, val);
          }
        }
      }
    }
  }

  /** Get the name from a declarator node (handles pointer declarators, etc.) */
  private getDeclaratorName(node: SyntaxNode): string | undefined {
    if (node.type === 'identifier') { return node.text; }
    if (node.type === 'variable_declarator' || node.type === 'init_declarator') {
      const inner = node.childForFieldName('name') || node.childForFieldName('declarator');
      return inner ? this.getDeclaratorName(inner) : undefined;
    }
    if (node.type === 'pointer_declarator') {
      const inner = node.childForFieldName('declarator');
      return inner ? this.getDeclaratorName(inner) : undefined;
    }
    return undefined;
  }

  /** Resolve an expression to a constant integer */
  private resolveConstantExpr(node: SyntaxNode): number | undefined {
    if (!node) { return undefined; }

    // Number literals (covers JS number, C number_literal, Java decimal_integer_literal, etc.)
    if (this.isNumberLiteral(node)) {
      return this.parseNumericLiteral(node.text);
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

    // Binary expression
    if (node.type === 'binary_expression') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      const op = this.getOperatorText(node);
      if (left && right) {
        const lv = this.resolveConstantExpr(left);
        const rv = this.resolveConstantExpr(right);
        if (lv !== undefined && rv !== undefined) {
          switch (op) {
            case '+': return lv + rv;
            case '-': return lv - rv;
            case '*': return lv * rv;
            case '/': return rv !== 0 ? Math.floor(lv / rv) : undefined;
            case '%': return rv !== 0 ? lv % rv : undefined;
          }
        }
      }
    }

    // Unary expression (e.g., -1)
    if (node.type === 'unary_expression') {
      const operand = node.namedChildren[0];
      if (operand && this.isNumberLiteral(operand)) {
        const val = this.parseNumericLiteral(operand.text);
        const op = this.getUnaryOp(node);
        if (val !== undefined && op === '-') { return -val; }
        if (val !== undefined && op === '+') { return val; }
      }
    }

    return undefined;
  }

  // ===========================================================================
  // FUNCTION / CLASS DETECTION
  // ===========================================================================

  /** Check if a node is a function definition */
  private isFunctionDef(node: SyntaxNode): boolean {
    return [
      'function_definition',    // C, C++
      'function_declaration',   // JavaScript
      'method_declaration',     // Java
      'method_definition',      // Class methods in JS
      'arrow_function',         // JS arrow functions (only if named via assignment)
      'generator_function_declaration', // JS generators
    ].includes(node.type);
  }

  /** Check if a node is a class definition */
  private isClassDef(node: SyntaxNode): boolean {
    return ['class_declaration', 'class_definition', 'struct_specifier'].includes(node.type);
  }

  /** Check if a node is a variable declaration */
  private isVariableDeclaration(node: SyntaxNode): boolean {
    return [
      'variable_declaration',        // JS
      'lexical_declaration',         // JS const/let
      'local_variable_declaration',  // Java
      'declaration',                 // C/C++
    ].includes(node.type);
  }

  /** Check if a node is a number literal */
  private isNumberLiteral(node: SyntaxNode): boolean {
    return [
      'number', 'number_literal',
      'decimal_integer_literal', 'integer_literal',
      'hex_integer_literal', 'octal_integer_literal', 'binary_integer_literal',
      'decimal_floating_point_literal', 'float_literal',
    ].includes(node.type);
  }

  // ===========================================================================
  // CLASS ANALYSIS
  // ===========================================================================

  /** Analyze a class definition — extract methods */
  private analyzeClass(classNode: SyntaxNode): void {
    const className = classNode.childForFieldName('name')?.text || 'UnknownClass';
    const body = classNode.childForFieldName('body')
      || classNode.namedChildren.find((c) =>
        ['class_body', 'declaration_list', 'field_declaration_list'].includes(c.type),
      );

    if (!body) { return; }

    for (const item of body.namedChildren) {
      if (this.isFunctionDef(item)) {
        const func = this.analyzeFunction(item, className);
        this.result.functions.push(func);
      }
    }
  }

  // ===========================================================================
  // FUNCTION ANALYSIS
  // ===========================================================================

  /** Analyze a single function/method definition */
  private analyzeFunction(node: SyntaxNode, className?: string): FunctionAnalysis {
    const funcName = this.getFunctionName(node);
    const name = className ? `${className}.${funcName}` : funcName;
    const func = new FunctionAnalysis(name, node.startPosition.row + 1);

    // Save and extend variable scope
    const savedVars = new Map(this.variableConstants);
    this.extractConstants(node);

    // Detect recursion
    if (this.containsCallTo(node, funcName)) {
      func.isRecursive = true;
    }

    // Analyze function body
    const body = this.getFunctionBody(node);
    if (body) {
      for (const stmt of body.namedChildren) {
        func.operations.merge(this.analyzeNode(stmt, 1));
      }
    }

    // Scale if recursive
    if (func.isRecursive) {
      func.operations = func.operations.scale(DEFAULT_RECURSION_DEPTH);
      this.result.assumptions.push(
        `Function '${name}' is recursive — assumed ${DEFAULT_RECURSION_DEPTH} recursive calls`,
      );
    }

    func.maxNesting = this.getMaxLoopDepth(node);
    this.variableConstants = savedVars;

    return func;
  }

  /** Get the function name from various function definition node types */
  private getFunctionName(node: SyntaxNode): string {
    // Try common field names
    const nameNode = node.childForFieldName('name')
      || node.childForFieldName('declarator');

    if (nameNode) {
      if (nameNode.type === 'identifier' || nameNode.type === 'property_identifier') {
        return nameNode.text;
      }
      // C/C++ function_declarator wraps the name
      if (nameNode.type === 'function_declarator') {
        const inner = nameNode.childForFieldName('declarator');
        if (inner) { return inner.text; }
      }
      return this.getDeclaratorName(nameNode) || 'unknown';
    }

    return 'unknown';
  }

  /** Get the function body block */
  private getFunctionBody(node: SyntaxNode): SyntaxNode | undefined {
    return node.childForFieldName('body')
      || node.namedChildren.find((c) =>
        ['compound_statement', 'statement_block', 'block'].includes(c.type),
      );
  }

  /** Check if a node contains a call to a named function */
  private containsCallTo(node: SyntaxNode, funcName: string): boolean {
    if (this.isCallNode(node)) {
      const callName = this.getCallName(node);
      if (callName === funcName) { return true; }
    }
    for (const child of node.namedChildren) {
      if (this.containsCallTo(child, funcName)) { return true; }
    }
    return false;
  }

  // ===========================================================================
  // NODE ANALYSIS (Statement-level)
  // ===========================================================================

  /**
   * Recursively analyze an AST node and count operations.
   * Loop multipliers cascade for nested loops.
   */
  private analyzeNode(node: SyntaxNode, loopMultiplier: number): OperationCount {
    const ops = new OperationCount();
    if (!node) { return ops; }

    switch (node.type) {
      // --- Variable declarations ---
      case 'variable_declaration':
      case 'lexical_declaration':
      case 'local_variable_declaration':
      case 'declaration': {
        // Each declarator is an assignment
        for (const child of node.namedChildren) {
          if (child.type === 'variable_declarator' || child.type === 'init_declarator') {
            ops.add(OpType.ASSIGNMENT, loopMultiplier);
            const val = child.childForFieldName('value');
            if (val) { ops.merge(this.analyzeExpression(val, loopMultiplier)); }
          }
        }
        break;
      }

      // --- Expression statements ---
      case 'expression_statement': {
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, loopMultiplier));
        }
        break;
      }

      // --- For loops ---
      case 'for_statement': {
        const iterations = this.estimateForIterations(node);
        const innerMultiplier = loopMultiplier * iterations;

        this.result.assumptions.push(
          `Line ${node.startPosition.row + 1}: for-loop estimated ${iterations} iterations`,
        );

        ops.add(OpType.COMPARISON, loopMultiplier * iterations);

        // Analyze initializer
        const init = node.childForFieldName('initializer') || node.childForFieldName('init');
        if (init) { ops.merge(this.analyzeNode(init, loopMultiplier)); }

        // Analyze condition
        const cond = node.childForFieldName('condition');
        if (cond) { ops.merge(this.analyzeExpression(cond, loopMultiplier)); }

        // Analyze update
        const update = node.childForFieldName('update');
        if (update) { ops.merge(this.analyzeExpression(update, loopMultiplier * iterations)); }

        // Analyze body
        const forBody = this.getStatementBody(node);
        if (forBody) {
          for (const stmt of forBody.namedChildren) {
            ops.merge(this.analyzeNode(stmt, innerMultiplier));
          }
        }
        break;
      }

      // --- Enhanced for / for-in / for-of ---
      case 'enhanced_for_statement':
      case 'for_in_statement': {
        const eachIterations = DEFAULT_LOOP_ITERATIONS;
        const eachInner = loopMultiplier * eachIterations;

        this.result.assumptions.push(
          `Line ${node.startPosition.row + 1}: for-each loop assumed ${eachIterations} iterations`,
        );

        ops.add(OpType.COMPARISON, loopMultiplier * eachIterations);

        const eachBody = this.getStatementBody(node);
        if (eachBody) {
          for (const stmt of eachBody.namedChildren) {
            ops.merge(this.analyzeNode(stmt, eachInner));
          }
        }
        break;
      }

      // --- While loops ---
      case 'while_statement': {
        const whileIter = this.estimateWhileIterations(node);
        const whileInner = loopMultiplier * whileIter;

        this.result.assumptions.push(
          `Line ${node.startPosition.row + 1}: while-loop estimated ${whileIter} iterations`,
        );

        ops.add(OpType.COMPARISON, loopMultiplier * whileIter);

        const whileCond = node.childForFieldName('condition');
        if (whileCond) { ops.merge(this.analyzeExpression(whileCond, loopMultiplier)); }

        const whileBody = this.getStatementBody(node);
        if (whileBody) {
          for (const stmt of whileBody.namedChildren) {
            ops.merge(this.analyzeNode(stmt, whileInner));
          }
        }
        break;
      }

      // --- Do-while ---
      case 'do_statement': {
        const doIter = DEFAULT_LOOP_ITERATIONS;
        const doInner = loopMultiplier * doIter;

        this.result.assumptions.push(
          `Line ${node.startPosition.row + 1}: do-while loop assumed ${doIter} iterations`,
        );

        ops.add(OpType.COMPARISON, loopMultiplier * doIter);

        const doBody = this.getStatementBody(node);
        if (doBody) {
          for (const stmt of doBody.namedChildren) {
            ops.merge(this.analyzeNode(stmt, doInner));
          }
        }
        break;
      }

      // --- If statements ---
      case 'if_statement': {
        ops.add(OpType.CONDITIONAL, loopMultiplier);

        const ifCond = node.childForFieldName('condition');
        if (ifCond) { ops.merge(this.analyzeExpression(ifCond, loopMultiplier)); }

        const consequence = node.childForFieldName('consequence') || this.getStatementBody(node);
        if (consequence) {
          if (this.isBlockNode(consequence)) {
            for (const stmt of consequence.namedChildren) {
              ops.merge(this.analyzeNode(stmt, loopMultiplier));
            }
          } else {
            ops.merge(this.analyzeNode(consequence, loopMultiplier));
          }
        }

        const alternative = node.childForFieldName('alternative');
        if (alternative) {
          if (alternative.type === 'else_clause' || alternative.type === 'if_statement') {
            ops.merge(this.analyzeNode(alternative, loopMultiplier));
          } else if (this.isBlockNode(alternative)) {
            for (const stmt of alternative.namedChildren) {
              ops.merge(this.analyzeNode(stmt, loopMultiplier));
            }
          } else {
            ops.merge(this.analyzeNode(alternative, loopMultiplier));
          }
        }
        break;
      }

      // --- Else clause ---
      case 'else_clause': {
        const elseBody = this.getStatementBody(node);
        if (elseBody) {
          if (this.isBlockNode(elseBody)) {
            for (const stmt of elseBody.namedChildren) {
              ops.merge(this.analyzeNode(stmt, loopMultiplier));
            }
          } else {
            ops.merge(this.analyzeNode(elseBody, loopMultiplier));
          }
        } else {
          for (const child of node.namedChildren) {
            ops.merge(this.analyzeNode(child, loopMultiplier));
          }
        }
        break;
      }

      // --- Switch ---
      case 'switch_statement':
      case 'switch_expression': {
        ops.add(OpType.CONDITIONAL, loopMultiplier);
        const switchBody = node.childForFieldName('body') ||
          node.namedChildren.find((c) => c.type === 'switch_body' || c.type === 'switch_block');
        if (switchBody) {
          for (const caseClause of switchBody.namedChildren) {
            for (const stmt of caseClause.namedChildren) {
              ops.merge(this.analyzeNode(stmt, loopMultiplier));
            }
          }
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

      // --- Try/Catch ---
      case 'try_statement':
      case 'try_with_resources_statement': {
        for (const child of node.namedChildren) {
          if (this.isBlockNode(child)) {
            for (const stmt of child.namedChildren) {
              ops.merge(this.analyzeNode(stmt, loopMultiplier));
            }
          } else if (child.type === 'catch_clause' || child.type === 'except_clause') {
            const catchBody = this.getStatementBody(child);
            if (catchBody) {
              for (const stmt of catchBody.namedChildren) {
                ops.merge(this.analyzeNode(stmt, loopMultiplier));
              }
            }
          } else if (child.type === 'finally_clause') {
            const finallyBody = this.getStatementBody(child);
            if (finallyBody) {
              for (const stmt of finallyBody.namedChildren) {
                ops.merge(this.analyzeNode(stmt, loopMultiplier));
              }
            }
          }
        }
        break;
      }

      // --- Throw ---
      case 'throw_statement': {
        ops.add(OpType.FUNCTION_CALL, loopMultiplier);
        break;
      }

      // --- Break/Continue ---
      case 'break_statement':
      case 'continue_statement':
      case 'empty_statement':
        break;

      // --- Delete (C++ delete, JS delete) ---
      case 'delete_expression': {
        ops.add(OpType.MEMORY_ALLOC, loopMultiplier);
        break;
      }

      // --- Function/Class definitions (nested, not executed immediately) ---
      case 'function_definition':
      case 'function_declaration':
      case 'method_declaration':
      case 'class_declaration':
      case 'class_definition':
        break;

      // --- Labeled statement (goto labels, etc.) ---
      case 'labeled_statement': {
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeNode(child, loopMultiplier));
        }
        break;
      }

      // --- Default: walk children ---
      default: {
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeNode(child, loopMultiplier));
        }
        break;
      }
    }

    return ops;
  }

  // ===========================================================================
  // EXPRESSION ANALYSIS
  // ===========================================================================

  /** Analyze an expression node for operations */
  private analyzeExpression(node: SyntaxNode, multiplier: number = 1): OperationCount {
    const ops = new OperationCount();
    if (!node) { return ops; }

    switch (node.type) {
      // --- Binary expressions ---
      case 'binary_expression': {
        const operator = this.getOperatorText(node);
        // Categorize operator
        if (['+'].includes(operator)) {
          ops.add(OpType.ADDITION, multiplier);
        } else if (['-'].includes(operator)) {
          ops.add(OpType.SUBTRACTION, multiplier);
        } else if (['*'].includes(operator)) {
          ops.add(OpType.MULTIPLICATION, multiplier);
        } else if (['/', '%'].includes(operator)) {
          ops.add(OpType.DIVISION, multiplier);
        } else if (['<', '>', '<=', '>=', '==', '!=', '===', '!==', 'instanceof'].includes(operator)) {
          ops.add(OpType.COMPARISON, multiplier);
        } else if (['&&', '||', 'and', 'or'].includes(operator)) {
          ops.add(OpType.COMPARISON, multiplier);
        } else {
          // Bitwise ops ~ addition cost
          ops.add(OpType.ADDITION, multiplier);
        }
        const binLeft = node.childForFieldName('left');
        const binRight = node.childForFieldName('right');
        if (binLeft) { ops.merge(this.analyzeExpression(binLeft, multiplier)); }
        if (binRight) { ops.merge(this.analyzeExpression(binRight, multiplier)); }
        break;
      }

      // --- Unary expressions ---
      case 'unary_expression': {
        ops.add(OpType.ADDITION, multiplier);
        const unaryArg = node.childForFieldName('argument') || node.namedChildren[0];
        if (unaryArg) { ops.merge(this.analyzeExpression(unaryArg, multiplier)); }
        break;
      }

      // --- Update expressions (i++, --j) ---
      case 'update_expression': {
        const updateOp = this.getUpdateOp(node);
        if (updateOp === '++') {
          ops.add(OpType.ADDITION, multiplier);
        } else if (updateOp === '--') {
          ops.add(OpType.SUBTRACTION, multiplier);
        }
        ops.add(OpType.ASSIGNMENT, multiplier);
        break;
      }

      // --- Assignment expressions ---
      case 'assignment_expression': {
        ops.add(OpType.ASSIGNMENT, multiplier);
        const assignRight = node.childForFieldName('right');
        if (assignRight) { ops.merge(this.analyzeExpression(assignRight, multiplier)); }
        break;
      }

      // --- Augmented assignment (+=, -=, etc.) ---
      case 'augmented_assignment_expression': {
        ops.add(OpType.ASSIGNMENT, multiplier);
        const augOp = this.getOperatorText(node);
        switch (augOp) {
          case '+=': ops.add(OpType.ADDITION, multiplier); break;
          case '-=': ops.add(OpType.SUBTRACTION, multiplier); break;
          case '*=': ops.add(OpType.MULTIPLICATION, multiplier); break;
          case '/=': case '%=': ops.add(OpType.DIVISION, multiplier); break;
        }
        const augRight = node.childForFieldName('right');
        if (augRight) { ops.merge(this.analyzeExpression(augRight, multiplier)); }
        break;
      }

      // --- Function/Method calls ---
      case 'call_expression':
      case 'method_invocation': {
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
          } else {
            ops.add(OpType.FUNCTION_CALL, multiplier);
          }
        } else {
          ops.add(OpType.FUNCTION_CALL, multiplier);
        }

        // Analyze arguments
        const argsNode = node.childForFieldName('arguments')
          || node.namedChildren.find((c) =>
            ['arguments', 'argument_list'].includes(c.type),
          );
        if (argsNode) {
          for (const arg of argsNode.namedChildren) {
            ops.merge(this.analyzeExpression(arg, multiplier));
          }
        }
        break;
      }

      // --- Object creation (new) ---
      case 'new_expression':
      case 'object_creation_expression': {
        ops.add(OpType.MEMORY_ALLOC, multiplier);
        // Analyze constructor arguments
        const newArgs = node.namedChildren.find((c) =>
          ['arguments', 'argument_list'].includes(c.type),
        );
        if (newArgs) {
          for (const arg of newArgs.namedChildren) {
            ops.merge(this.analyzeExpression(arg, multiplier));
          }
        }
        break;
      }

      // --- Array/member access ---
      case 'subscript_expression':
      case 'array_access': {
        ops.add(OpType.ARRAY_ACCESS, multiplier);
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, multiplier));
        }
        break;
      }

      case 'member_expression':
      case 'field_access':
      case 'field_expression': {
        const obj = node.childForFieldName('object') || node.namedChildren[0];
        if (obj) { ops.merge(this.analyzeExpression(obj, multiplier)); }
        break;
      }

      // --- Ternary expression ---
      case 'ternary_expression':
      case 'conditional_expression': {
        ops.add(OpType.CONDITIONAL, multiplier);
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, multiplier));
        }
        break;
      }

      // --- Array/Object literals ---
      case 'array':
      case 'array_initializer': {
        if (node.namedChildCount > 0) {
          ops.add(OpType.MEMORY_ALLOC, multiplier);
          ops.add(OpType.ASSIGNMENT, multiplier * node.namedChildCount);
        }
        for (const elt of node.namedChildren) {
          ops.merge(this.analyzeExpression(elt, multiplier));
        }
        break;
      }

      case 'object': {
        const props = node.namedChildren.filter((c) =>
          ['pair', 'property', 'shorthand_property_identifier_pattern',
            'spread_element', 'method_definition'].includes(c.type),
        );
        if (props.length > 0) {
          ops.add(OpType.MEMORY_ALLOC, multiplier);
          ops.add(OpType.ASSIGNMENT, multiplier * props.length);
        }
        for (const prop of props) {
          const val = prop.childForFieldName('value') || prop.namedChildren[prop.namedChildCount - 1];
          if (val) { ops.merge(this.analyzeExpression(val, multiplier)); }
        }
        break;
      }

      // --- Template strings ---
      case 'template_string': {
        for (const child of node.namedChildren) {
          if (child.type === 'template_substitution') {
            const expr = child.namedChildren[0];
            if (expr) {
              ops.merge(this.analyzeExpression(expr, multiplier));
              ops.add(OpType.FUNCTION_CALL, multiplier); // formatting cost
            }
          }
        }
        break;
      }

      // --- Spread element ---
      case 'spread_element': {
        const spreadArg = node.namedChildren[0];
        if (spreadArg) { ops.merge(this.analyzeExpression(spreadArg, multiplier)); }
        break;
      }

      // --- Comma expression ---
      case 'comma_expression':
      case 'sequence_expression': {
        for (const child of node.namedChildren) {
          ops.merge(this.analyzeExpression(child, multiplier));
        }
        break;
      }

      // --- Parenthesized ---
      case 'parenthesized_expression': {
        const inner = node.namedChildren[0];
        if (inner) { ops.merge(this.analyzeExpression(inner, multiplier)); }
        break;
      }

      // --- Cast expression (Java, C/C++) ---
      case 'cast_expression': {
        ops.add(OpType.FUNCTION_CALL, multiplier);
        const castVal = node.childForFieldName('value') || node.namedChildren[node.namedChildCount - 1];
        if (castVal) { ops.merge(this.analyzeExpression(castVal, multiplier)); }
        break;
      }

      // --- Sizeof (C/C++) ---
      case 'sizeof_expression': {
        ops.add(OpType.FUNCTION_CALL, multiplier);
        break;
      }

      // --- Arrow function (inline) ---
      case 'arrow_function': {
        ops.add(OpType.FUNCTION_CALL, multiplier);
        const arrowBody = node.childForFieldName('body');
        if (arrowBody) {
          if (this.isBlockNode(arrowBody)) {
            for (const stmt of arrowBody.namedChildren) {
              ops.merge(this.analyzeNode(stmt, multiplier));
            }
          } else {
            ops.merge(this.analyzeExpression(arrowBody, multiplier));
          }
        }
        break;
      }

      // --- Literals — no operations ---
      case 'number':
      case 'number_literal':
      case 'decimal_integer_literal':
      case 'integer_literal':
      case 'float_literal':
      case 'decimal_floating_point_literal':
      case 'hex_integer_literal':
      case 'octal_integer_literal':
      case 'binary_integer_literal':
      case 'string':
      case 'string_literal':
      case 'character_literal':
      case 'true':
      case 'false':
      case 'null':
      case 'null_literal':
      case 'undefined':
      case 'this':
      case 'super':
      case 'identifier':
      case 'property_identifier':
      case 'shorthand_property_identifier':
      case 'type_identifier':
      case 'comment':
      case 'line_comment':
      case 'block_comment':
        break;

      // --- Default: recurse ---
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
   * Estimate iterations for a C-family for loop.
   * Parses: for(int i = 0; i < 100; i++)
   */
  private estimateForIterations(forNode: SyntaxNode): number {
    const condition = forNode.childForFieldName('condition');
    if (!condition) { return DEFAULT_LOOP_ITERATIONS; }

    // Try to extract: var < N or var <= N
    if (condition.type === 'binary_expression') {
      const left = condition.childForFieldName('left');
      const right = condition.childForFieldName('right');
      const op = this.getOperatorText(condition);

      if (left && right) {
        // Get start value from initializer
        const init = forNode.childForFieldName('initializer') || forNode.childForFieldName('init');
        let startVal = 0;
        if (init) {
          startVal = this.extractInitValue(init) ?? 0;
        }

        const endVal = this.resolveConstantExpr(right);
        if (endVal !== undefined) {
          // Get step from update
          const stepVal = this.extractStep(forNode) ?? 1;

          switch (op) {
            case '<': return Math.max(0, Math.ceil((endVal - startVal) / stepVal));
            case '<=': return Math.max(0, Math.ceil((endVal - startVal + 1) / stepVal));
            case '>': return Math.max(0, Math.ceil((startVal - endVal) / stepVal));
            case '>=': return Math.max(0, Math.ceil((startVal - endVal + 1) / stepVal));
          }
        }

        // Try resolving left as end value (for patterns like: 0 < i with reverse iteration)
        const leftVal = this.resolveConstantExpr(left);
        if (leftVal !== undefined && right.type === 'identifier') {
          const rightVar = this.variableConstants.get(right.text);
          if (rightVar !== undefined) {
            switch (op) {
              case '<': return Math.max(0, rightVar - leftVal);
              case '<=': return Math.max(0, rightVar - leftVal + 1);
            }
          }
        }
      }
    }

    return DEFAULT_LOOP_ITERATIONS;
  }

  /** Extract initial value from a for-loop initializer */
  private extractInitValue(init: SyntaxNode): number | undefined {
    // Walk declarators looking for a value
    for (const child of init.namedChildren) {
      const val = child.childForFieldName('value');
      if (val) { return this.resolveConstantExpr(val); }
    }
    // assignment_expression
    if (init.type === 'assignment_expression') {
      const right = init.childForFieldName('right');
      return right ? this.resolveConstantExpr(right) : undefined;
    }
    return undefined;
  }

  /** Extract step value from a for-loop update expression */
  private extractStep(forNode: SyntaxNode): number | undefined {
    const update = forNode.childForFieldName('update');
    if (!update) { return 1; }

    // i++ or ++i -> step 1
    if (update.type === 'update_expression') { return 1; }

    // i += N -> step N
    if (update.type === 'augmented_assignment_expression') {
      const right = update.childForFieldName('right');
      return right ? this.resolveConstantExpr(right) ?? 1 : 1;
    }

    // Check children for update_expression or augmented_assignment
    for (const child of update.namedChildren) {
      if (child.type === 'update_expression') { return 1; }
      if (child.type === 'augmented_assignment_expression') {
        const right = child.childForFieldName('right');
        return right ? this.resolveConstantExpr(right) ?? 1 : 1;
      }
    }

    return 1;
  }

  /**
   * Estimate while loop iterations.
   */
  private estimateWhileIterations(whileNode: SyntaxNode): number {
    const condition = whileNode.childForFieldName('condition');
    if (!condition) { return DEFAULT_LOOP_ITERATIONS; }

    // Unwrap parenthesized condition
    let cond = condition;
    if (cond.type === 'parenthesized_expression' && cond.namedChildCount === 1) {
      cond = cond.namedChildren[0];
    }

    if (cond.type === 'binary_expression') {
      const left = cond.childForFieldName('left');
      const right = cond.childForFieldName('right');
      const op = this.getOperatorText(cond);

      if (left && right) {
        const rightVal = this.resolveConstantExpr(right);

        if (left.type === 'identifier' && rightVal !== undefined) {
          const varName = left.text;

          if (op === '<' || op === '<=') {
            const startVal = this.variableConstants.get(varName);
            if (startVal !== undefined) {
              return Math.max(1, Math.abs(rightVal - startVal));
            }
            return rightVal > 0 ? rightVal : DEFAULT_LOOP_ITERATIONS;
          }

          if (op === '>' || op === '>=') {
            const startVal = this.variableConstants.get(varName);
            if (startVal !== undefined) {
              return Math.max(1, startVal - rightVal);
            }
          }

          // Binary search pattern
          if (op === '<=') {
            return 20; // ~log2(1_000_000)
          }
        }
      }
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
      if (['for_statement', 'while_statement', 'do_statement',
        'enhanced_for_statement', 'for_in_statement'].includes(child.type)) {
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

  /** Check if a node is a call */
  private isCallNode(node: SyntaxNode): boolean {
    return ['call_expression', 'method_invocation'].includes(node.type);
  }

  /** Get the simple function/method name from a call node */
  private getCallName(node: SyntaxNode): string | undefined {
    const funcNode = node.childForFieldName('function')
      || node.childForFieldName('name');

    if (!funcNode) { return undefined; }

    if (funcNode.type === 'identifier' || funcNode.type === 'property_identifier') {
      return funcNode.text;
    }
    if (funcNode.type === 'member_expression' || funcNode.type === 'field_access') {
      const prop = funcNode.childForFieldName('property')
        || funcNode.childForFieldName('field');
      return prop?.text;
    }
    return undefined;
  }

  /** Get the full dotted call name */
  private getFullCallName(node: SyntaxNode): string | undefined {
    const funcNode = node.childForFieldName('function')
      || node.childForFieldName('name');
    if (!funcNode) { return undefined; }

    const parts: string[] = [];
    let current: SyntaxNode | null = funcNode;

    while (current) {
      if (current.type === 'member_expression' || current.type === 'field_access') {
        const prop = current.childForFieldName('property')
          || current.childForFieldName('field');
        if (prop) { parts.unshift(prop.text); }
        current = current.childForFieldName('object') || null;
      } else if (current.type === 'identifier' || current.type === 'property_identifier') {
        parts.unshift(current.text);
        break;
      } else {
        break;
      }
    }

    return parts.length > 0 ? parts.join('.') : undefined;
  }

  /** Get operator text from a binary/augmented expression */
  private getOperatorText(node: SyntaxNode): string {
    const opNode = node.childForFieldName('operator');
    if (opNode) { return opNode.type || opNode.text; }

    // Fallback: find operator among non-named children
    for (const child of node.children) {
      if (!child.isNamed) {
        const t = child.type;
        if (['+', '-', '*', '/', '%', '**',
          '<', '>', '<=', '>=', '==', '!=', '===', '!==',
          '&&', '||', '&', '|', '^', '<<', '>>', '>>>',
          '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=',
          'instanceof', 'in',
        ].includes(t)) {
          return t;
        }
      }
    }
    return '';
  }

  /** Get the update operator (++ or --) */
  private getUpdateOp(node: SyntaxNode): string {
    for (const child of node.children) {
      if (!child.isNamed && (child.type === '++' || child.type === '--')) {
        return child.type;
      }
    }
    return '++';
  }

  /** Get the unary operator */
  private getUnaryOp(node: SyntaxNode): string {
    for (const child of node.children) {
      if (!child.isNamed && ['-', '+', '!', '~', 'typeof', 'void', 'delete'].includes(child.type)) {
        return child.type;
      }
    }
    return '';
  }

  /** Check if a node is a block/compound statement */
  private isBlockNode(node: SyntaxNode): boolean {
    return ['compound_statement', 'statement_block', 'block',
      'class_body', 'switch_body', 'switch_block'].includes(node.type);
  }

  /** Get the body of a statement (handles different grammar variations) */
  private getStatementBody(node: SyntaxNode): SyntaxNode | undefined {
    return node.childForFieldName('body')
      || node.namedChildren.find((c) => this.isBlockNode(c));
  }

  /** Parse a numeric literal string to a number */
  private parseNumericLiteral(text: string): number | undefined {
    const cleaned = text.replace(/_/g, '').replace(/[lLfFdD]$/, '');
    const val = Number(cleaned);
    return isNaN(val) ? undefined : Math.floor(val);
  }
}
