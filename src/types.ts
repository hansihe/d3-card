import type * as d3 from "d3";

import { Hass, HassEntityState } from "./types-hass";
import { CardConfig, SeriesConfig } from "./types-config";
import type alignSeries from "./utils/alignSeries";

/**
 * Timestamp of the sample. Represents seconds since epoch.
 *
 * To get a JS `Date` object you may do as follows:
 * ```javascript
 * new Date(timestamp * 1000)
 * ````
 */
/**
 * @category Data
 */
export type Timestamp = number;

/**
 * @category Data
 */
export type Value = number;

/**
 * An instance of this object is passed to user code for
 * each configured time series. See {@link SeriesConfig} for
 * configuration details.
 * @category Data
 */
export interface SeriesData {
  /**
   * The original configuration object specified in your yaml.
   */
  config: SeriesConfig;
  /**
   * Any values specified in the `meta` field of the series config
   * yaml. This is useful to dynamically handle series in different
   * ways in your code.
   */
  meta: Record<string, any>;
  /**
   * The current state of the entity from Home Assistant. This only
   * contains the very latest data point.
   */
  state: HassEntityState | null;
  transformedState: any | null;
  /**
   * If fetching history is configured in the {@link SeriesConfig}, then
   * this field will contain the fetched and processed history.
   */
  history: Array<[Timestamp, Value | null]> | null;
  error: string | null;
}

/**
 * Set of variables which are made available in scope
 * when the code in your `d3_code` block is executed.
 * @category Other
 */
export interface D3CodeScope {
  /**
   * The `d3` library itself.
   */
  d3: any;

  /**
   * The D3 selection containing the root `svg` element the code
   * is expected to render into.
   */
  svg: d3.Selection<SVGElement, any, SVGElement, any>;

  /**
   * This field contains the fetched and processed time series
   * according to what is configued in {@link CardConfig.series}
   */
  seriesData: SeriesData[];

  hass: Hass;

  cardConfig: CardConfig;

  size: {
    width: number;
    height: number;
  };

  /**
   * A set of useful utility functions provided by `d3-card`
   */
  utils: Utils;
}

/**
 * A set of useful utility functions provided by `d3-card`.
 */
export interface Utils {
  alignSeries: typeof alignSeries;
}
