/**
 * Carbon Footprint Estimator — Data Models
 *
 * TypeScript port of carbon_footprint_estimator.py
 * Tracks operation counts, per-function analysis, and overall results.
 *
 * Author: WattTrace
 * Date: 2026-02-18
 */

import {
  OpType,
  ALL_OP_TYPES,
  OPERATION_WEIGHTS,
  ENERGY_PER_OPERATION_JOULES,
  JOULES_PER_KWH,
  CARBON_INTENSITY_G_PER_KWH,
  ASSUMED_DAILY_USER_EXECUTIONS,
  ASSUMED_DAILY_SERVER_REQUESTS,
  SERVER_PUE,
  NETWORK_ENERGY_PER_REQUEST_J,
  DEVICE_POWER_OVERHEAD,
  DEV_ENVIRONMENT_MULTIPLIER,
} from './constants';

// =============================================================================
// OPERATION COUNT
// =============================================================================

/** Tracks counts of each operation type */
export class OperationCount {
  counts: Map<OpType, number>;

  constructor() {
    this.counts = new Map<OpType, number>();
    for (const op of ALL_OP_TYPES) {
      this.counts.set(op, 0);
    }
  }

  /** Add count for an operation type */
  add(opType: OpType, count: number = 1): void {
    this.counts.set(opType, (this.counts.get(opType) || 0) + count);
  }

  /** Merge another OperationCount into this one */
  merge(other: OperationCount): void {
    for (const [opType, count] of other.counts) {
      this.counts.set(opType, (this.counts.get(opType) || 0) + count);
    }
  }

  /** Return a new OperationCount scaled by factor (for loops) */
  scale(factor: number): OperationCount {
    const scaled = new OperationCount();
    for (const [opType, count] of this.counts) {
      scaled.counts.set(opType, count * factor);
    }
    return scaled;
  }

  /** Total weighted operation count */
  get totalWeighted(): number {
    let total = 0;
    for (const [op, count] of this.counts) {
      total += count * (OPERATION_WEIGHTS[op] || 0);
    }
    return total;
  }

  /** Total raw (unweighted) operation count */
  get totalRaw(): number {
    let total = 0;
    for (const count of this.counts.values()) {
      total += count;
    }
    return total;
  }

  /** Summary dictionary of non-zero operation counts */
  summaryDict(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [op, count] of this.counts) {
      if (count > 0) {
        result[op] = count;
      }
    }
    return result;
  }
}

// =============================================================================
// FUNCTION ANALYSIS
// =============================================================================

/** Analysis result for a single function/method */
export class FunctionAnalysis {
  name: string;
  lineNumber: number;
  operations: OperationCount;
  loopDepth: number;
  maxNesting: number;
  isRecursive: boolean;
  calls: string[];

  constructor(name: string, lineNumber: number) {
    this.name = name;
    this.lineNumber = lineNumber;
    this.operations = new OperationCount();
    this.loopDepth = 0;
    this.maxNesting = 0;
    this.isRecursive = false;
    this.calls = [];
  }

  get weightedOps(): number {
    return this.operations.totalWeighted;
  }

  get energyJoules(): number {
    return this.weightedOps * ENERGY_PER_OPERATION_JOULES;
  }

  get energyKwh(): number {
    return this.energyJoules / JOULES_PER_KWH;
  }

  get carbonGrams(): number {
    return this.energyKwh * CARBON_INTENSITY_G_PER_KWH;
  }
}

// =============================================================================
// CARBON BREAKDOWN — 3 tiers (User End / Developer End / Server Side)
// =============================================================================

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

// =============================================================================
// ANALYSIS RESULT
// =============================================================================

/** Complete analysis result for a source file */
export class AnalysisResult {
  language: string;
  filePath: string | null;
  functions: FunctionAnalysis[];
  globalOperations: OperationCount;
  assumptions: string[];

  constructor(language: string, filePath: string | null = null) {
    this.language = language;
    this.filePath = filePath;
    this.functions = [];
    this.globalOperations = new OperationCount();
    this.assumptions = [];
  }

  /** Combined operations from all functions + global scope */
  get totalOperations(): OperationCount {
    const total = new OperationCount();
    total.merge(this.globalOperations);
    for (const func of this.functions) {
      total.merge(func.operations);
    }
    return total;
  }

  get totalWeightedOps(): number {
    return this.totalOperations.totalWeighted;
  }

  get energyJoules(): number {
    return this.totalWeightedOps * ENERGY_PER_OPERATION_JOULES;
  }

  get energyKwh(): number {
    return this.energyJoules / JOULES_PER_KWH;
  }

  get carbonGrams(): number {
    return this.energyKwh * CARBON_INTENSITY_G_PER_KWH;
  }

  // ── 3-tier carbon breakdown ──────────────────────────────

  get carbonBreakdown(): CarbonBreakdown {
    const baseJ = this.energyJoules;

    // 1. User End — code running on user's device × daily executions
    const userJ = baseJ * DEVICE_POWER_OVERHEAD * ASSUMED_DAILY_USER_EXECUTIONS;
    const userCO2 = (userJ / JOULES_PER_KWH) * CARBON_INTENSITY_G_PER_KWH;

    // 2. Developer End — IDE, compilation, testing, debugging overhead
    const devJ = baseJ * DEV_ENVIRONMENT_MULTIPLIER;
    const devCO2 = (devJ / JOULES_PER_KWH) * CARBON_INTENSITY_G_PER_KWH;

    // 3. Server Side — datacenter PUE + network cost × daily requests
    const serverComputeJ = baseJ * SERVER_PUE * ASSUMED_DAILY_SERVER_REQUESTS;
    const networkJ = NETWORK_ENERGY_PER_REQUEST_J * ASSUMED_DAILY_SERVER_REQUESTS;
    const serverJ = serverComputeJ + networkJ;
    const serverCO2 = (serverJ / JOULES_PER_KWH) * CARBON_INTENSITY_G_PER_KWH;

    const totalJ = userJ + devJ + serverJ;
    const totalCO2 = userCO2 + devCO2 + serverCO2;

    return {
      userEnd: {
        label: 'User End',
        description: `${ASSUMED_DAILY_USER_EXECUTIONS.toLocaleString()} daily executions × ${DEVICE_POWER_OVERHEAD}x device overhead`,
        energyJoules: userJ,
        carbonGrams: userCO2,
      },
      developerEnd: {
        label: 'Developer End',
        description: `${DEV_ENVIRONMENT_MULTIPLIER}x dev-environment overhead (IDE, build, test)`,
        energyJoules: devJ,
        carbonGrams: devCO2,
      },
      serverSide: {
        label: 'Server Side',
        description: `${ASSUMED_DAILY_SERVER_REQUESTS.toLocaleString()} daily requests × PUE ${SERVER_PUE}`,
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
  get hotspots(): FunctionAnalysis[] {
    return [...this.functions]
      .sort((a, b) => b.weightedOps - a.weightedOps)
      .slice(0, 5);
  }

  /** Convert to a plain dictionary for JSON serialization */
  toDict(): Record<string, unknown> {
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
