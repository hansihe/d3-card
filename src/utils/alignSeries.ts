// Type Definitions
export type DataPoint = [number, number | null];
export type Series = DataPoint[];

export type InterpolationStrategy = "linear" | "previous" | "next" | "none";
export type ExtrapolationStrategy =
  | "zero"
  | "null"
  | "nearest"
  | "linear"
  | "none";

export interface AlignSeriesOptions {
  interpolation?: InterpolationStrategy;
  extrapolationBefore?: ExtrapolationStrategy;
  extrapolationAfter?: ExtrapolationStrategy;
  sortInputSeries?: boolean;
}

// Internal type for options with defaults applied
interface RequiredAlignSeriesOptions extends Required<AlignSeriesOptions> {}

// Represents a row in the final aligned table: [timestamp, value1, value2, ...]
// First element is timestamp (number), rest are series values (number | null)
export type AlignedDataRow = [number, ...(number | null)[]];
export type AlignedTable = AlignedDataRow[];

const DEFAULT_OPTIONS: RequiredAlignSeriesOptions = {
  interpolation: "previous",
  extrapolationBefore: "null",
  extrapolationAfter: "nearest",
  sortInputSeries: false,
};

/** Interpolates 'previous' (forward fill). Modifies the table in place. */
function _interpolatePrevious(
  table: AlignedTable,
  valueColIdx: number,
  firstNonNullRowIdx: number,
  lastNonNullRowIdx: number,
): void {
  let lastSeenValue: number | null = null;
  for (let i = firstNonNullRowIdx; i <= lastNonNullRowIdx; i++) {
    if (table[i][valueColIdx] !== null) {
      lastSeenValue = table[i][valueColIdx] as number;
    } else if (lastSeenValue !== null) {
      table[i][valueColIdx] = lastSeenValue;
    }
  }
}

/** Interpolates 'next' (backward fill). Modifies the table in place. */
function _interpolateNext(
  table: AlignedTable,
  valueColIdx: number,
  firstNonNullRowIdx: number,
  lastNonNullRowIdx: number,
): void {
  let nextSeenValue: number | null = null;
  for (let i = lastNonNullRowIdx; i >= firstNonNullRowIdx; i--) {
    if (table[i][valueColIdx] !== null) {
      nextSeenValue = table[i][valueColIdx] as number;
    } else if (nextSeenValue !== null) {
      table[i][valueColIdx] = nextSeenValue;
    }
  }
}

/** Interpolates 'linear'. Modifies the table in place. */
function _interpolateLinear(
  table: AlignedTable,
  valueColIdx: number,
  firstNonNullRowIdx: number,
  lastNonNullRowIdx: number,
): void {
  let prevValRowIdx = -1;
  for (let i = firstNonNullRowIdx; i <= lastNonNullRowIdx; i++) {
    if (table[i][valueColIdx] !== null) {
      const v1_val = table[i][valueColIdx] as number; // Known non-null here
      if (prevValRowIdx !== -1 && i > prevValRowIdx + 1) {
        // We have a gap to fill: table[prevValRowIdx+1...i-1]
        const t0 = table[prevValRowIdx][0];
        const v0 = table[prevValRowIdx][valueColIdx] as number; // Known non-null
        const t1 = table[i][0];
        // v1 is v1_val

        if (t1 === t0) {
          // Timestamps are identical, use v0
          for (let j = prevValRowIdx + 1; j < i; j++) {
            table[j][valueColIdx] = v0;
          }
        } else {
          for (let j = prevValRowIdx + 1; j < i; j++) {
            const t = table[j][0];
            table[j][valueColIdx] = v0 + ((v1_val - v0) * (t - t0)) / (t1 - t0);
          }
        }
      }
      prevValRowIdx = i;
    }
  }
}

/** Applies interpolation to a single series column within the table. Modifies the table in place. */
function applyInterpolation(
  table: AlignedTable,
  valueColIdx: number,
  strategy: InterpolationStrategy,
  firstNonNullRowIdx: number, // Index of the first row with non-null data for this series
  lastNonNullRowIdx: number, // Index of the last row with non-null data for this series
): void {
  if (
    strategy === "none" ||
    firstNonNullRowIdx === -1 ||
    firstNonNullRowIdx >= lastNonNullRowIdx
  ) {
    return; // No data, not enough data to interpolate, or interpolation disabled
  }

  switch (strategy) {
    case "previous":
      _interpolatePrevious(
        table,
        valueColIdx,
        firstNonNullRowIdx,
        lastNonNullRowIdx,
      );
      break;
    case "next":
      _interpolateNext(
        table,
        valueColIdx,
        firstNonNullRowIdx,
        lastNonNullRowIdx,
      );
      break;
    case "linear":
      _interpolateLinear(
        table,
        valueColIdx,
        firstNonNullRowIdx,
        lastNonNullRowIdx,
      );
      break;
  }
}

