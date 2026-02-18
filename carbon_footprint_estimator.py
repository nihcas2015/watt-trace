#!/usr/bin/env python3
"""
Carbon Footprint Estimator for Source Code
===========================================
Estimates the carbon footprint of source code based on static analysis
and operation counting — no hardware measurements required.

Supported languages: Python, Java, C, C++, JavaScript
Extensible architecture for adding more languages.

Usage:
  python carbon_footprint_estimator.py                  # interactive text input
  python carbon_footprint_estimator.py --file mycode.py # analyze a file
  python carbon_footprint_estimator.py --language java   # specify language

Output is always saved to carbon_footprint_result.json

Author: WattTrace
Date: 2026-02-18
"""

import ast
import re
import sys
import os
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from enum import Enum


# =============================================================================
# CONSTANTS & CONFIGURATION
# =============================================================================

class OpType(Enum):
    """Types of computational operations with associated energy weights."""
    ADDITION        = "addition"
    SUBTRACTION     = "subtraction"
    MULTIPLICATION  = "multiplication"
    DIVISION        = "division"
    ASSIGNMENT      = "assignment"
    COMPARISON      = "comparison"
    ARRAY_ACCESS    = "array_access"
    FUNCTION_CALL   = "function_call"
    MEMORY_ALLOC    = "memory_allocation"
    CONDITIONAL     = "conditional_branch"
    IO_OPERATION    = "io_operation"
    NETWORK_OP      = "network_operation"


# Approximate energy weights per operation type (relative cost units)
OPERATION_WEIGHTS: Dict[OpType, int] = {
    OpType.ADDITION:       1,
    OpType.SUBTRACTION:    1,
    OpType.MULTIPLICATION: 2,
    OpType.DIVISION:       3,
    OpType.ASSIGNMENT:     1,
    OpType.COMPARISON:     1,
    OpType.ARRAY_ACCESS:   2,
    OpType.FUNCTION_CALL:  5,
    OpType.MEMORY_ALLOC:   10,
    OpType.CONDITIONAL:    1,
    OpType.IO_OPERATION:   50,
    OpType.NETWORK_OP:     100,
}

# Energy model constants
ENERGY_PER_OPERATION_JOULES = 3e-9          # Joules per operation
JOULES_PER_KWH              = 3_600_000     # Joules in 1 kWh
CARBON_INTENSITY_G_PER_KWH  = 475           # Global average gCO2/kWh

# Default heuristic loop iteration counts when static analysis can't determine
DEFAULT_LOOP_ITERATIONS      = 100
DEFAULT_RECURSION_DEPTH       = 10

# Output JSON file path
OUTPUT_JSON_PATH = "carbon_footprint_result.json"


# =============================================================================
# DATA MODELS
# =============================================================================

@dataclass
class OperationCount:
    """Tracks counts of each operation type."""
    counts: Dict[OpType, int] = field(default_factory=lambda: {op: 0 for op in OpType})

    def add(self, op_type: OpType, count: int = 1):
        self.counts[op_type] = self.counts.get(op_type, 0) + count

    def merge(self, other: "OperationCount"):
        for op_type, count in other.counts.items():
            self.counts[op_type] = self.counts.get(op_type, 0) + count

    def scale(self, factor: int) -> "OperationCount":
        """Return a new OperationCount scaled by factor (for loops)."""
        scaled = OperationCount()
        for op_type, count in self.counts.items():
            scaled.counts[op_type] = count * factor
        return scaled

    @property
    def total_weighted(self) -> int:
        return sum(count * OPERATION_WEIGHTS[op] for op, count in self.counts.items())

    @property
    def total_raw(self) -> int:
        return sum(self.counts.values())

    def summary_dict(self) -> Dict[str, int]:
        return {op.value: count for op, count in self.counts.items() if count > 0}


@dataclass
class FunctionAnalysis:
    """Analysis result for a single function/method."""
    name: str
    line_number: int
    operations: OperationCount = field(default_factory=OperationCount)
    loop_depth: int = 0
    max_nesting: int = 0
    is_recursive: bool = False
    calls: List[str] = field(default_factory=list)

    @property
    def weighted_ops(self) -> int:
        return self.operations.total_weighted

    @property
    def energy_joules(self) -> float:
        return self.weighted_ops * ENERGY_PER_OPERATION_JOULES

    @property
    def energy_kwh(self) -> float:
        return self.energy_joules / JOULES_PER_KWH

    @property
    def carbon_grams(self) -> float:
        return self.energy_kwh * CARBON_INTENSITY_G_PER_KWH


@dataclass
class AnalysisResult:
    """Complete analysis result for a source file."""
    language: str
    file_path: Optional[str]
    functions: List[FunctionAnalysis] = field(default_factory=list)
    global_operations: OperationCount = field(default_factory=OperationCount)
    assumptions: List[str] = field(default_factory=list)

    @property
    def total_operations(self) -> OperationCount:
        total = OperationCount()
        total.merge(self.global_operations)
        for func in self.functions:
            total.merge(func.operations)
        return total

    @property
    def total_weighted_ops(self) -> int:
        return self.total_operations.total_weighted

    @property
    def energy_joules(self) -> float:
        return self.total_weighted_ops * ENERGY_PER_OPERATION_JOULES

    @property
    def energy_kwh(self) -> float:
        return self.energy_joules / JOULES_PER_KWH

    @property
    def carbon_grams(self) -> float:
        return self.energy_kwh * CARBON_INTENSITY_G_PER_KWH

    @property
    def hotspots(self) -> List[FunctionAnalysis]:
        """Top 5 functions by weighted operations."""
        return sorted(self.functions, key=lambda f: f.weighted_ops, reverse=True)[:5]

    def to_dict(self) -> dict:
        return {
            "language": self.language,
            "file_path": self.file_path,
            "total_operations": self.total_operations.summary_dict(),
            "total_weighted_operations": self.total_weighted_ops,
            "energy_joules": self.energy_joules,
            "energy_kWh": self.energy_kwh,
            "carbon_grams_CO2": self.carbon_grams,
            "functions": [
                {
                    "name": f.name,
                    "line": f.line_number,
                    "weighted_ops": f.weighted_ops,
                    "energy_joules": f.energy_joules,
                    "carbon_grams_CO2": f.carbon_grams,
                    "is_recursive": f.is_recursive,
                    "max_loop_nesting": f.max_nesting,
                    "operations": f.operations.summary_dict(),
                }
                for f in self.functions
            ],
            "hotspot_functions": [
                {
                    "name": f.name,
                    "weighted_ops": f.weighted_ops,
                    "percentage": round(
                        (f.weighted_ops / self.total_weighted_ops * 100)
                        if self.total_weighted_ops > 0 else 0, 2
                    ),
                }
                for f in self.hotspots
            ],
            "assumptions": self.assumptions,
        }


