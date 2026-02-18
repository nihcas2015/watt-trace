/**
 * Carbon Footprint Estimator — Constants & Configuration
 *
 * TypeScript port of carbon_footprint_estimator.py
 * Defines operation types, energy weights, and model constants.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */
/** Types of computational operations with associated energy weights */
export declare enum OpType {
    ADDITION = "addition",
    SUBTRACTION = "subtraction",
    MULTIPLICATION = "multiplication",
    DIVISION = "division",
    ASSIGNMENT = "assignment",
    COMPARISON = "comparison",
    ARRAY_ACCESS = "array_access",
    FUNCTION_CALL = "function_call",
    MEMORY_ALLOC = "memory_allocation",
    CONDITIONAL = "conditional_branch",
    IO_OPERATION = "io_operation",
    NETWORK_OP = "network_operation"
}
/** All OpType values for iteration */
export declare const ALL_OP_TYPES: OpType[];
/** Approximate energy weights per operation type (relative cost units) */
export declare const OPERATION_WEIGHTS: Record<OpType, number>;
/** Joules per computational operation */
export declare const ENERGY_PER_OPERATION_JOULES = 3e-9;
/** Joules in 1 kWh */
export declare const JOULES_PER_KWH = 3600000;
/** Global average gCO2 per kWh */
export declare const CARBON_INTENSITY_G_PER_KWH = 475;
/** Default loop iteration count when static analysis can't determine */
export declare const DEFAULT_LOOP_ITERATIONS = 100;
/** Default recursion depth for recursive functions */
export declare const DEFAULT_RECURSION_DEPTH = 10;
/**
 * The estimator splits the total footprint into three tiers:
 *   1. User End   — code executing on the end-user's device
 *   2. Developer End — IDE, build, lint, test cycles during development
 *   3. Server Side — code executing in a datacenter (with cooling, PUE, traffic)
 *
 * Traffic is assumed; all values are daily estimates.
 */
/** How many times end-users execute this code per day */
export declare const ASSUMED_DAILY_USER_EXECUTIONS = 1000;
/** How many HTTP requests reach the server per day */
export declare const ASSUMED_DAILY_SERVER_REQUESTS = 10000;
/** Power Usage Effectiveness — datacenter overhead for cooling, networking, etc. */
export declare const SERVER_PUE = 1.58;
/** Approximate energy for one network request (routing, TLS, DNS) in joules */
export declare const NETWORK_ENERGY_PER_REQUEST_J = 0.001;
/** Overhead factor for the user device (OS, display, idle draw, etc.) */
export declare const DEVICE_POWER_OVERHEAD = 1.2;
/**
 * Developer environment multiplier.
 * Represents the ratio of total development energy to single-execution energy:
 * IDE rendering, syntax checking, compilation, linting, test-suite runs,
 * hot-reload, and iterative debugging across many dev-cycles.
 */
export declare const DEV_ENVIRONMENT_MULTIPLIER = 5;
/** I/O functions by language */
export declare const IO_FUNCTIONS: Record<string, Set<string>>;
/** I/O full-call name substrings for matching dotted calls */
export declare const IO_CALL_SUBSTRINGS: Record<string, string[]>;
/** Network functions by language */
export declare const NETWORK_FUNCTIONS: Record<string, Set<string>>;
/** Network full-call name substrings for matching dotted calls */
export declare const NETWORK_CALL_SUBSTRINGS: Record<string, string[]>;
/** Memory allocation functions by language */
export declare const ALLOC_FUNCTIONS: Record<string, Set<string>>;
/** I/O regex patterns by language */
export declare const IO_PATTERNS: Record<string, string>;
/** Network regex patterns by language */
export declare const NETWORK_REGEX_PATTERNS: Record<string, string>;
/** Memory allocation regex patterns by language */
export declare const ALLOC_REGEX_PATTERNS: Record<string, string>;
/** Function definition regex patterns by language */
export declare const FUNC_REGEX_PATTERNS: Record<string, RegExp>;
//# sourceMappingURL=constants.d.ts.map