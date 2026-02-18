"use strict";
/**
 * Carbon Footprint Estimator — Constants & Configuration
 *
 * TypeScript port of carbon_footprint_estimator.py
 * Defines operation types, energy weights, and model constants.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FUNC_REGEX_PATTERNS = exports.ALLOC_REGEX_PATTERNS = exports.NETWORK_REGEX_PATTERNS = exports.IO_PATTERNS = exports.ALLOC_FUNCTIONS = exports.NETWORK_CALL_SUBSTRINGS = exports.NETWORK_FUNCTIONS = exports.IO_CALL_SUBSTRINGS = exports.IO_FUNCTIONS = exports.DEV_ENVIRONMENT_MULTIPLIER = exports.DEVICE_POWER_OVERHEAD = exports.NETWORK_ENERGY_PER_REQUEST_J = exports.SERVER_PUE = exports.ASSUMED_DAILY_SERVER_REQUESTS = exports.ASSUMED_DAILY_USER_EXECUTIONS = exports.DEFAULT_RECURSION_DEPTH = exports.DEFAULT_LOOP_ITERATIONS = exports.CARBON_INTENSITY_G_PER_KWH = exports.JOULES_PER_KWH = exports.ENERGY_PER_OPERATION_JOULES = exports.OPERATION_WEIGHTS = exports.ALL_OP_TYPES = exports.OpType = void 0;
// =============================================================================
// OPERATION TYPES
// =============================================================================
/** Types of computational operations with associated energy weights */
var OpType;
(function (OpType) {
    OpType["ADDITION"] = "addition";
    OpType["SUBTRACTION"] = "subtraction";
    OpType["MULTIPLICATION"] = "multiplication";
    OpType["DIVISION"] = "division";
    OpType["ASSIGNMENT"] = "assignment";
    OpType["COMPARISON"] = "comparison";
    OpType["ARRAY_ACCESS"] = "array_access";
    OpType["FUNCTION_CALL"] = "function_call";
    OpType["MEMORY_ALLOC"] = "memory_allocation";
    OpType["CONDITIONAL"] = "conditional_branch";
    OpType["IO_OPERATION"] = "io_operation";
    OpType["NETWORK_OP"] = "network_operation";
})(OpType || (exports.OpType = OpType = {}));
/** All OpType values for iteration */
exports.ALL_OP_TYPES = Object.values(OpType);
// =============================================================================
// ENERGY WEIGHTS
// =============================================================================
/** Approximate energy weights per operation type (relative cost units) */
exports.OPERATION_WEIGHTS = {
    [OpType.ADDITION]: 1,
    [OpType.SUBTRACTION]: 1,
    [OpType.MULTIPLICATION]: 2,
    [OpType.DIVISION]: 3,
    [OpType.ASSIGNMENT]: 1,
    [OpType.COMPARISON]: 1,
    [OpType.ARRAY_ACCESS]: 2,
    [OpType.FUNCTION_CALL]: 5,
    [OpType.MEMORY_ALLOC]: 10,
    [OpType.CONDITIONAL]: 1,
    [OpType.IO_OPERATION]: 50,
    [OpType.NETWORK_OP]: 100,
};
// =============================================================================
// ENERGY MODEL CONSTANTS
// =============================================================================
/** Joules per computational operation */
exports.ENERGY_PER_OPERATION_JOULES = 3e-9;
/** Joules in 1 kWh */
exports.JOULES_PER_KWH = 3_600_000;
/** Global average gCO2 per kWh */
exports.CARBON_INTENSITY_G_PER_KWH = 475;
// =============================================================================
// HEURISTIC DEFAULTS
// =============================================================================
/** Default loop iteration count when static analysis can't determine */
exports.DEFAULT_LOOP_ITERATIONS = 100;
/** Default recursion depth for recursive functions */
exports.DEFAULT_RECURSION_DEPTH = 10;
// =============================================================================
// DEPLOYMENT & TRAFFIC ASSUMPTIONS (for 3-tier carbon breakdown)
// =============================================================================
/**
 * The estimator splits the total footprint into three tiers:
 *   1. User End   — code executing on the end-user's device
 *   2. Developer End — IDE, build, lint, test cycles during development
 *   3. Server Side — code executing in a datacenter (with cooling, PUE, traffic)
 *
 * Traffic is assumed; all values are daily estimates.
 */
