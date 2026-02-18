"use strict";
/**
 * Carbon Footprint Estimator — Data Models
 *
 * TypeScript port of carbon_footprint_estimator.py
 * Tracks operation counts, per-function analysis, and overall results.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalysisResult = exports.FunctionAnalysis = exports.OperationCount = void 0;
const constants_1 = require("./constants");
// =============================================================================
// OPERATION COUNT
// =============================================================================
/** Tracks counts of each operation type */
class OperationCount {
    counts;
    constructor() {
        this.counts = new Map();
        for (const op of constants_1.ALL_OP_TYPES) {
            this.counts.set(op, 0);
        }
    }
    /** Add count for an operation type */
    add(opType, count = 1) {
        this.counts.set(opType, (this.counts.get(opType) || 0) + count);
    }
    /** Merge another OperationCount into this one */
    merge(other) {
        for (const [opType, count] of other.counts) {
            this.counts.set(opType, (this.counts.get(opType) || 0) + count);
        }
    }
    /** Return a new OperationCount scaled by factor (for loops) */
    scale(factor) {
        const scaled = new OperationCount();
        for (const [opType, count] of this.counts) {
            scaled.counts.set(opType, count * factor);
        }
        return scaled;
    }
    /** Total weighted operation count */
    get totalWeighted() {
        let total = 0;
        for (const [op, count] of this.counts) {
            total += count * (constants_1.OPERATION_WEIGHTS[op] || 0);
        }
        return total;
    }
    /** Total raw (unweighted) operation count */
    get totalRaw() {
        let total = 0;
        for (const count of this.counts.values()) {
            total += count;
        }
        return total;
    }
    /** Summary dictionary of non-zero operation counts */
    summaryDict() {
        const result = {};
        for (const [op, count] of this.counts) {
            if (count > 0) {
                result[op] = count;
            }
        }
        return result;
    }
}
exports.OperationCount = OperationCount;
// =============================================================================
// FUNCTION ANALYSIS
// =============================================================================
/** Analysis result for a single function/method */
class FunctionAnalysis {
    name;
    lineNumber;
    operations;
    loopDepth;
    maxNesting;
    isRecursive;
    calls;
    constructor(name, lineNumber) {
        this.name = name;
        this.lineNumber = lineNumber;
        this.operations = new OperationCount();
        this.loopDepth = 0;
        this.maxNesting = 0;
        this.isRecursive = false;
        this.calls = [];
    }
    get weightedOps() {
        return this.operations.totalWeighted;
    }
    get energyJoules() {
        return this.weightedOps * constants_1.ENERGY_PER_OPERATION_JOULES;
    }
    get energyKwh() {
        return this.energyJoules / constants_1.JOULES_PER_KWH;
    }
    get carbonGrams() {
        return this.energyKwh * constants_1.CARBON_INTENSITY_G_PER_KWH;
    }
}
exports.FunctionAnalysis = FunctionAnalysis;
// =============================================================================
// ANALYSIS RESULT
// =============================================================================
/** Complete analysis result for a source file */
class AnalysisResult {
    language;
    filePath;
    functions;
    globalOperations;
    assumptions;
    constructor(language, filePath = null) {
        this.language = language;
        this.filePath = filePath;
        this.functions = [];
        this.globalOperations = new OperationCount();
        this.assumptions = [];
    }
    /** Combined operations from all functions + global scope */
    get totalOperations() {
        const total = new OperationCount();
        total.merge(this.globalOperations);
        for (const func of this.functions) {
            total.merge(func.operations);
        }
        return total;
    }
    get totalWeightedOps() {
        return this.totalOperations.totalWeighted;
    }
    get energyJoules() {
        return this.totalWeightedOps * constants_1.ENERGY_PER_OPERATION_JOULES;
    }
    get energyKwh() {
        return this.energyJoules / constants_1.JOULES_PER_KWH;
    }
    get carbonGrams() {
        return this.energyKwh * constants_1.CARBON_INTENSITY_G_PER_KWH;
    }
    // ── 3-tier carbon breakdown ──────────────────────────────
    get carbonBreakdown() {
        const baseJ = this.energyJoules;
        // 1. User End — code running on user's device × daily executions
        const userJ = baseJ * constants_1.DEVICE_POWER_OVERHEAD * constants_1.ASSUMED_DAILY_USER_EXECUTIONS;
        const userCO2 = (userJ / constants_1.JOULES_PER_KWH) * constants_1.CARBON_INTENSITY_G_PER_KWH;
        // 2. Developer End — IDE, compilation, testing, debugging overhead
        const devJ = baseJ * constants_1.DEV_ENVIRONMENT_MULTIPLIER;
        const devCO2 = (devJ / constants_1.JOULES_PER_KWH) * constants_1.CARBON_INTENSITY_G_PER_KWH;
        // 3. Server Side — datacenter PUE + network cost × daily requests
        const serverComputeJ = baseJ * constants_1.SERVER_PUE * constants_1.ASSUMED_DAILY_SERVER_REQUESTS;
        const networkJ = constants_1.NETWORK_ENERGY_PER_REQUEST_J * constants_1.ASSUMED_DAILY_SERVER_REQUESTS;
        const serverJ = serverComputeJ + networkJ;
        const serverCO2 = (serverJ / constants_1.JOULES_PER_KWH) * constants_1.CARBON_INTENSITY_G_PER_KWH;
        const totalJ = userJ + devJ + serverJ;
        const totalCO2 = userCO2 + devCO2 + serverCO2;
        return {
            userEnd: {
                label: 'User End',
                description: `${constants_1.ASSUMED_DAILY_USER_EXECUTIONS.toLocaleString()} daily executions × ${constants_1.DEVICE_POWER_OVERHEAD}x device overhead`,
                energyJoules: userJ,
                carbonGrams: userCO2,
            },
            developerEnd: {
                label: 'Developer End',
                description: `${constants_1.DEV_ENVIRONMENT_MULTIPLIER}x dev-environment overhead (IDE, build, test)`,
                energyJoules: devJ,
                carbonGrams: devCO2,
            },
            serverSide: {
                label: 'Server Side',
                description: `${constants_1.ASSUMED_DAILY_SERVER_REQUESTS.toLocaleString()} daily requests × PUE ${constants_1.SERVER_PUE}`,
                energyJoules: serverJ,
                carbonGrams: serverCO2,
            },
            total: {
                label: 'Total',
                description: 'Combined daily carbon footprint across all tiers',
                energyJoules: totalJ,
                carbonGrams: totalCO2,
            },
        };
    }
    /** Top 5 functions by weighted operations */
    get hotspots() {
        return [...this.functions]
            .sort((a, b) => b.weightedOps - a.weightedOps)
            .slice(0, 5);
    }
    /** Convert to a plain dictionary for JSON serialization */
    toDict() {
        return {
            language: this.language,
            file_path: this.filePath,
            total_operations: this.totalOperations.summaryDict(),
            total_weighted_operations: this.totalWeightedOps,
            energy_joules: this.energyJoules,
            energy_kWh: this.energyKwh,
            carbon_grams_CO2: this.carbonGrams,
            functions: this.functions.map((f) => ({
                name: f.name,
                line: f.lineNumber,
                weighted_ops: f.weightedOps,
                energy_joules: f.energyJoules,
                carbon_grams_CO2: f.carbonGrams,
                is_recursive: f.isRecursive,
                max_loop_nesting: f.maxNesting,
                operations: f.operations.summaryDict(),
            })),
            hotspot_functions: this.hotspots.map((f) => ({
                name: f.name,
                weighted_ops: f.weightedOps,
                percentage: this.totalWeightedOps > 0
                    ? Math.round((f.weightedOps / this.totalWeightedOps) * 10000) / 100
                    : 0,
            })),
            assumptions: this.assumptions,
        };
    }
}
exports.AnalysisResult = AnalysisResult;
//# sourceMappingURL=models.js.map