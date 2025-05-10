import * as d3 from "d3";
import type { SeriesData } from "../d3-card";

export function getTimeDomain(
  dataArray: Array<SeriesData>,
  options: { timestampAccessor?: (p: any) => number } = {},
): [number, number] | undefined {
  const { timestampAccessor = (p: any) => p[0] } = options;
  let allTimestamps: number[] = [];
  dataArray.forEach((s) => {
    if (s.history) {
      s.history.forEach((p) => {
        const ts = timestampAccessor(p);
        if (typeof ts === "number" && !isNaN(ts)) {
          allTimestamps.push(ts);
        }
      });
    }
  });
  if (allTimestamps.length === 0) return undefined;
  return d3.extent(allTimestamps) as [number, number];
}

export function getValueDomain(
  dataArray: Array<SeriesData>,
  options: {
    valueAccessor?: (p: any) => any;
    includeZero?: boolean;
    paddingFactor?: number;
    minPadding?: number; // Absolute min padding
    maxPadding?: number; // Absolute max padding
  } = {},
): [number, number] | undefined {
  const {
    valueAccessor = (p: any) => p[1],
    includeZero = false,
    paddingFactor = 0.05,
    minPadding = 0,
    maxPadding = 0,
  } = options;
  let allValues: number[] = [];
  dataArray.forEach((s) => {
    if (s.history) {
      s.history.forEach((p) => {
        const val = valueAccessor(p);
        if (typeof val === "number" && !isNaN(val)) {
          allValues.push(val);
        }
      });
    }
  });

  if (allValues.length === 0) {
    // If no numeric data, return a default domain or undefined
    return includeZero ? [0, 1] : undefined;
  }

  let [minVal, maxVal] = d3.extent(allValues) as [number, number];

  if (includeZero) {
    minVal = Math.min(minVal, 0);
    maxVal = Math.max(maxVal, 0);
  }

  if (minVal === maxVal) {
    // Handle single data point case
    minVal -= minPadding || Math.abs(minVal * paddingFactor) || 1;
    maxVal += maxPadding || Math.abs(maxVal * paddingFactor) || 1;
  } else {
    const range = maxVal - minVal;
    minVal -= minPadding + range * paddingFactor;
    maxVal += maxPadding + range * paddingFactor;
  }
  return [minVal, maxVal];
}

export function createTimeScale(
  timeDomain: [number, number],
  range: [number, number],
): d3.ScaleTime<number, number, never> {
  return d3.scaleTime().domain(timeDomain).range(range);
}

export function createLinearScale(
  valueDomain: [number, number],
  range: [number, number],
): d3.ScaleLinear<number, number, never> {
  return d3.scaleLinear().domain(valueDomain).range(range);
}

export function drawXAxis(
  selection: d3.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3.ScaleTime<number, number>,
  axisOptions: {
    height?: number;
    ticks?: any;
    tickFormat?: any;
    textColor?: string;
  } = {},
) {
  const {
    height = innerHeight, // Uses calculated innerHeight
    ticks,
    tickFormat,
    textColor = "var(--primary-text-color)",
  } = axisOptions;
  const axisGenerator = d3.axisBottom(scale);
  if (ticks !== undefined) axisGenerator.ticks(ticks);
  if (tickFormat !== undefined) axisGenerator.tickFormat(tickFormat);

  selection
    .append("g")
    .attr("class", "x-axis")
    .attr("transform", `translate(0,${height})`)
    .call(axisGenerator)
    .selectAll("text")
    .style("fill", textColor);
  selection
    .selectAll(".x-axis path.domain, .x-axis .tick line")
    .style("stroke", "var(--secondary-text-color)");
}

export function drawYAxis(
  selection: d3.Selection<SVGGElement, unknown, null, undefined>,
  scale: d3.ScaleLinear<number, number>,
  axisOptions: { ticks?: any; tickFormat?: any; textColor?: string } = {},
) {
  const {
    ticks,
    tickFormat,
    textColor = "var(--primary-text-color)",
  } = axisOptions;
  const axisGenerator = d3.axisLeft(scale);
  if (ticks !== undefined) axisGenerator.ticks(ticks);
  if (tickFormat !== undefined) axisGenerator.tickFormat(tickFormat);

  selection
    .append("g")
    .attr("class", "y-axis")
    .call(axisGenerator)
    .selectAll("text")
    .style("fill", textColor);
  selection
    .selectAll(".y-axis path.domain, .y-axis .tick line")
    .style("stroke", "var(--secondary-text-color)");
}

export function createLineGenerator(
  xScale: d3.ScaleTime<number, number> | d3.ScaleLinear<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  options: {
    xAccessor?: (d: any) => number;
    yAccessor?: (d: any) => number;
    defined?: (d: any) => boolean;
  } = {},
) {
  const {
    xAccessor = (d: any) => xScale(d[0]),
    yAccessor = (d: any) => yScale(d[1]),
    defined = (d: any) => typeof d[1] === "number" && !isNaN(d[1]),
  } = options;
  return d3.line().x(xAccessor).y(yAccessor).defined(defined);
}

export function getDefaultColorScale(): d3.ScaleOrdinal<string, string, never> {
  return d3.scaleOrdinal(d3.schemeCategory10);
}

export function makeElement(
  selection: any,
  childElemType: string,
  childClass: string,
  update: Function,
) {
  selection
    .selectAll(`.${childClass}`)
    .data([null])
    .join(
      (enter) => enter.append(childElemType).attr("class", childClass),
      update,
    );
}