/** How many times end-users execute this code per day */
exports.ASSUMED_DAILY_USER_EXECUTIONS = 1_000;
/** How many HTTP requests reach the server per day */
exports.ASSUMED_DAILY_SERVER_REQUESTS = 10_000;
/** Power Usage Effectiveness — datacenter overhead for cooling, networking, etc. */
exports.SERVER_PUE = 1.58;
/** Approximate energy for one network request (routing, TLS, DNS) in joules */
exports.NETWORK_ENERGY_PER_REQUEST_J = 0.001;
/** Overhead factor for the user device (OS, display, idle draw, etc.) */
exports.DEVICE_POWER_OVERHEAD = 1.2;
/**
 * Developer environment multiplier.
 * Represents the ratio of total development energy to single-execution energy:
 * IDE rendering, syntax checking, compilation, linting, test-suite runs,
 * hot-reload, and iterative debugging across many dev-cycles.
 */
exports.DEV_ENVIRONMENT_MULTIPLIER = 5;
// =============================================================================
// LANGUAGE-SPECIFIC FUNCTION CLASSIFICATION
// =============================================================================
/** I/O functions by language */
exports.IO_FUNCTIONS = {
    python: new Set([
        'print', 'input', 'open', 'read', 'write', 'readline', 'readlines',
        'writelines', 'close', 'flush', 'seek', 'tell',
    ]),
    java: new Set([
        'println', 'printf', 'print', 'read', 'write', 'readLine',
    ]),
    c: new Set([
        'printf', 'scanf', 'fprintf', 'fscanf', 'fopen', 'fclose',
        'fread', 'fwrite', 'puts', 'gets', 'getchar', 'putchar', 'fgets', 'fputs',
    ]),
    cpp: new Set([
        'cout', 'cin', 'cerr', 'clog', 'printf', 'scanf',
        'getline',
    ]),
    javascript: new Set([
        'log', 'error', 'warn', 'info', 'debug', 'trace',
        'alert', 'prompt', 'confirm',
        'readFile', 'writeFile', 'readFileSync', 'writeFileSync',
    ]),
};
/** I/O full-call name substrings for matching dotted calls */
exports.IO_CALL_SUBSTRINGS = {
    python: ['print', 'write', 'read', 'input', 'open'],
    java: ['System.out', 'System.err', 'System.in', 'Scanner', 'BufferedReader', 'FileReader', 'FileWriter', 'PrintWriter'],
    c: [],
    cpp: [],
    javascript: ['console.log', 'console.error', 'console.warn', 'console.info', 'console.debug', 'console.trace',
        'document.write', 'fs.', 'process.stdout', 'process.stderr', 'process.stdin'],
};
/** Network functions by language */
exports.NETWORK_FUNCTIONS = {
    python: new Set([
        'request', 'get', 'post', 'put', 'delete', 'patch',
        'urlopen', 'connect', 'send', 'recv', 'socket',
        'fetch', 'download', 'upload',
    ]),
    java: new Set([
        'HttpURLConnection', 'URL', 'Socket', 'ServerSocket',
        'HttpClient', 'HttpRequest', 'RestTemplate', 'WebClient',
    ]),
    c: new Set(['socket', 'connect', 'send', 'recv', 'bind', 'listen', 'accept']),
    cpp: new Set(['socket', 'connect', 'send', 'recv']),
    javascript: new Set([
        'fetch', 'axios', 'XMLHttpRequest', 'WebSocket',
    ]),
};
/** Network full-call name substrings for matching dotted calls */
exports.NETWORK_CALL_SUBSTRINGS = {
    python: ['request', 'urlopen', 'socket', 'fetch'],
    java: [],
    c: [],
    cpp: ['boost::asio', 'curl_', 'httplib'],
    javascript: ['http.request', 'https.request', 'net.connect'],
};
/** Memory allocation functions by language */
exports.ALLOC_FUNCTIONS = {
    python: new Set([
        'list', 'dict', 'set', 'tuple', 'bytearray', 'array',
        'zeros', 'ones', 'empty', 'malloc', 'calloc',
        'DataFrame', 'Series', 'ndarray', 'deepcopy', 'copy',
    ]),
    java: new Set([]),
    c: new Set(['malloc', 'calloc', 'realloc', 'free', 'alloca']),
    cpp: new Set(['malloc', 'calloc', 'make_shared', 'make_unique']),
    javascript: new Set([]),
};
// =============================================================================
// REGEX PATTERNS FOR FALLBACK ANALYZER
// =============================================================================
/** I/O regex patterns by language */
exports.IO_PATTERNS = {
    python: '\\b(print|input|open|read|write|readline|readlines|writelines|close|flush|seek|tell)\\s*\\(',
    java: '\\b(System\\.(out|err|in)\\.\\w+|Scanner\\.\\w+|BufferedReader|FileReader|FileWriter|PrintWriter|println|printf|print|read|write|readLine)\\b',
    c: '\\b(printf|scanf|fprintf|fscanf|fopen|fclose|fread|fwrite|puts|gets|getchar|putchar|fgets|fputs)\\b',
    cpp: '\\b(cout|cin|cerr|clog|printf|scanf|ifstream|ofstream|fstream|getline)\\b',
    javascript: '\\b(console\\.(log|error|warn|info|debug|trace)|alert|prompt|confirm|document\\.write|fs\\.\\w+|readFile|writeFile|process\\.std(in|out|err))\\b',
};
/** Network regex patterns by language */
exports.NETWORK_REGEX_PATTERNS = {
    python: '\\b(request|urlopen|socket|fetch|connect|send|recv)\\b',
    java: '\\b(HttpURLConnection|URL|Socket|ServerSocket|HttpClient|HttpRequest|RestTemplate|WebClient)\\b',
    c: '\\b(socket|connect|send|recv|bind|listen|accept|curl_)\\b',
    cpp: '\\b(socket|connect|send|recv|boost::asio|curl_|httplib)\\b',
    javascript: '\\b(fetch|axios|XMLHttpRequest|http\\.request|https\\.request|WebSocket|net\\.connect)\\b',
};
/** Memory allocation regex patterns by language */
exports.ALLOC_REGEX_PATTERNS = {
    python: '\\b(list|dict|set|tuple|bytearray|array|DataFrame|Series|ndarray|deepcopy|copy)\\s*\\(',
    java: '\\bnew\\s+\\w+',
    c: '\\b(malloc|calloc|realloc|free|alloca)\\b',
    cpp: '\\b(new\\s+\\w+|make_shared|make_unique|malloc|calloc|std::vector|std::map|std::unordered_map)\\b',
    javascript: '\\bnew\\s+\\w+|Array\\(|Object\\.create|Map\\(|Set\\(',
};
/** Function definition regex patterns by language */
exports.FUNC_REGEX_PATTERNS = {
    python: /(?:^|\n)\s*(?:async\s+)?def\s+(\w+)\s*\(/g,
    java: /(?:public|private|protected|static|\s)+[\w<>\[\]]+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/g,
    c: /(?:static\s+)?(?:inline\s+)?(?:unsigned\s+)?(?:const\s+)?\w+[\s*]+(\w+)\s*\([^)]*\)\s*\{/g,
    cpp: /(?:static\s+)?(?:inline\s+)?(?:virtual\s+)?(?:unsigned\s+)?(?:const\s+)?[\w:<>]+[\s*&]+(\w+)\s*\([^)]*\)\s*(?:const)?\s*(?:override)?\s*\{/g,
    javascript: /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>|\w+\s*=>))|(\w+)\s*\([^)]*\)\s*\{/g,
};
//# sourceMappingURL=constants.js.map