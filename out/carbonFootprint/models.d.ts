/**
 * Carbon Footprint Estimator — Data Models
 *
 * TypeScript port of carbon_footprint_estimator.py
 * Tracks operation counts, per-function analysis, and overall results.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */
import { OpType } from './constants';
/** Tracks counts of each operation type */
export declare class OperationCount {
    counts: Map<OpType, number>;
    constructor();
    /** Add count for an operation type */
    add(opType: OpType, count?: number): void;
    /** Merge another OperationCount into this one */
    merge(other: OperationCount): void;
    /** Return a new OperationCount scaled by factor (for loops) */
    scale(factor: number): OperationCount;
    /** Total weighted operation count */
    get totalWeighted(): number;
    /** Total raw (unweighted) operation count */
    get totalRaw(): number;
    /** Summary dictionary of non-zero operation counts */
    summaryDict(): Record<string, number>;
}
/** Analysis result for a single function/method */
export declare class FunctionAnalysis {
    name: string;
    lineNumber: number;
    operations: OperationCount;
    loopDepth: number;
    maxNesting: number;
    isRecursive: boolean;
    calls: string[];
    constructor(name: string, lineNumber: number);
    get weightedOps(): number;
    get energyJoules(): number;
    get energyKwh(): number;
    get carbonGrams(): number;
}
/** Footprint for a single deployment tier */
export interface CategoryFootprint {
    label: string;
    description: string;
    energyJoules: number;
    carbonGrams: number;
}
/** Complete breakdown across all three tiers + combined total */
export interface CarbonBreakdown {
    userEnd: CategoryFootprint;
    developerEnd: CategoryFootprint;
    serverSide: CategoryFootprint;
    total: CategoryFootprint;
}
/** Complete analysis result for a source file */
export declare class AnalysisResult {
    language: string;
    filePath: string | null;
    functions: FunctionAnalysis[];
    globalOperations: OperationCount;
    assumptions: string[];
    constructor(language: string, filePath?: string | null);
    /** Combined operations from all functions + global scope */
    get totalOperations(): OperationCount;
    get totalWeightedOps(): number;
    get energyJoules(): number;
    get energyKwh(): number;
    get carbonGrams(): number;
    get carbonBreakdown(): CarbonBreakdown;
    /** Top 5 functions by weighted operations */
    get hotspots(): FunctionAnalysis[];
    /** Convert to a plain dictionary for JSON serialization */
    toDict(): Record<string, unknown>;
}
//# sourceMappingURL=models.d.ts.map