/**
 * Performs linear extrapolation for a single point. Modifies the table in place.
 * Falls back to 'nearest' if linear extrapolation is not possible (e.g., not enough points, or reference timestamps are identical).
 */
function _extrapolateLinear(
  table: AlignedTable,
  valueColIdx: number,
  targetRowIdx: number, // The row 'i' from the loop in applyExtrapolation
  isBefore: boolean,
  firstNonNullRowIdx: number, // Index of the first row with non-null data for this series (original)
  lastNonNullRowIdx: number, // Index of the last row with non-null data for this series (original)
): void {
  let t_ref1: number, v_ref1: number, t_ref2: number, v_ref2: number;
  let canAttemptLinearExtrapolation = false;

  if (isBefore) {
    // Use first two known points of the original data
    // Need at least two points: firstNonNullRowIdx and firstNonNullRowIdx + 1
    if (
      firstNonNullRowIdx + 1 <= lastNonNullRowIdx &&
      table[firstNonNullRowIdx][valueColIdx] !== null &&
      table[firstNonNullRowIdx + 1][valueColIdx] !== null
    ) {
      t_ref1 = table[firstNonNullRowIdx][0];
      v_ref1 = table[firstNonNullRowIdx][valueColIdx] as number;
      t_ref2 = table[firstNonNullRowIdx + 1][0];
      v_ref2 = table[firstNonNullRowIdx + 1][valueColIdx] as number;
      canAttemptLinearExtrapolation = true;
    }
  } else {
    // isAfter
    // Use last two known points of the original data
    // Need at least two points: lastNonNullRowIdx - 1 and lastNonNullRowIdx
    if (
      lastNonNullRowIdx - 1 >= firstNonNullRowIdx &&
      table[lastNonNullRowIdx][valueColIdx] !== null &&
      table[lastNonNullRowIdx - 1][valueColIdx] !== null
    ) {
      t_ref1 = table[lastNonNullRowIdx - 1][0];
      v_ref1 = table[lastNonNullRowIdx - 1][valueColIdx] as number;
      t_ref2 = table[lastNonNullRowIdx][0];
      v_ref2 = table[lastNonNullRowIdx][valueColIdx] as number;
      canAttemptLinearExtrapolation = true;
    }
  }

  if (canAttemptLinearExtrapolation && t_ref1! !== t_ref2!) {
    // Use ! because canAttemptLinearExtrapolation ensures they are assigned
    const t_target = table[targetRowIdx][0];
    table[targetRowIdx][valueColIdx] =
      v_ref1! +
      ((v_ref2! - v_ref1!) * (t_target - t_ref1!)) / (t_ref2! - t_ref1!);
  } else {
    // Fallback to 'nearest'
    // This fallback occurs if not enough points for linear, or if reference timestamps are identical.
    // firstNonNullRowIdx and lastNonNullRowIdx are guaranteed to be valid indices
    // because the all-null case is handled before calling this part of applyExtrapolation.
    table[targetRowIdx][valueColIdx] = isBefore
      ? table[firstNonNullRowIdx][valueColIdx]
      : table[lastNonNullRowIdx][valueColIdx];
  }
}

/** Applies extrapolation to a segment of a series column within the table. Modifies the table in place. */
function applyExtrapolation(
  table: AlignedTable,
  valueColIdx: number,
  strategy: ExtrapolationStrategy,
  isBefore: boolean, // True if extrapolating before data, false if after
  firstNonNullRowIdx: number, // Index of the first row with non-null data for this series (original)
  lastNonNullRowIdx: number, // Index of the last row with non-null data for this series (original)
): void {
  if (strategy === "none") return;

  if (firstNonNullRowIdx === -1) {
    // Series is entirely null
    if (strategy === "zero") {
      for (let i = 0; i < table.length; i++) table[i][valueColIdx] = 0;
    }
    // For 'null', 'nearest', 'linear' with all-null input, column remains all-null
    return;
  }

  // Define the range of rows to extrapolate
  const extrapolationStartRow = isBefore ? 0 : lastNonNullRowIdx + 1;
  const extrapolationEndRow = isBefore
    ? firstNonNullRowIdx - 1
    : table.length - 1;

  if (extrapolationStartRow > extrapolationEndRow) return; // No gap for extrapolation

  for (let i = extrapolationStartRow; i <= extrapolationEndRow; i++) {
    switch (strategy) {
      case "null":
        table[i][valueColIdx] = null;
        break;
      case "zero":
        table[i][valueColIdx] = 0;
        break;
      case "nearest":
        table[i][valueColIdx] = isBefore
          ? table[firstNonNullRowIdx][valueColIdx]
          : table[lastNonNullRowIdx][valueColIdx];
        break;
      case "linear":
        _extrapolateLinear(
          table,
          valueColIdx,
          i,
          isBefore,
          firstNonNullRowIdx,
          lastNonNullRowIdx,
        );
        break;
    }
  }
}

