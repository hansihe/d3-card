import type { D3CodeScope } from "./types";

/**
 * This interface represents the keys you can pass to the top level
 * card config yaml.
 * @category none
 */
export interface CardConfig {
  /**
   * Title of the card in the Home Assistant UI.
   */
  title: string;
  /**
   * Height of the card in the Home Assistant UI.
   *
   * Example: `250px`
   */
  height: string;
  /**
   * Contifugres which entities + data histories should be fetched from
   * Home Assistant and be made available to your D3 code.
   */
  series: SeriesConfig[];
  /**
   * String containing JS code which to executed to render your D3 card.
   * All fields specified in {@link D3CodeScope} are available in
   * scope when this code is executed.
   */
  d3_code: string;
  use_compression?: boolean; // Global setting for cache compression
  // Add other config properties here
}

/**
 * @category Config
 */
export interface SeriesConfig {
  /**
   * Specifies a single entity ID which will be fetched as a series.
   */
  entity?: string;

  /**
   * Specifies several entitiy IDs which will be fetched as series.
   *
   * This will result in multiple `SeriesData` being made available
   * to `d3_code`, one for each specified entity.
   */
  entities?: string[];

  /**
   * Specifies dynamic filtering which will be expanded into zero
   * or more entity IDs.
   *
   * This will result in multiple `SeriesData` being made available
   * to `d3_code`, one for each specified entity.
   */
  filter?: Filter;

  meta?: Record<string, any>;
  fetch_history?: {
    span: string; // e.g., "24h", "7d"
  };
  transform?: string; // User-defined JS transform string
  attribute?: string; // Attribute to plot instead of state
  cache_history?: boolean; // Whether to use GraphEntry caching for this series
  group_by?: SeriesConfigGroupBy; // Optional: if user wants to specify grouping
  statistics?: SeriesConfigStatistics; // Optional: if user wants to fetch HA statistics
}

/**
 * @category Config
 */
export interface Filter {
  //template: string;
  include?: FilterEntry[];
  exclude?: FilterEntry[];
}

/**
 * @category Config
 * @strict
 */
export interface FilterEntry {
  domain?: string;
  entity_id?: string;
  state?: string;
  name?: string;
  group?: string;
  label?: string;

  area?: string;
  device?: string;
  device_manufacturer?: string;
  device_model?: string;

  attributes?: Record<string, string>;

  last_changed?: string | number;
  last_updated?: string | number;
  last_triggered?: string | number;

  entity_category?: string;
  integration?: string;
  hidden_by?: string;

  not?: FilterEntry;
  or?: FilterEntry[];

  type?: string;
}

/**
 * @category Config
 */
export interface LayoutConfig {
  margin?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

/**
 * @category Config
 */
export interface SeriesConfigGroupBy {
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

/**
 * @category Config
 */
export interface SeriesConfigStatistics {
  type: "mean" | "min" | "max" | "sum" | "state"; // Add others if needed
  period: "5minute" | "hour" | "day" | "week" | "month";
  align?: "start" | "middle" | "end";
}
