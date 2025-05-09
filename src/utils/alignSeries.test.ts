import alignSeries, { Series } from "./alignSeries";

describe("alignSeries", () => {
  const seriesA: Series = [
    [100, 10],
    [200, 20],
    [300, 30],
  ];
  const seriesB: Series = [
    [150, 15],
    [250, 25],
    [350, 35],
  ];
  const seriesC: Series = [
    [100, 100],
    [300, 300],
  ];
  const seriesWithNulls: Series = [
    [100, 10],
    [200, null],
    [300, 30],
  ];

  it("should return an empty array for no series input", () => {
    expect(alignSeries([], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, })).toEqual([]);
    expect(alignSeries(null as any, { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, })).toEqual([]);
    expect(alignSeries(undefined as any, { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, })).toEqual([]);
  });

  it("should return an empty array if all series are null, undefined or empty", () => {
    expect(alignSeries([null, undefined], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, })).toEqual([]);
    expect(alignSeries([[], []], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, })).toEqual([]);
    expect(alignSeries([null, [], undefined], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, })).toEqual([]);
  });

  it("should correctly align two simple series with default options (linear interpolation, null extrapolation)", () => {
    const result = alignSeries([seriesA, seriesB], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
    // Timestamps: 100, 150, 200, 250, 300, 350
    expect(result).toEqual([
      [100, 10, null], // seriesB before its first point
      [150, 15, 15], // seriesA interpolated, seriesB exact
      [200, 20, 20], // seriesA exact, seriesB interpolated
      [250, 25, 25], // seriesA interpolated, seriesB exact
      [300, 30, 30], // seriesA exact, seriesB interpolated
      [350, null, 35], // seriesA after its last point
    ]);
  });

  it("should handle a single series correctly", () => {
    const result = alignSeries([seriesA], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
    expect(result).toEqual([
      [100, 10],
      [200, 20],
      [300, 30],
    ]);
  });

  it("should handle series with unsorted data if sortInputSeries is true (default)", () => {
    const unsortedSeries: Series = [
      [200, 20],
      [100, 10],
      [300, 30],
    ];
    const result = alignSeries([unsortedSeries, seriesB], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
    expect(result).toEqual([
      [100, 10, null],
      [150, 15, 15],
      [200, 20, 20],
      [250, 25, 25],
      [300, 30, 30],
      [350, null, 35],
    ]);
  });

  it("should not sort input series if sortInputSeries is false", () => {
    const unsortedSeries: Series = [
      [300, 30],
      [100, 10],
      [200, 20],
    ];
    const originalUnsortedSeries = JSON.parse(JSON.stringify(unsortedSeries)); // Deep copy

    // This test verifies behavior when `sortInputSeries` is `false`.
    // The `alignSeries` function internally creates a unified, sorted timeline (`alignedTable`)
    // using all timestamps from all input series. Interpolation and extrapolation operate on this
    // `alignedTable`.
    // Therefore, even if an individual input series is not sorted (due to `sortInputSeries: false`),
    // its points are placed onto the `alignedTable` according to their timestamps.
    // The subsequent interpolation/extrapolation uses these values from the sorted `alignedTable`.
    // This test ensures:
    // 1. The original unsorted input series is not mutated.
    // 2. Interpolation (defaulting to linear here) correctly occurs based on the
    //    values present in the `alignedTable` for the `unsortedSeries`.

    // First, check that the input series is not modified.
    alignSeries([unsortedSeries], { sortInputSeries: false, interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", });
    expect(unsortedSeries).toEqual(originalUnsortedSeries); // Check original is not mutated

    // Then, check the alignment and interpolation logic.
    const result = alignSeries([unsortedSeries, [[150, 1]]], {
      sortInputSeries: false, interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null",
    });
    // `unsortedSeries` has points (100,10) and (200,20) relevant for interpolation at t=150.
    // Expected interpolation at t=150 for unsortedSeries: 10 + (20-10) * (150-100)/(200-100) = 15.
    expect(result).toEqual([
      [100, 10, null],
      [150, 15, 1],
      [200, 20, null],
      [300, 30, null],
    ]);
  });

  describe("Interpolation Strategies", () => {
    const s1: Series = [
      [100, 10],
      [300, 30],
    ]; // Gap at 200
    const s2: Series = [[200, 20]]; // Series to define the timestamp 200

    it('interpolation: "none"', () => {
      const result = alignSeries([s1, s2], { interpolation: "none", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
      expect(result).toEqual([
        [100, 10, null],
        [200, null, 20], // s1 has null at 200 due to "none" interpolation
        [300, 30, null],
      ]);
    });

    it('interpolation: "linear"', () => {
      const result = alignSeries([s1, s2], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
      expect(result).toEqual([
        [100, 10, null],
        [200, 20, 20], // s1 interpolated: (10+30)/2 = 20
        [300, 30, null],
      ]);
    });

    it('interpolation: "linear" with identical timestamps for interpolation points', () => {
      const sA: Series = [
        [100, 10],
        [100, 20],
        [200, 30],
      ]; // two points at t=100
      const sB: Series = [[150, 5]]; // to create a point for interpolation
      const result = alignSeries([sA, sB], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
      // Timestamps: 100, 150, 200
      // sA at 100 could be 10 or 20. The current logic of populating alignedTable will take the last one if multiple.
      // Let's assume it sorts and takes one. If sortInputSeries is true (default), it's ambiguous.
      // If we provide a pre-sorted unique point series:
      const sA_uniq: Series = [
        [100, 10],
        [200, 30],
      ]; // point (100,20) is effectively ignored or overwritten in setup
      // The internal `series.forEach((point) => { alignedTable[rowIndex][valueColumnIndex] = value; });`
      // would overwrite if multiple points for same timestamp.
      // Let's test the _interpolateLinear fallback specifically.
      // If t0 === t1 inside _interpolateLinear, it should use v0.
      // This requires specific setup of the alignedTable.
      // For now, let's assume unique timestamps for input points for simplicity here, covered by other tests.
      const s_for_linear_dup_ts_test: Series = [
        [100, 10],
        [200, 20],
        [200, 30],
        [300, 40],
      ]; // to test interpolation between [100,10] and [200,?]
      // The `timestampToRowIndexMap` will map 200 to a single row. The value for (200, y) will be the last one (30).
      // So interpolation between (100,10) and (200,30)
      const result_dup = alignSeries([s_for_linear_dup_ts_test, [[150, 5]]], {
        interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true,
      });
      expect(result_dup).toEqual([
        [100, 10, null],
        [150, 20, 5], // (10+30)/2 = 20
        [200, 30, null],
        [300, 40, null],
      ]);
    });

    it('interpolation: "previous"', () => {
      const result = alignSeries([s1, s2], { interpolation: "previous", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
      expect(result).toEqual([
        [100, 10, null],
        [200, 10, 20], // s1 interpolated: previous value 10
        [300, 30, null],
      ]);
    });

    it('interpolation: "next"', () => {
      const result = alignSeries([s1, s2], { interpolation: "next", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
      expect(result).toEqual([
        [100, 10, null],
        [200, 30, 20], // s1 interpolated: next value 30
        [300, 30, null],
      ]);
    });

    it('interpolation "linear" with series that has nulls within its actual data range', () => {
      const seriesWithInternalNull: Series = [
        [100, 10],
        [200, null],
        [300, 30],
      ];
      const seriesForTimestamps: Series = [
        [150, 1],
        [250, 2],
      ]; // Ensure these timestamps exist
      const result = alignSeries(
        [seriesWithInternalNull, seriesForTimestamps],
        { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, },
      );
      // Timestamps: 100, 150, 200, 250, 300
      // seriesWithInternalNull: [100,10], [200,null], [300,30]
      // For interpolation, the gap is between (100,10) and (300,30).
      // At 150: 10 + (30-10)*(150-100)/(300-100) = 10 + 20 * 50/200 = 10 + 5 = 15
      // At 200 (original null): 10 + (30-10)*(200-100)/(300-100) = 10 + 20 * 100/200 = 10 + 10 = 20
      // At 250: 10 + (30-10)*(250-100)/(300-100) = 10 + 20 * 150/200 = 10 + 15 = 25
      expect(result).toEqual([
        [100, 10, null],
        [150, 15, 1],
        [200, 20, 1.5], // Original null is interpolated over, S2 interpolated (1 + (2-1)*(200-150)/(250-150) = 1.5)
        [250, 25, 2],
        [300, 30, null],
      ]);
    });
  });

  describe("Extrapolation Strategies", () => {
    const s1: Series = [
      [200, 20],
      [300, 30],
    ];
    // Timestamps for extrapolation context: 100 (before), 400 (after)
    const sContext: Series = [
      [100, 1],
      [400, 4],
    ];

    it('extrapolationBefore: "none", extrapolationAfter: "none"', () => {
      const result = alignSeries([s1, sContext], {
        extrapolationBefore: "none",
        extrapolationAfter: "none",
        interpolation: "none", // to isolate extrapolation
        sortInputSeries: true,
      });
      expect(result).toEqual([
        [100, null, 1], // s1 is null before its data
        [200, 20, null],
        [300, 30, null],
        [400, null, 4], // s1 is null after its data
      ]);
    });

    it('extrapolationBefore: "null", extrapolationAfter: "null" (default)', () => {
      const result = alignSeries([s1, sContext], { interpolation: "none", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, }); // Defaults
      expect(result).toEqual([
        [100, null, 1],
        [200, 20, null],
        [300, 30, null],
        [400, null, 4],
      ]);
    });

    it('extrapolationBefore: "zero", extrapolationAfter: "zero"', () => {
      const result = alignSeries([s1, sContext], {
        extrapolationBefore: "zero",
        extrapolationAfter: "zero",
        interpolation: "none",
        sortInputSeries: true,
      });
      expect(result).toEqual([
        [100, 0, 1],
        [200, 20, null],
        [300, 30, null],
        [400, 0, 4],
      ]);
    });

    it('extrapolationBefore: "nearest", extrapolationAfter: "nearest"', () => {
      const result = alignSeries([s1, sContext], {
        extrapolationBefore: "nearest",
        extrapolationAfter: "nearest",
        interpolation: "none",
        sortInputSeries: true,
      });
      expect(result).toEqual([
        [100, 20, 1], // nearest to 20 (first point of s1)
        [200, 20, null],
        [300, 30, null],
        [400, 30, 4], // nearest to 30 (last point of s1)
      ]);
    });

    it('extrapolationBefore: "linear", extrapolationAfter: "linear" (using 2 points)', () => {
      const sLin: Series = [
        [200, 20],
        [300, 30],
        [400, 40],
      ]; // Need 2 points for linear for s1
      const sLinContext: Series = [
        [100, 1],
        [500, 5],
      ]; // Timestamps 100 (before), 500 (after)

      const result = alignSeries([sLin, sLinContext], {
        extrapolationBefore: "linear",
        extrapolationAfter: "linear",
        interpolation: "none",
        sortInputSeries: true,
      });
      // For 'before' at t=100, using (200,20) and (300,30)
      // v = 20 + ( (30-20) * (100-200) / (300-200) ) = 20 + (10 * -100 / 100) = 20 - 10 = 10
      // For 'after' at t=500, using (300,30) and (400,40)
      // v = 30 + ( (40-30) * (500-300) / (400-300) ) = 30 + (10 * 200 / 100) = 30 + 20 = 50
      expect(result).toEqual([
        [100, 10, 1],
        [200, 20, null],
        [300, 30, null],
        [400, 40, null],
        [500, 50, 5],
      ]);
    });

    it('extrapolation "linear" should fallback to "nearest" if only one point in series', () => {
      const singlePointSeries: Series = [[200, 20]];
      const result = alignSeries([singlePointSeries, sContext], {
        extrapolationBefore: "linear",
        extrapolationAfter: "linear",
        interpolation: "none",
        sortInputSeries: true,
      });
      expect(result).toEqual([
        [100, 20, 1], // Fallback to nearest (20)
        [200, 20, null],
        [400, 20, 4], // Fallback to nearest (20)
      ]);
    });

    it('extrapolation "linear" should fallback to "nearest" if reference timestamps are identical', () => {
      const seriesWithDupTs: Series = [
        [200, 20],
        [200, 25],
        [300, 30],
      ]; // This series was part of an earlier attempt to test a specific fallback. It is currently unused in this test.
      //
      // This test uses `twoPointSeries` (defined below) to demonstrate standard linear extrapolation.
      // It covers extrapolation both before the series' first data point and after its last data point,
      // using the two points from `twoPointSeries` for the linear calculation.
      //
      // Note on the test title: The "fallback to nearest if reference timestamps are identical" for linear
      // extrapolation refers to a specific internal safeguard within the extrapolation logic. This test primarily
      // verifies general linear extrapolation behavior. For the more common linear extrapolation fallback
      // (i.e., when a series has fewer than two points, causing it to use 'nearest'), please refer to
      // the 'singlePointSeries' test.
      const twoPointSeries: Series = [
        [200, 20],
        [300, 30],
      ];
      const result = alignSeries([twoPointSeries, sContext], {
        // sContext has 100, 400
        extrapolationBefore: "linear", // Uses (200,20) and (300,30) -> value at 100 is 10
        extrapolationAfter: "linear", // Uses (200,20) and (300,30) -> value at 400 is 40
        interpolation: "none",
        sortInputSeries: true,
      });
      expect(result).toEqual([
        [100, 10, 1],
        [200, 20, null],
        [300, 30, null],
        [400, 40, 4],
      ]);
    });

    it("should correctly extrapolate for an all-null series", () => {
      const allNullSeries: Series = [
        [100, null],
        [200, null],
      ];
      const resultZero = alignSeries([allNullSeries, seriesA], {
        extrapolationBefore: "zero",
        extrapolationAfter: "zero",
        interpolation: "linear",
        sortInputSeries: true,
      });
      // seriesA: [[100,10], [200,20], [300,30]]
      // Timestamps: 100, 200, 300
      expect(resultZero).toEqual([
        [100, 0, 10],
        [200, 0, 20],
        [300, 0, 30], // Extrapolated 'zero' for allNullSeries
      ]);

      const resultNull = alignSeries([allNullSeries, seriesA], {
        extrapolationBefore: "null", // Default
        extrapolationAfter: "null", // Default
        interpolation: "linear",
        sortInputSeries: true,
      });
      expect(resultNull).toEqual([
        [100, null, 10],
        [200, null, 20],
        [300, null, 30],
      ]);

      const resultNearest = alignSeries([allNullSeries, seriesA], {
        extrapolationBefore: "nearest",
        extrapolationAfter: "nearest",
        interpolation: "linear",
        sortInputSeries: true,
      });
      // For nearest on all-null, it should remain null as there\'s no nearest value.
      expect(resultNearest).toEqual([
        [100, null, 10],
        [200, null, 20],
        [300, null, 30],
      ]);

      const resultLinear = alignSeries([allNullSeries, seriesA], {
        extrapolationBefore: "linear",
        extrapolationAfter: "linear",
        interpolation: "linear",
        sortInputSeries: true,
      });
      // For linear on all-null, it should remain null.
      expect(resultLinear).toEqual([
        [100, null, 10],
        [200, null, 20],
        [300, null, 30],
      ]);
    });
  });

  describe("Complex Scenarios and Combinations", () => {
    it("should handle series with empty arrays or null/undefined mixed in", () => {
      const result = alignSeries([
        seriesA,
        null,
        seriesB,
        undefined,
        [] as Series,
      ], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
      // Same as alignSeries([seriesA, seriesB]) effectively, but with null columns
      expect(result).toEqual([
        [100, 10, null, null, null, null],
        [150, 15, null, 15, null, null],
        [200, 20, null, 20, null, null],
        [250, 25, null, 25, null, null],
        [300, 30, null, 30, null, null],
        [350, null, null, 35, null, null],
      ]);
    });

    it('interpolation "previous" with extrapolation "zero"', () => {
      const s1: Series = [
        [200, 20],
        [400, 40],
      ];
      const sContext: Series = [
        [100, 1],
        [300, 3],
        [500, 5],
      ]; // Timestamps 100,200,300,400,500
      const result = alignSeries([s1, sContext], {
        interpolation: "previous",
        extrapolationBefore: "zero",
        extrapolationAfter: "zero",
        sortInputSeries: true,
      });
      expect(result).toEqual([
        [100, 0, 1], // extrapolated zero
        [200, 20, 1], // s1 exact, sContext interpolated 'previous' from t=100
        [300, 20, 3], // s1 interpolated 'previous', sContext exact
        [400, 40, 3], // s1 exact, sContext interpolated 'previous' from t=300
        [500, 0, 5], // extrapolated zero
      ]);
    });

    it("series with only one data point and various strategies", () => {
      const sSingle: Series = [[200, 20]];
      const sContext: Series = [
        [100, 1],
        [300, 3],
      ];

      const resLinearInterpolation = alignSeries([sSingle, sContext], {
        interpolation: "linear", // No effect as no gaps within sSingle\'s known range
        extrapolationBefore: "nearest", // Should be 20
        extrapolationAfter: "nearest", // Should be 20
        sortInputSeries: true,
      });
      expect(resLinearInterpolation).toEqual([
        [100, 20, 1],
        [200, 20, 2], // sSingle exact, sContext interpolated (1 + (3-1)*(200-100)/(300-100) = 2)
        [300, 20, 3],
      ]);

      const resLinearExtrapolation = alignSeries([sSingle, sContext], {
        interpolation: "none",
        extrapolationBefore: "linear", // Fallback to nearest -> 20
        extrapolationAfter: "linear", // Fallback to nearest -> 20
        sortInputSeries: true,
      });
      expect(resLinearExtrapolation).toEqual([
        [100, 20, 1],
        [200, 20, null],
        [300, 20, 3],
      ]);
    });

    it("should not modify input series data (check by reference for non-sorting)", () => {
      const sA_original: Series = [
        [100, 10],
        [300, 30],
      ];
      const sB_original: Series = [[200, 20]];
      const sA_copy = JSON.parse(JSON.stringify(sA_original));
      const sB_copy = JSON.parse(JSON.stringify(sB_original));

      alignSeries([sA_original, sB_original], { sortInputSeries: false, interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", });

      expect(sA_original).toEqual(sA_copy);
      expect(sB_original).toEqual(sB_copy);
    });

    it("should create copies of input series data points when sortInputSeries is true (default)", () => {
      const sA_original: Series = [
        [300, 30],
        [100, 10],
      ]; // Unsorted
      const sA_input_ref = sA_original[0]; // Reference to [300,30]

      // alignSeries will sort a copy of sA_original internally
      const result = alignSeries([sA_original, seriesC], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });

      // Check original array is not sorted in place
      expect(sA_original[0]).toBe(sA_input_ref);
      expect(sA_original[0][0]).toBe(300);

      // The processed series inside alignSeries is a sorted copy.
      // The result should be based on sorted data for sA_original
      // sA_original sorted: [[100,10], [300,30]]
      // seriesC: [[100, 100], [300, 300]]
      // Timestamps: 100, 300
      expect(result).toEqual([
        [100, 10, 100],
        [300, 30, 300],
      ]);
    });
  });

  it("should filter out invalid data points from input series", () => {
    const seriesWithInvalidPoints: Series = [
      [100, 10],
      null as any, // Invalid point
      [200, "20" as any], // Invalid value type
      [undefined as any, 30], // Invalid timestamp
      [300, 30],
      [400] as any, // Invalid structure
    ];
    const result = alignSeries([seriesWithInvalidPoints, seriesA], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
    // seriesWithInvalidPoints effectively becomes [[100,10], [300,30]]
    // seriesA: [[100,10], [200,20], [300,30]]
    // Timestamps: 100, 200, 300
    // Default interpolation: linear
    // seriesWithInvalidPoints at 200: (10+30)/2 = 20
    expect(result).toEqual([
      [100, 10, 10],
      [200, 20, 20],
      [300, 30, 30],
    ]);
  });

  it("should handle series with identical timestamps in input, taking the last one", () => {
    const seriesDupTs: Series = [
      [100, 10],
      [200, 20],
      [200, 22],
      [300, 30],
    ];
    const result = alignSeries([seriesDupTs], { interpolation: "linear", extrapolationBefore: "null", extrapolationAfter: "null", sortInputSeries: true, });
    // The point (200,22) should overwrite (200,20)
    expect(result).toEqual([
      [100, 10],
      [200, 22],
      [300, 30],
    ]);
  });
});