# =============================================================================
# LANGUAGE DETECTION
# =============================================================================

def detect_language(file_path: Optional[str] = None, code: Optional[str] = None) -> str:
    """
    Detect programming language from file extension or code heuristics.
    Returns one of: 'python', 'java', 'c', 'cpp', 'javascript'
    """
    if file_path:
        ext = os.path.splitext(file_path)[1].lower()
        ext_map = {
            ".py": "python",
            ".java": "java",
            ".c": "c",
            ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp",
            ".js": "javascript", ".mjs": "javascript",
            ".ts": "javascript",  # TypeScript parsed similarly
        }
        if ext in ext_map:
            return ext_map[ext]

    if code:
        # Heuristic detection based on keywords / patterns
        if re.search(r'\bdef\s+\w+\s*\(', code) and re.search(r':\s*$', code, re.M):
            return "python"
        if re.search(r'\bpublic\s+(static\s+)?class\b', code):
            return "java"
        if re.search(r'#include\s*<', code) and re.search(r'\bprintf\b', code):
            return "c"
        if re.search(r'#include\s*<', code) and re.search(r'\bcout\b|\bstd::', code):
            return "cpp"
        if re.search(r'\bfunction\b|\bconst\b.*=>|\bconsole\.log\b', code):
            return "javascript"

    return "python"  # default fallback


# =============================================================================
# ABSTRACT BASE ANALYZER
# =============================================================================

class LanguageAnalyzer(ABC):
    """Base class for language-specific code analyzers."""

    def __init__(self):
        self.result: Optional[AnalysisResult] = None

    @abstractmethod
    def analyze(self, code: str, file_path: Optional[str] = None) -> AnalysisResult:
        """Parse and analyze the given source code."""
        pass


# =============================================================================
# PYTHON ANALYZER (AST-based, most accurate)
# =============================================================================