/**
 * Utility function wbich multiple time series to a common set of timestamps.
 *
 * @param seriesList - An array of time series. Can contain null/undefined series.
 * @param userOptions - Options for alignment.
 * @returns An array where each item is [timestamp, series1_value, series2_value, ...]. Timestamps are sorted.
 */
export default function alignSeries(
  seriesList: (Series | undefined | null)[],
  userOptions: AlignSeriesOptions = {},
  // Type inlined for docs
): [number, ...(number | null)[]][] {
  const options: RequiredAlignSeriesOptions = {
    ...DEFAULT_OPTIONS,
    ...userOptions,
  };

  if (!seriesList || seriesList.length === 0) {
    return [];
  }
  const numSeries = seriesList.length;

  const processedSeriesList: Series[] = seriesList.map((s) => {
    if (!s) return [] as Series;
    let seriesCopy: Series = s
      .filter(
        // Filter for basic structure and valid timestamp.
        // The type assertion `p is [number, any]` is more accurate here
        // as the value `p[1]` will be sanitized in the map step.
        (p): p is [number, any] =>
          Array.isArray(p) && p.length === 2 && typeof p[0] === "number",
      )
      .map((p): DataPoint => {
        // Sanitize p[1] to be either a number or null.
        const value = p[1];
        return [p[0], typeof value === "number" ? value : null];
      });

    if (options.sortInputSeries) {
      seriesCopy.sort((a, b) => a[0] - b[0]);
    }
    return seriesCopy;
  });

  const allTimestamps = new Set<number>();
  processedSeriesList.forEach((series) => {
    series.forEach((point) => allTimestamps.add(point[0]));
  });

  const unifiedTimestamps: number[] = Array.from(allTimestamps).sort(
    (a, b) => a - b,
  );

  if (unifiedTimestamps.length === 0) {
    return [];
  }

  const timestampToRowIndexMap = new Map<number, number>();
  unifiedTimestamps.forEach((ts, idx) => timestampToRowIndexMap.set(ts, idx));

  const alignedTable: AlignedTable = unifiedTimestamps.map((ts) => {
    const row: AlignedDataRow = [ts, ...Array(numSeries).fill(null)];
    return row;
  });

  // Phase 1: Populate exact values into alignedTable
  processedSeriesList.forEach((series, seriesIdx) => {
    const valueColumnIndex = seriesIdx + 1; // +1 because column 0 is the timestamp
    series.forEach((point) => {
      const ts = point[0];
      const value = point[1];
      const rowIndex = timestampToRowIndexMap.get(ts);
      if (rowIndex !== undefined) {
        alignedTable[rowIndex][valueColumnIndex] = value;
      }
    });
  });

  // Phase 2: Interpolate and Extrapolate column by column directly in alignedTable
  for (let seriesIdx = 0; seriesIdx < numSeries; seriesIdx++) {
    const valueColumnIndex = seriesIdx + 1;

    // Find the original extent of data for this series in the alignedTable
    let initialFirstNonNullRowIdx = -1;
    let initialLastNonNullRowIdx = -1;
    for (let i = 0; i < alignedTable.length; i++) {
      if (alignedTable[i][valueColumnIndex] !== null) {
        if (initialFirstNonNullRowIdx === -1) {
          initialFirstNonNullRowIdx = i;
        }
        initialLastNonNullRowIdx = i;
      }
    }

    // Apply Extrapolation Before
    applyExtrapolation(
      alignedTable,
      valueColumnIndex,
      options.extrapolationBefore,
      true,
      initialFirstNonNullRowIdx,
      initialLastNonNullRowIdx,
    );

    // Apply Interpolation
    applyInterpolation(
      alignedTable,
      valueColumnIndex,
      options.interpolation,
      initialFirstNonNullRowIdx,
      initialLastNonNullRowIdx,
    );

    // Apply Extrapolation After
    applyExtrapolation(
      alignedTable,
      valueColumnIndex,
      options.extrapolationAfter,
      false,
      initialFirstNonNullRowIdx,
      initialLastNonNullRowIdx,
    );
  }

  return alignedTable;
}
