export interface D3CardConfig {
  title: string;
  height: string;
  series: D3CardSeriesConfig[];
  d3_code: string;
  use_compression?: boolean; // Global setting for cache compression
  // Add other config properties here
}

interface D3CardSeriesConfigBase {
  meta?: Record<string, any>;
  fetch_history?: {
    span: string; // e.g., "24h", "7d"
  };
  transform?: string; // User-defined JS transform string
  attribute?: string; // Attribute to plot instead of state
  cache_history?: boolean; // Whether to use GraphEntry caching for this series
  group_by?: D3CardSeriesConfigGroupBy; // Optional: if user wants to specify grouping
  statistics?: D3CardSeriesConfigStatistics; // Optional: if user wants to fetch HA statistics
  // other d3-card specific series properties can be added here
}

// Define the structure for series configuration within D3Card
export interface D3CardSeriesConfigEntity extends D3CardSeriesConfigBase {
  entity: string;
  filter: never;
}

interface D3CardSeriesConfigFilter extends D3CardSeriesConfigBase {
  entity: never;
  filter: Filter;
}

export type D3CardSeriesConfig = D3CardSeriesConfigEntity;
// | D3CardSeriesConfigFilter;

interface Filter {
  //template: string;
  include?: FilterEntry[];
  exclude?: FilterEntry[];
}

interface FilterEntry {
  entity_id?: string;
  label?: string;
}

export interface D3CardLayoutConfig {
  margin?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

export interface D3CardSeriesConfigGroupBy {
  func:
    | "raw"
    | "avg"
    | "max"
    | "min"
    | "first"
    | "last"
    | "sum"
    | "median"
    | "delta"
    | "diff";
  duration: string;
  fill?: "null" | "last" | "zero";
}

export interface D3CardSeriesConfigStatistics {
  type: "mean" | "min" | "max" | "sum" | "state"; // Add others if needed
  period: "5minute" | "hour" | "day" | "week" | "month";
  align?: "start" | "middle" | "end";
}