class PythonAnalyzer(LanguageAnalyzer):
    """
    Analyzes Python source code using the built-in `ast` module.
    This provides the most accurate analysis since we get a real AST.

    KEY DESIGN: Every statement inside a loop body is individually analyzed
    with the loop's iteration multiplier. So if a for-loop with 100 iterations
    contains 10 print() calls, that counts as 100 * 10 = 1000 IO operations.
    Nested loops multiply: for i in range(50): for j in range(20): print()
    = 50 * 20 * 1 = 1000 IO operations.
    """

    # Python I/O functions
    IO_FUNCTIONS = {
        "print", "input", "open", "read", "write", "readline", "readlines",
        "writelines", "close", "flush", "seek", "tell",
    }

    # Python network-related modules/functions
    NETWORK_FUNCTIONS = {
        "request", "get", "post", "put", "delete", "patch",
        "urlopen", "connect", "send", "recv", "socket",
        "fetch", "download", "upload",
    }

    # Memory allocation indicators
    ALLOC_FUNCTIONS = {
        "list", "dict", "set", "tuple", "bytearray", "array",
        "zeros", "ones", "empty", "malloc", "calloc",
        "DataFrame", "Series", "ndarray", "deepcopy", "copy",
    }

    def analyze(self, code: str, file_path: Optional[str] = None) -> AnalysisResult:
        tree = ast.parse(code)
        self.result = AnalysisResult(language="python", file_path=file_path)

        # Build a scope-level variable table for resolving loop bounds
        # This maps variable names to constant integer values found in assignments
        self._variable_constants: Dict[str, int] = {}
        self._extract_constant_assignments(tree)

        self.result.assumptions.append(
            f"Energy per operation: {ENERGY_PER_OPERATION_JOULES} J"
        )
        self.result.assumptions.append(
            f"Carbon intensity: {CARBON_INTENSITY_G_PER_KWH} gCO2/kWh (global average)"
        )

        # Collect all function names for recursion detection
        self._all_function_names = {
            node.name for node in ast.walk(tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }

        # Analyze top-level statements (global scope)
        for node in ast.iter_child_nodes(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                func_analysis = self._analyze_function(node)
                self.result.functions.append(func_analysis)
            elif isinstance(node, ast.ClassDef):
                for item in ast.iter_child_nodes(node):
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        func_analysis = self._analyze_function(item, class_name=node.name)
                        self.result.functions.append(func_analysis)
            else:
                ops = self._analyze_node(node, loop_multiplier=1)
                self.result.global_operations.merge(ops)

        return self.result

    def _extract_constant_assignments(self, tree: ast.AST):
        """
        Walk the entire AST once and record variable = constant_int assignments.
        e.g. `n = 100` or `size = 50` — so we can resolve `range(n)` later.
        Also handles `n = len(arr)` as a heuristic (DEFAULT_LOOP_ITERATIONS).
        """
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target = node.targets[0]
                if isinstance(target, ast.Name):
                    val = self._resolve_constant_expr(node.value)
                    if val is not None:
                        self._variable_constants[target.id] = val
            elif isinstance(node, ast.AugAssign):
                pass  # Ignore augmented assignments for constant tracking

    def _resolve_constant_expr(self, node: ast.expr) -> Optional[int]:
        """
        Try to resolve an expression node to a constant integer.
        Handles: literal ints, simple arithmetic on literals, len() calls (heuristic).
        """
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return int(node.value)
        if isinstance(node, ast.Name) and node.id in self._variable_constants:
            return self._variable_constants[node.id]
        if isinstance(node, ast.BinOp):
            left = self._resolve_constant_expr(node.left)
            right = self._resolve_constant_expr(node.right)
            if left is not None and right is not None:
                if isinstance(node.op, ast.Add): return left + right
                if isinstance(node.op, ast.Sub): return left - right
                if isinstance(node.op, ast.Mult): return left * right
                if isinstance(node.op, ast.FloorDiv) and right != 0: return left // right
                if isinstance(node.op, ast.Mod) and right != 0: return left % right
        # len(something) — we can't know the size, use heuristic
        if isinstance(node, ast.Call):
            call_name = self._get_call_name(node)
            if call_name == "len":
                return DEFAULT_LOOP_ITERATIONS  # heuristic
        return None

    def _analyze_function(self, node: ast.FunctionDef, class_name: str = None) -> FunctionAnalysis:
        name = f"{class_name}.{node.name}" if class_name else node.name
        func = FunctionAnalysis(name=name, line_number=node.lineno)

        # Scan for local variable assignments within this function for loop bound resolution
        saved_vars = dict(self._variable_constants)
        self._extract_constant_assignments(node)

        # Detect recursion: does the function call itself?
        for child in ast.walk(node):
            if isinstance(child, ast.Call):
                call_name = self._get_call_name(child)
                if call_name:
                    func.calls.append(call_name)
                    if call_name == node.name:
                        func.is_recursive = True

        # Analyze every statement in the function body individually.
        # Each statement gets its own operation count, properly multiplied
        # by any enclosing loop iterations.
        for stmt in node.body:
            ops = self._analyze_node(stmt, loop_multiplier=1)
            func.operations.merge(ops)

        # If recursive, scale by estimated recursion depth
        if func.is_recursive:
            func.operations = func.operations.scale(DEFAULT_RECURSION_DEPTH)
            self.result.assumptions.append(
                f"Function '{name}' is recursive — assumed {DEFAULT_RECURSION_DEPTH} recursive calls"
            )

        # Track max loop nesting
        func.max_nesting = self._get_max_loop_depth(node)

        # Restore variable scope
        self._variable_constants = saved_vars

        return func

    def _analyze_node(self, node: ast.AST, loop_multiplier: int = 1) -> OperationCount:
        """
        Recursively analyze an AST node and count operations.

        CRITICAL: loop_multiplier is passed down into every child statement
        inside a loop body. This means if a loop runs N times and contains
        5 print statements + 3 additions, we count N*5 IO ops + N*3 additions.
        For nested loops, multipliers cascade: outer_N * inner_M * ops_in_body.
        """
        ops = OperationCount()

        if node is None:
            return ops

        # --- Assignments ---
        if isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            ops.add(OpType.ASSIGNMENT, loop_multiplier)
            if hasattr(node, 'value') and node.value:
                ops.merge(self._analyze_expression(node.value, loop_multiplier))
            # For AugAssign (+=, -=, etc.) also count the arithmetic op
            if isinstance(node, ast.AugAssign):
                if isinstance(node.op, ast.Add):
                    ops.add(OpType.ADDITION, loop_multiplier)
                elif isinstance(node.op, ast.Sub):
                    ops.add(OpType.SUBTRACTION, loop_multiplier)
                elif isinstance(node.op, (ast.Mult, ast.MatMult)):
                    ops.add(OpType.MULTIPLICATION, loop_multiplier)
                elif isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
                    ops.add(OpType.DIVISION, loop_multiplier)

        # --- For loops ---
        elif isinstance(node, ast.For):
            iterations = self._estimate_for_iterations(node)
            inner_multiplier = loop_multiplier * iterations

            if iterations != DEFAULT_LOOP_ITERATIONS:
                self.result.assumptions.append(
                    f"Line {node.lineno}: for-loop resolved to {iterations} iterations"
                )
            else:
                self.result.assumptions.append(
                    f"Line {node.lineno}: for-loop iterations unknown, assumed {DEFAULT_LOOP_ITERATIONS}"
                )

            # The loop condition is checked once per iteration
            ops.add(OpType.COMPARISON, loop_multiplier * iterations)

            # EACH statement in the loop body is analyzed with inner_multiplier
            # so 10 print() calls inside a range(50) loop = 500 IO ops
            for stmt in node.body:
                ops.merge(self._analyze_node(stmt, inner_multiplier))
            for stmt in node.orelse:
                ops.merge(self._analyze_node(stmt, loop_multiplier))

        # --- While loops ---
        elif isinstance(node, ast.While):
            iterations = self._estimate_while_iterations(node)
            inner_multiplier = loop_multiplier * iterations

            self.result.assumptions.append(
                f"Line {node.lineno}: while-loop estimated {iterations} iterations"
            )

            ops.add(OpType.COMPARISON, loop_multiplier * iterations)
            ops.merge(self._analyze_expression(node.test, loop_multiplier))

            # Each body statement gets the full multiplier
            for stmt in node.body:
                ops.merge(self._analyze_node(stmt, inner_multiplier))
            for stmt in node.orelse:
                ops.merge(self._analyze_node(stmt, loop_multiplier))

        # --- Conditionals ---
        elif isinstance(node, ast.If):
            ops.add(OpType.CONDITIONAL, loop_multiplier)
            ops.merge(self._analyze_expression(node.test, loop_multiplier))
            for stmt in node.body:
                ops.merge(self._analyze_node(stmt, loop_multiplier))
            for stmt in node.orelse:
                ops.merge(self._analyze_node(stmt, loop_multiplier))

        # --- Expression statements (function calls, etc.) ---
        elif isinstance(node, ast.Expr):
            ops.merge(self._analyze_expression(node.value, loop_multiplier))

        # --- Return ---
        elif isinstance(node, ast.Return):
            if node.value:
                ops.merge(self._analyze_expression(node.value, loop_multiplier))

        # --- Try/Except ---
        elif isinstance(node, ast.Try):
            for stmt in node.body:
                ops.merge(self._analyze_node(stmt, loop_multiplier))
            for handler in node.handlers:
                for stmt in handler.body:
                    ops.merge(self._analyze_node(stmt, loop_multiplier))
            for stmt in node.finalbody:
                ops.merge(self._analyze_node(stmt, loop_multiplier))

        # --- With ---
        elif isinstance(node, ast.With):
            # with statements often involve I/O (file open)
            for item in node.items:
                ops.merge(self._analyze_expression(item.context_expr, loop_multiplier))
            for stmt in node.body:
                ops.merge(self._analyze_node(stmt, loop_multiplier))

        # --- Delete ---
        elif isinstance(node, ast.Delete):
            ops.add(OpType.MEMORY_ALLOC, loop_multiplier)  # deallocation cost

        # --- Global/Nonlocal/Pass/Break/Continue — negligible cost ---
        elif isinstance(node, (ast.Global, ast.Nonlocal, ast.Pass, ast.Break, ast.Continue)):
            pass

        # --- Raise ---
        elif isinstance(node, ast.Raise):
            ops.add(OpType.FUNCTION_CALL, loop_multiplier)  # exception overhead

        # Fallback: walk children for any other compound statement
        else:
            for child in ast.iter_child_nodes(node):
                if isinstance(child, ast.stmt):
                    ops.merge(self._analyze_node(child, loop_multiplier))

        return ops

    def _analyze_expression(self, node: ast.expr, multiplier: int = 1) -> OperationCount:
        """Analyze an expression node for operations."""
        ops = OperationCount()

        if node is None:
            return ops

        # --- Binary operations ---
        if isinstance(node, ast.BinOp):
            if isinstance(node.op, ast.Add):
                ops.add(OpType.ADDITION, multiplier)
            elif isinstance(node.op, ast.Sub):
                ops.add(OpType.SUBTRACTION, multiplier)
            elif isinstance(node.op, (ast.Mult, ast.MatMult)):
                ops.add(OpType.MULTIPLICATION, multiplier)
            elif isinstance(node.op, (ast.Div, ast.FloorDiv, ast.Mod)):
                ops.add(OpType.DIVISION, multiplier)
            elif isinstance(node.op, ast.Pow):
                # Exponentiation is expensive — roughly equivalent to multiple multiplications
                ops.add(OpType.MULTIPLICATION, multiplier * 10)
            else:
                ops.add(OpType.ADDITION, multiplier)  # bitwise ops ~ addition cost
            ops.merge(self._analyze_expression(node.left, multiplier))
            ops.merge(self._analyze_expression(node.right, multiplier))

        # --- Comparisons ---
        elif isinstance(node, ast.Compare):
            ops.add(OpType.COMPARISON, multiplier * len(node.ops))
            ops.merge(self._analyze_expression(node.left, multiplier))
            for comp in node.comparators:
                ops.merge(self._analyze_expression(comp, multiplier))

        # --- Boolean operations ---
        elif isinstance(node, ast.BoolOp):
            ops.add(OpType.COMPARISON, multiplier * (len(node.values) - 1))
            for val in node.values:
                ops.merge(self._analyze_expression(val, multiplier))

        # --- Function calls ---
        elif isinstance(node, ast.Call):
            call_name = self._get_call_name(node)
            full_call = self._get_full_call_name(node)
            if call_name:
                if call_name in self.IO_FUNCTIONS or (full_call and any(
                    io in full_call for io in ["print", "write", "read", "input", "open"]
                )):
                    ops.add(OpType.IO_OPERATION, multiplier)
                elif call_name in self.NETWORK_FUNCTIONS or (full_call and any(
                    net in full_call for net in ["request", "urlopen", "socket", "fetch"]
                )):
                    ops.add(OpType.NETWORK_OP, multiplier)
                elif call_name in self.ALLOC_FUNCTIONS:
                    ops.add(OpType.MEMORY_ALLOC, multiplier)
                elif call_name in ("sorted", "sort"):
                    # Sorting is O(n log n) — estimate based on what we know
                    ops.add(OpType.COMPARISON, multiplier * DEFAULT_LOOP_ITERATIONS * 7)  # ~n*log(n)
                    ops.add(OpType.ASSIGNMENT, multiplier * DEFAULT_LOOP_ITERATIONS * 7)
                elif call_name in ("sum", "min", "max", "any", "all"):
                    # These iterate over their argument — O(n)
                    ops.add(OpType.ADDITION, multiplier * DEFAULT_LOOP_ITERATIONS)
                    ops.add(OpType.COMPARISON, multiplier * DEFAULT_LOOP_ITERATIONS)
                elif call_name in ("enumerate", "zip", "map", "filter", "reversed"):
                    # Iterator wrappers — cost realized when iterated, minimal direct cost
                    ops.add(OpType.FUNCTION_CALL, multiplier)
                elif call_name == "range":
                    # range() itself is cheap, cost is in the for loop that uses it
                    ops.add(OpType.FUNCTION_CALL, multiplier)
                elif call_name == "len":
                    ops.add(OpType.FUNCTION_CALL, multiplier)
                elif call_name == "append":
                    ops.add(OpType.MEMORY_ALLOC, multiplier)
                else:
                    ops.add(OpType.FUNCTION_CALL, multiplier)
            else:
                ops.add(OpType.FUNCTION_CALL, multiplier)

            # Analyze arguments
            for arg in node.args:
                ops.merge(self._analyze_expression(arg, multiplier))
            for kw in node.keywords:
                ops.merge(self._analyze_expression(kw.value, multiplier))

        # --- Subscript (array/dict access) ---
        elif isinstance(node, ast.Subscript):
            ops.add(OpType.ARRAY_ACCESS, multiplier)
            ops.merge(self._analyze_expression(node.value, multiplier))
            ops.merge(self._analyze_expression(node.slice, multiplier))

        # --- List/Set/Dict comprehensions (implicit loop) ---
        elif isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp)):
            # Estimate iterations from the generator
            comp_iterations = self._estimate_comprehension_iterations(node)
            inner_mult = multiplier * comp_iterations
            ops.add(OpType.MEMORY_ALLOC, multiplier)  # creating the collection
            # The element expression runs once per iteration
            ops.merge(self._analyze_expression(node.elt, inner_mult))
            for gen in node.generators:
                ops.add(OpType.COMPARISON, inner_mult)
                ops.merge(self._analyze_expression(gen.iter, multiplier))
                for if_clause in gen.ifs:
                    ops.add(OpType.CONDITIONAL, inner_mult)
                    ops.merge(self._analyze_expression(if_clause, inner_mult))

        elif isinstance(node, ast.DictComp):
            comp_iterations = self._estimate_comprehension_iterations(node)
            inner_mult = multiplier * comp_iterations
            ops.add(OpType.MEMORY_ALLOC, multiplier)
            ops.merge(self._analyze_expression(node.key, inner_mult))
            ops.merge(self._analyze_expression(node.value, inner_mult))
            for gen in node.generators:
                ops.merge(self._analyze_expression(gen.iter, multiplier))

        # --- Unary operations ---
        elif isinstance(node, ast.UnaryOp):
            ops.add(OpType.ADDITION, multiplier)
            ops.merge(self._analyze_expression(node.operand, multiplier))

        # --- Attribute access ---
        elif isinstance(node, ast.Attribute):
            ops.merge(self._analyze_expression(node.value, multiplier))

        # --- Ternary if-expression ---
        elif isinstance(node, ast.IfExp):
            ops.add(OpType.CONDITIONAL, multiplier)
            ops.merge(self._analyze_expression(node.test, multiplier))
            ops.merge(self._analyze_expression(node.body, multiplier))
            ops.merge(self._analyze_expression(node.orelse, multiplier))

        # --- Collection literals ---
        elif isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            # Allocating a collection has a cost proportional to its size
            if len(node.elts) > 0:
                ops.add(OpType.MEMORY_ALLOC, multiplier)
                ops.add(OpType.ASSIGNMENT, multiplier * len(node.elts))
            for elt in node.elts:
                ops.merge(self._analyze_expression(elt, multiplier))

        elif isinstance(node, ast.Dict):
            if len(node.keys) > 0:
                ops.add(OpType.MEMORY_ALLOC, multiplier)
                ops.add(OpType.ASSIGNMENT, multiplier * len(node.keys))
            for k in node.keys:
                if k:
                    ops.merge(self._analyze_expression(k, multiplier))
            for v in node.values:
                ops.merge(self._analyze_expression(v, multiplier))

        # --- F-strings / JoinedStr ---
        elif isinstance(node, ast.JoinedStr):
            # f-string formatting — each value is an expression
            for val in node.values:
                if isinstance(val, ast.FormattedValue):
                    ops.merge(self._analyze_expression(val.value, multiplier))
                    ops.add(OpType.FUNCTION_CALL, multiplier)  # string formatting cost

        # --- Starred expression ---
        elif isinstance(node, ast.Starred):
            ops.merge(self._analyze_expression(node.value, multiplier))

        return ops

    def _get_call_name(self, node: ast.Call) -> Optional[str]:
        """Extract the simple function name from a Call node."""
        if isinstance(node.func, ast.Name):
            return node.func.id
        elif isinstance(node.func, ast.Attribute):
            return node.func.attr
        return None

    def _get_full_call_name(self, node: ast.Call) -> Optional[str]:
        """Extract the full dotted call name like 'sys.stdout.write'."""
        parts = []
        current = node.func
        while isinstance(current, ast.Attribute):
            parts.append(current.attr)
            current = current.value
        if isinstance(current, ast.Name):
            parts.append(current.id)
        if parts:
            return ".".join(reversed(parts))
        return None

    def _estimate_for_iterations(self, node: ast.For) -> int:
        """
        Try hard to estimate the number of iterations for a for loop.

        Handles:
        - range(N) where N is a literal
        - range(start, stop) / range(start, stop, step) with literals
        - range(n) where n was assigned a constant earlier
        - range(len(x)) — heuristic default
        - for x in some_list — try to resolve list size
        - Fallback to DEFAULT_LOOP_ITERATIONS
        """
        if isinstance(node.iter, ast.Call):
            name = self._get_call_name(node.iter)
            if name == "range":
                args = node.iter.args
                resolved_args = [self._resolve_constant_expr(a) for a in args]

                if len(args) == 1 and resolved_args[0] is not None:
                    return max(0, resolved_args[0])
                elif len(args) == 2 and resolved_args[0] is not None and resolved_args[1] is not None:
                    return max(0, resolved_args[1] - resolved_args[0])
                elif len(args) == 3 and all(r is not None for r in resolved_args):
                    start, stop, step = resolved_args
                    if step != 0:
                        return max(0, (stop - start + step - (1 if step > 0 else -1)) // step)

                # range(n) where n is a variable — try to resolve
                if len(args) == 1 and isinstance(args[0], ast.Name):
                    var_name = args[0].id
                    if var_name in self._variable_constants:
                        return self._variable_constants[var_name]

                # range(len(...)) — use heuristic
                if len(args) == 1 and isinstance(args[0], ast.Call):
                    inner_name = self._get_call_name(args[0])
                    if inner_name == "len":
                        return DEFAULT_LOOP_ITERATIONS

            elif name == "enumerate":
                # enumerate(iterable) — try to resolve the iterable length
                if node.iter.args:
                    inner = node.iter.args[0]
                    if isinstance(inner, ast.Call):
                        inner_name = self._get_call_name(inner)
                        if inner_name == "range":
                            # Recursively estimate range
                            fake_for = ast.For(iter=inner, target=node.target, body=[], orelse=[])
                            return self._estimate_for_iterations(fake_for)
                return DEFAULT_LOOP_ITERATIONS

            elif name == "zip":
                # zip takes the minimum — we can try each argument
                return DEFAULT_LOOP_ITERATIONS

        # Iterating over a variable — check if we know its size
        if isinstance(node.iter, ast.Name):
            var_name = node.iter.id
            if var_name in self._variable_constants:
                return self._variable_constants[var_name]

        # Iterating over a string literal
        if isinstance(node.iter, ast.Constant) and isinstance(node.iter.value, str):
            return len(node.iter.value)

        # Iterating over a list/tuple literal
        if isinstance(node.iter, (ast.List, ast.Tuple)):
            return len(node.iter.elts)

        # Iterating over a dict literal
        if isinstance(node.iter, ast.Dict):
            return len(node.iter.keys)

        return DEFAULT_LOOP_ITERATIONS

    def _estimate_while_iterations(self, node: ast.While) -> int:
        """
        Try to estimate while loop iterations by analyzing the condition.

        Handles patterns:
        - while i < N: ... i += 1  (simple counter pattern)
        - while condition: with a decrement (like binary search halving)
        - Fallback to DEFAULT_LOOP_ITERATIONS
        """
        # Pattern: while var < const or while var > 0
        if isinstance(node.test, ast.Compare) and len(node.test.ops) == 1:
            if isinstance(node.test.left, ast.Name):
                var_name = node.test.left.id

                # while x < N pattern
                if isinstance(node.test.ops[0], (ast.Lt, ast.LtE)):
                    upper = self._resolve_constant_expr(node.test.comparators[0])
                    if upper is not None:
                        # Check if the loop increments the variable
                        for stmt in node.body:
                            if isinstance(stmt, ast.AugAssign) and isinstance(stmt.target, ast.Name):
                                if stmt.target.id == var_name and isinstance(stmt.op, ast.Add):
                                    step = self._resolve_constant_expr(stmt.value)
                                    if step and step > 0:
                                        return max(1, upper // step)
                        return upper

                # while x > 0 pattern (decreasing)
                if isinstance(node.test.ops[0], (ast.Gt, ast.GtE)):
                    lower = self._resolve_constant_expr(node.test.comparators[0])
                    if lower is not None:
                        start = self._variable_constants.get(var_name)
                        if start is not None:
                            return max(1, abs(start - lower))

            # while low <= high pattern (binary search — O(log n))
            if isinstance(node.test.ops[0], ast.LtE):
                # Likely a binary search or similar halving algorithm
                return 20  # ~log2(1_000_000)

        return DEFAULT_LOOP_ITERATIONS

    def _estimate_comprehension_iterations(self, node) -> int:
        """Estimate iterations for a list/set/dict comprehension."""
        if hasattr(node, 'generators') and node.generators:
            gen = node.generators[0]
            # Try to resolve from the iterator
            if isinstance(gen.iter, ast.Call):
                name = self._get_call_name(gen.iter)
                if name == "range":
                    args = gen.iter.args
                    resolved = [self._resolve_constant_expr(a) for a in args]
                    if len(args) == 1 and resolved[0] is not None:
                        return resolved[0]
                    elif len(args) >= 2 and resolved[0] is not None and resolved[1] is not None:
                        return max(0, resolved[1] - resolved[0])
            elif isinstance(gen.iter, (ast.List, ast.Tuple)):
                return len(gen.iter.elts)
            elif isinstance(gen.iter, ast.Name) and gen.iter.id in self._variable_constants:
                return self._variable_constants[gen.iter.id]
        return DEFAULT_LOOP_ITERATIONS

    def _get_max_loop_depth(self, node: ast.AST, current_depth: int = 0) -> int:
        """Find the maximum loop nesting depth."""
        max_depth = current_depth
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.For, ast.While)):
                max_depth = max(max_depth, self._get_max_loop_depth(child, current_depth + 1))
            else:
                max_depth = max(max_depth, self._get_max_loop_depth(child, current_depth))
        return max_depth


# =============================================================================
# REGEX-BASED ANALYZER (for Java, C, C++, JavaScript)
# =============================================================================

class RegexAnalyzer(LanguageAnalyzer):
    """
    A regex/pattern-based analyzer for languages where we don't have
    a native AST parser in Python. Uses structural pattern matching
    to count operations.

    KEY IMPROVEMENT: Instead of counting all operations in a block with one
    flat multiplier, we parse the code into loop-scoped regions and apply
    the correct nesting multiplier to each line based on its loop depth.
    """

    IO_PATTERNS = {
        "java": r'\b(System\.(out|err|in)\.\w+|Scanner\.\w+|BufferedReader|FileReader|FileWriter|PrintWriter|println|printf|print|read|write|readLine)\b',
        "c": r'\b(printf|scanf|fprintf|fscanf|fopen|fclose|fread|fwrite|puts|gets|getchar|putchar|fgets|fputs)\b',
        "cpp": r'\b(cout|cin|cerr|clog|printf|scanf|ifstream|ofstream|fstream|getline)\b',
        "javascript": r'\b(console\.(log|error|warn|info|debug|trace)|alert|prompt|confirm|document\.write|fs\.\w+|readFile|writeFile|process\.std(in|out|err))\b',
    }

    NETWORK_PATTERNS = {
        "java": r'\b(HttpURLConnection|URL|Socket|ServerSocket|HttpClient|HttpRequest|RestTemplate|WebClient)\b',
        "c": r'\b(socket|connect|send|recv|bind|listen|accept|curl_)\b',
        "cpp": r'\b(socket|connect|send|recv|boost::asio|curl_|httplib)\b',
        "javascript": r'\b(fetch|axios|XMLHttpRequest|http\.request|https\.request|WebSocket|net\.connect)\b',
    }

    ALLOC_PATTERNS = {
        "java": r'\bnew\s+\w+',
        "c": r'\b(malloc|calloc|realloc|free|alloca)\b',
        "cpp": r'\b(new\s+\w+|make_shared|make_unique|malloc|calloc|std::vector|std::map|std::unordered_map)\b',
        "javascript": r'\bnew\s+\w+|Array\(|Object\.create|Map\(|Set\(',
    }

    FUNC_PATTERNS = {
        "java": r'(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{',
        "c": r'(?:static\s+)?(?:inline\s+)?(?:unsigned\s+)?(?:const\s+)?\w+[\s*]+(\w+)\s*\([^)]*\)\s*\{',
        "cpp": r'(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:unsigned\s+)?(?:const\s+)?[\w:<>]+[\s*&]+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{',
        "javascript": r'(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>))|(\w+)\s*\([^)]*\)\s*\{',
    }

    FOR_PATTERN = r'\bfor\s*\('
    WHILE_PATTERN = r'\bwhile\s*\('
    DO_WHILE_PATTERN = r'\bdo\s*\{'

    def __init__(self, language: str):
        super().__init__()
        self.language = language

    def analyze(self, code: str, file_path: Optional[str] = None) -> AnalysisResult:
        self.result = AnalysisResult(language=self.language, file_path=file_path)
        self.result.assumptions.append(
            "Regex-based analysis (no native AST) — less precise than AST-based"
        )
        self.result.assumptions.append(
            f"Energy per operation: {ENERGY_PER_OPERATION_JOULES} J"
        )
        self.result.assumptions.append(
            f"Carbon intensity: {CARBON_INTENSITY_G_PER_KWH} gCO2/kWh (global average)"
        )

        # Extract all variable = number assignments for loop bound resolution
        self._variable_constants: Dict[str, int] = {}
        for match in re.finditer(r'\b(\w+)\s*=\s*(\d+)\s*;', code):
            self._variable_constants[match.group(1)] = int(match.group(2))

        clean_code = self._remove_comments(code)

        functions = self._extract_functions(clean_code, code)

        for func_name, func_body, line_num in functions:
            func_analysis = self._analyze_function_body(func_name, func_body, line_num)
            self.result.functions.append(func_analysis)

        # Global scope: analyze code outside functions
        global_code = self._extract_global_code(clean_code, functions)
        self.result.global_operations = self._analyze_code_by_depth(global_code)

        return self.result

    def _remove_comments(self, code: str) -> str:
        """Remove comments from C-family code."""
        code = re.sub(r'//.*?$', '', code, flags=re.MULTILINE)
        code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
        code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', code)
        code = re.sub(r"'(?:[^'\\]|\\.)*'", "''", code)
        code = re.sub(r'`(?:[^`\\]|\\.)*`', '``', code)
        return code

    def _extract_global_code(self, clean_code: str, functions: list) -> str:
        """Extract code outside of function bodies (rough approach)."""
        # Remove all function bodies to get global code
        result = clean_code
        for _, func_body, _ in functions:
            result = result.replace(func_body, "", 1)
        return result

    def _extract_functions(self, clean_code: str, original_code: str) -> List[Tuple[str, str, int]]:
        """Extract function names and bodies from code."""
        functions = []
        pattern = self.FUNC_PATTERNS.get(self.language, self.FUNC_PATTERNS["c"])

        for match in re.finditer(pattern, clean_code):
            func_name = next((g for g in match.groups() if g is not None), "unknown")
            if func_name in ("if", "for", "while", "switch", "return", "else"):
                continue

            start = match.start()
            func_body = self._extract_brace_block(clean_code, match.end() - 1)
            line_num = clean_code[:start].count('\n') + 1

            functions.append((func_name, func_body, line_num))

        return functions

    def _extract_brace_block(self, code: str, start_brace: int) -> str:
        """Extract text within matching braces."""
        if start_brace >= len(code) or code[start_brace] != '{':
            idx = code.find('{', start_brace)
            if idx == -1:
                return ""
            start_brace = idx

        depth = 0
        i = start_brace
        while i < len(code):
            if code[i] == '{':
                depth += 1
            elif code[i] == '}':
                depth -= 1
                if depth == 0:
                    return code[start_brace:i + 1]
            i += 1
        return code[start_brace:]

    def _analyze_function_body(self, name: str, body: str, line_num: int) -> FunctionAnalysis:
        """Analyze function body with depth-aware operation counting."""
        func = FunctionAnalysis(name=name, line_number=line_num)

        # Detect recursion
        if re.search(rf'\b{re.escape(name)}\s*\(', body):
            func.is_recursive = True

        # Analyze with depth-aware counting
        func.operations = self._analyze_code_by_depth(body)

        if func.is_recursive:
            func.operations = func.operations.scale(DEFAULT_RECURSION_DEPTH)
            self.result.assumptions.append(
                f"Function '{name}' is recursive — assumed {DEFAULT_RECURSION_DEPTH} recursive calls"
            )

        func.max_nesting = self._get_max_loop_nesting(body)
        return func

    def _analyze_code_by_depth(self, code: str) -> OperationCount:
        """
        Analyze code line-by-line, tracking loop nesting depth.
        Each line's operations are multiplied by the product of all enclosing
        loop iteration counts. This means 5 printf() calls inside a
        for(i=0;i<100;i++) loop correctly count as 500 IO operations.
        """
        ops = OperationCount()
        lines = code.split('\n')

        # Stack of (loop_type, estimated_iterations) for nesting
        loop_stack: List[Tuple[str, int]] = []
        brace_depth_at_loop: List[int] = []  # brace depth when loop started
        brace_depth = 0

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # Track brace depth
            open_braces = stripped.count('{')
            close_braces = stripped.count('}')

            # Detect loop starts
            for_match = re.match(r'\bfor\s*\((.+)\)', stripped)
            while_match = re.match(r'\bwhile\s*\((.+)\)', stripped)
            do_match = stripped.startswith('do') and (stripped == 'do' or stripped.startswith('do {') or stripped.startswith('do{'))

            if for_match:
                iterations = self._estimate_for_iterations_from_header(for_match.group(1))
                loop_stack.append(("for", iterations))
                brace_depth_at_loop.append(brace_depth)
                self.result.assumptions.append(
                    f"for-loop estimated {iterations} iterations"
                )
            elif while_match:
                iterations = self._estimate_while_iterations_from_condition(while_match.group(1))
                loop_stack.append(("while", iterations))
                brace_depth_at_loop.append(brace_depth)
                self.result.assumptions.append(
                    f"while-loop estimated {iterations} iterations"
                )
            elif do_match:
                loop_stack.append(("do", DEFAULT_LOOP_ITERATIONS))
                brace_depth_at_loop.append(brace_depth)

            brace_depth += open_braces

            # Calculate current multiplier from all enclosing loops
            current_multiplier = 1
            for _, iters in loop_stack:
                current_multiplier *= iters

            # Count operations on this line with the correct multiplier
            self._count_line_operations(stripped, ops, current_multiplier)

            brace_depth -= close_braces

            # Pop loops when their brace block closes
            while brace_depth_at_loop and brace_depth <= brace_depth_at_loop[-1]:
                loop_stack.pop()
                brace_depth_at_loop.pop()

        return ops

    def _count_line_operations(self, line: str, ops: OperationCount, multiplier: int):
        """Count operations on a single line with the given multiplier."""
        # Skip empty/brace-only lines
        if not line or line in ('{', '}', '};'):
            return

        io_pattern = self.IO_PATTERNS.get(self.language, "")
        net_pattern = self.NETWORK_PATTERNS.get(self.language, "")
        alloc_pattern = self.ALLOC_PATTERNS.get(self.language, "")

        # I/O operations (check first, higher weight)
        if io_pattern:
            io_count = len(re.findall(io_pattern, line))
            ops.add(OpType.IO_OPERATION, io_count * multiplier)

        # Network operations
        if net_pattern:
            net_count = len(re.findall(net_pattern, line))
            ops.add(OpType.NETWORK_OP, net_count * multiplier)

        # Memory allocations
        if alloc_pattern:
            alloc_count = len(re.findall(alloc_pattern, line))
            ops.add(OpType.MEMORY_ALLOC, alloc_count * multiplier)

        # Arithmetic
        additions = len(re.findall(r'(?<!\+)\+(?!\+|=)', line))
        increments = len(re.findall(r'\+\+', line))
        subtractions = len(re.findall(r'(?<!-)-(?!-|=|>)', line))
        decrements = len(re.findall(r'--', line))
        multiplications = len(re.findall(r'\*(?!=)', line))
        divisions = len(re.findall(r'/(?!=|/|\*)', line))

        ops.add(OpType.ADDITION, (additions + increments) * multiplier)
        ops.add(OpType.SUBTRACTION, (subtractions + decrements) * multiplier)
        ops.add(OpType.MULTIPLICATION, multiplications * multiplier)
        ops.add(OpType.DIVISION, divisions * multiplier)

        # Assignments
        assignments = len(re.findall(r'(?<![=!<>])=(?!=)', line))
        ops.add(OpType.ASSIGNMENT, assignments * multiplier)

        # Comparisons
        comparisons = len(re.findall(r'==|!=|<=|>=|(?<!=)<(?!=)|(?<!=)>(?!=)', line))
        ops.add(OpType.COMPARISON, comparisons * multiplier)

        # Conditionals
        conditionals = len(re.findall(r'\b(if|else\s+if|switch|case)\b', line))
        ops.add(OpType.CONDITIONAL, conditionals * multiplier)

        # Array access
        array_accesses = len(re.findall(r'\w+\s*\[', line))
        ops.add(OpType.ARRAY_ACCESS, array_accesses * multiplier)

        # Function calls (excluding control structures and already-counted IO/net/alloc)
        func_calls = len(re.findall(r'\b\w+\s*\(', line))
        control_structs = len(re.findall(r'\b(if|for|while|switch|catch|return)\s*\(', line))
        io_counted = len(re.findall(io_pattern, line)) if io_pattern else 0
        net_counted = len(re.findall(net_pattern, line)) if net_pattern else 0
        remaining_calls = max(0, func_calls - control_structs - io_counted - net_counted)
        ops.add(OpType.FUNCTION_CALL, remaining_calls * multiplier)

    def _estimate_for_iterations_from_header(self, header: str) -> int:
        """
        Parse a for-loop header like 'int i = 0; i < 100; i++' and estimate iterations.
        Tries multiple patterns for accuracy.
        """
        # Pattern: i = START; i < END (or <=, >, >=)
        match = re.search(r'(\w+)\s*=\s*(\d+)\s*;\s*\1\s*([<>]=?)\s*(\d+)', header)
        if match:
            var = match.group(1)
            start_val = int(match.group(2))
            op = match.group(3)
            end_val = int(match.group(4))

            if op == '<':
                return max(0, end_val - start_val)
            elif op == '<=':
                return max(0, end_val - start_val + 1)
            elif op == '>':
                return max(0, start_val - end_val)
            elif op == '>=':
                return max(0, start_val - end_val + 1)

        # Pattern: i = 0; i < variable (try to resolve variable)
        match = re.search(r'(\w+)\s*=\s*(\d+)\s*;\s*\1\s*[<>]=?\s*(\w+)', header)
        if match:
            start_val = int(match.group(2))
            var_name = match.group(3)
            if var_name in self._variable_constants:
                return max(0, abs(self._variable_constants[var_name] - start_val))

        # Pattern with step: i = 0; i < 100; i += 2
        match = re.search(r'(\w+)\s*=\s*(\d+)\s*;\s*\1\s*<\s*(\d+)\s*;\s*\1\s*\+=\s*(\d+)', header)
        if match:
            start_val = int(match.group(2))
            end_val = int(match.group(3))
            step = int(match.group(4))
            if step > 0:
                return max(0, (end_val - start_val + step - 1) // step)

        # Java enhanced for-each: for(Type var : collection) — can't know size
        if ':' in header:
            return DEFAULT_LOOP_ITERATIONS

        return DEFAULT_LOOP_ITERATIONS

    def _estimate_while_iterations_from_condition(self, condition: str) -> int:
        """Estimate while-loop iterations from the condition string."""
        # Pattern: var < N or var > 0
        match = re.search(r'(\w+)\s*([<>]=?)\s*(\d+)', condition)
        if match:
            end_val = int(match.group(3))
            op = match.group(2)
            var = match.group(1)

            if op in ('<', '<='):
                # Try to find initial value
                if var in self._variable_constants:
                    return max(1, abs(end_val - self._variable_constants[var]))
                return end_val if end_val > 0 else DEFAULT_LOOP_ITERATIONS

            if op in ('>', '>='):
                if var in self._variable_constants:
                    return max(1, self._variable_constants[var] - end_val)

        # Pattern: var != null or similar — short-lived loop
        if '!=' in condition or 'null' in condition:
            return DEFAULT_LOOP_ITERATIONS

        # Binary search pattern: low <= high
        if '<=' in condition:
            return 20  # ~log2(1_000_000)

        return DEFAULT_LOOP_ITERATIONS

    def _get_max_loop_nesting(self, code: str) -> int:
        """Estimate maximum loop nesting depth."""
        max_depth = 0
        current_depth = 0
        lines = code.split('\n')
        for line in lines:
            stripped = line.strip()
            if re.match(r'\b(for|while)\s*\(', stripped) or stripped.startswith('do'):
                current_depth += 1
                max_depth = max(max_depth, current_depth)
            if stripped == '}' and current_depth > 0:
                current_depth -= 1
        return max_depth


# =============================================================================
# ANALYZER FACTORY
# =============================================================================

def get_analyzer(language: str) -> LanguageAnalyzer:
    """Factory: return the appropriate analyzer for the language."""
    if language == "python":
        return PythonAnalyzer()
    elif language in ("java", "c", "cpp", "javascript"):
        return RegexAnalyzer(language)
    else:
        return RegexAnalyzer(language)


# =============================================================================
# MAIN ESTIMATOR API
# =============================================================================

def estimate_carbon_footprint(
    code: Optional[str] = None,
    file_path: Optional[str] = None,
    language: Optional[str] = None,
) -> AnalysisResult:
    """
    Main entry point: estimate the carbon footprint of source code.

    Args:
        code: Source code as a string (provide this OR file_path).
        file_path: Path to a source code file.
        language: Programming language ('python', 'java', 'c', 'cpp', 'javascript').
                  If None, auto-detected from file extension or code content.

    Returns:
        AnalysisResult with operations, energy, carbon, and per-function breakdown.
    """
    if code is None and file_path:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            code = f.read()
    elif code is None:
        raise ValueError("Must provide either 'code' or 'file_path'.")

    if language is None:
        language = detect_language(file_path=file_path, code=code)

    analyzer = get_analyzer(language)
    result = analyzer.analyze(code, file_path=file_path)

    return result


def save_result_json(result: AnalysisResult, output_path: str = OUTPUT_JSON_PATH):
    """Save the analysis result to a JSON file."""
    data = result.to_dict()
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return output_path


# =============================================================================
# CLI ENTRY POINT
# =============================================================================

def main():
    """
    CLI entry point.

    Modes:
    1. --file <path>     : analyze a source code file
    2. (no args)         : read code from stdin (paste & press Ctrl+D / Ctrl+Z)
    3. --code "<string>" : pass code as a command-line string

    Output is always saved to carbon_footprint_result.json
    """
    import argparse

    parser = argparse.ArgumentParser(
        description="Estimate carbon footprint of source code via static analysis.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python carbon_footprint_estimator.py --file mycode.py
  python carbon_footprint_estimator.py --file Main.java --language java
  python carbon_footprint_estimator.py --code "for i in range(100): print(i)"
  python carbon_footprint_estimator.py                   # interactive input
  python carbon_footprint_estimator.py --output result.json
        """,
    )
    parser.add_argument("--file", "-f", help="Path to source code file to analyze")
    parser.add_argument("--code", "-c", help="Source code as a string")
    parser.add_argument(
        "--language", "-l",
        choices=["python", "java", "c", "cpp", "javascript"],
        help="Programming language (auto-detected if omitted)",
    )
    parser.add_argument(
        "--output", "-o",
        default=OUTPUT_JSON_PATH,
        help=f"Output JSON file path (default: {OUTPUT_JSON_PATH})",
    )

    args = parser.parse_args()

    code = None
    file_path = None

    if args.file:
        file_path = args.file
    elif args.code:
        code = args.code
    else:
        # Interactive: read from stdin
        print("=" * 60)
        print("  CARBON FOOTPRINT ESTIMATOR — Interactive Mode")
        print("=" * 60)
        print()
        print("Paste your source code below.")
        print("When done, press Enter then Ctrl+Z (Windows) or Ctrl+D (Unix).")
        print("-" * 60)
        try:
            code = sys.stdin.read()
        except KeyboardInterrupt:
            print("\nAborted.")
            sys.exit(0)

        if not code or not code.strip():
            print("Error: No code provided.")
            sys.exit(1)

    # Run analysis
    result = estimate_carbon_footprint(code=code, file_path=file_path, language=args.language)

    # Save to JSON
    out_path = save_result_json(result, args.output)

    # Also print a brief summary to console
    print()
    print("=" * 60)
    print("  CARBON FOOTPRINT RESULT")
    print("=" * 60)
    print(f"  Language            : {result.language.upper()}")
    print(f"  Functions analyzed  : {len(result.functions)}")
    print(f"  Total weighted ops  : {result.total_weighted_ops:,}")
    print(f"  Energy (Joules)     : {result.energy_joules:.6e}")
    print(f"  Energy (kWh)        : {result.energy_kwh:.6e}")
    print(f"  Carbon (gCO2)       : {result.carbon_grams:.6e}")
    print(f"  Carbon (mgCO2)      : {result.carbon_grams * 1000:.6e}")

    if result.hotspots:
        print()
        print("  Top hotspot functions:")
        for i, f in enumerate(result.hotspots, 1):
            pct = (f.weighted_ops / result.total_weighted_ops * 100) if result.total_weighted_ops > 0 else 0
            print(f"    {i}. {f.name} — {f.weighted_ops:,} ops ({pct:.1f}%)")

    print()
    print(f"  Full results saved to: {out_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
