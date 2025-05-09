// External Libs
import localforage from "localforage";
import SparkMD5 from "spark-md5";
import moment from "moment";
import { extendMoment, DateRange } from "moment-range";

const momentExtended = extendMoment(moment);

import parseDuration from "parse-duration";
import { deflate as pakoCompress, inflate as pakoDecompress } from "pako";
import {
  D3CardSeriesConfigGroupBy,
  D3CardSeriesConfigStatistics,
} from "./types-config";

// Type definitions

interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
  context: {
    id: string;
    parent_id?: string;
    user_id?: string;
  };
}

interface HomeAssistant {
  states: Record<string, HassEntity>;
  callWS: <T>(options: { type: string; [key: string]: any }) => Promise<T>;
  // Potentially more, like subscribeMessage, callService etc.
}

export interface ChartCardSeriesConfig {
  entity: string;
  meta?: Record<string, any>;
  attribute?: string;
  name?: string;
  type?: "line" | "area"; // Simplified
  transform?: string;
  unit_of_measurement?: string;
  group_by: D3CardSeriesConfigGroupBy;
  statistics?: D3CardSeriesConfigStatistics;
  fill_raw?: "null" | "last" | "zero";
  data_generator?: string;
  ignore_history?: boolean;
  // For d3-card, we might add a specific cache toggle here
  cache?: boolean;
}

interface ChartCardSpanExtConfig {
  // Not deeply used by GraphEntry itself beyond MD5 key, so simplified
  [key: string]: any;
}

type EntityCachePoint = [number, number | null];
type EntityCachePoints = EntityCachePoint[];

interface EntityEntryCache {
  span: number;
  last_fetched: Date;
  data: EntityCachePoints;
}

interface HistoryState {
  // Matches structure from hass.callWS('history/history_during_period')
  // with minimal_response: false, no_attributes: false
  s: string; // state
  lu: number; // last_updated, unix timestamp in seconds
  lc: number; // last_changed, unix timestamp in seconds
  a: Record<string, any>; // attributes
}

interface StatisticValue {
  // Structure from hass.callWS('recorder/get_statistics_during_period')
  start: string; // ISO date string
  end: string; // ISO date string
  mean?: number;
  min?: number;
  max?: number;
  sum?: number;
  state?: number;
  // ... other possible statistic values
  [key: string]: any;
}

const DEFAULT_STATISTICS_TYPE: keyof StatisticValue = "mean";

function compress(data: any): string {
  try {
    const jsonString = JSON.stringify(data);
    return pakoCompress(jsonString, { to: "string" }) as any;
  } catch (e) {
    throw e;
  }
}

function decompress(compressedData: any): any {
  try {
    const decompressed = pakoDecompress(compressedData, { to: "string" });
    return JSON.parse(decompressed);
  } catch (e) {
    // If it's not a JSON string (e.g. raw string was compressed)
    // return pakoDecompress(compressedData, { to: 'string' });
    throw e;
  }
}

/**
 * Manages the fetching, caching, processing, and provision of historical data for a single entity
 * or data series within a chart. It's designed to work with Home Assistant, retrieving
 * state history or long-term statistics.
 *
 * Features:
 * - Fetches data from Home Assistant (state history via `history/history_during_period` or
 *   statistics via `recorder/get_statistics_during_period`).
 * - Supports custom data generation via a user-provided `data_generator` function.
 * - Caches fetched data in `localforage` to minimize API calls and improve performance,
 *   with optional GZip compression. Cache keys are based on entity ID, graph span, and
 *   relevant configuration to ensure data integrity.
 * - Applies data transformations (e.g., selecting an `attribute`, applying a JS `transform` function).
 * - Performs data aggregation based on `group_by` configuration (e.g., `avg`, `max`, `min`, `sum`,
 *   `median`, `delta`, `diff`, `first`, `last`) over specified time durations.
 * - Handles missing data points with `fill_raw` strategies (`last`, `zero`, `null`).
 *
 * Lifecycle:
 * 1. **Instantiation (`constructor`)**: An instance is created with specific configuration for a data series.
 *    This includes the entity ID, desired graph time span, caching preferences, aggregation rules,
 *    and any transformation logic. An MD5 hash of critical configuration parts is generated for
 *    unique cache keying.
 * 2. **Home Assistant Injection (`hass` setter)**: The Home Assistant connection object (`hass`)
 *    must be provided to the instance. This enables the `GraphEntry` to make API calls.
 *    This is typically done once after instantiation or if the `hass` object is refreshed.
 * 3. **Data Update (`updateHistory(start, end)`)**: This asynchronous method is called to fetch or
 *    refresh the data for a specified time window (`start` to `end`).
 *    - It first checks for an existing update in progress to prevent concurrent modifications.
 *    - If a `data_generator` is configured, it's invoked.
 *    - Otherwise, it attempts to load relevant data from the cache (`_getCache`).
 *    - It calculates the time range for which new data is required by comparing the requested
 *      window with the available cached data.
 *    - New data is fetched from Home Assistant (either statistics via `_fetchStatistics` or
 *      state history via `_fetchRecent`).
 *    - The newly fetched data is merged with existing cached data.
 *    - If caching is enabled, the updated dataset is stored back in the cache (`_setCache`).
 *    - The raw data undergoes transformation (`_applyTransform`) and fill logic (`_transformAndFill`).
 *    - If aggregation is configured (`group_by.func !== 'raw'`), the data is bucketed (`_dataBucketer`)
 *      and the specified aggregation function (`this._func`) is applied to each bucket.
 *    - The final processed data, filtered to the precise `start` and `end` window, is stored in
 *      the private `_computedHistory` property.
 * 4. **Data Access (`history` getter)**: The processed historical data (`_computedHistory`) is made
 *    available for rendering by the chart.
 * 5. **Current Value Access (`nowValue()`):** Optionally, the current transformed state of the
 *    entity can be retrieved, which is useful for displaying a live value alongside the graph.
 */
export class GraphEntry {
  private _computedHistory: EntityCachePoints | undefined;
  private _hass!: HomeAssistant; // Ensure hass is set before use
  private _entityID: string;
  private _entityState: HassEntity | undefined;
  private _updating = false;
  private _cache: boolean; // Whether to use caching for this series
  private _useCompress: boolean; // Whether to compress cached data
  private _graphSpan: number; // Duration in ms for the graph
  private _index: number;
  private _config: ChartCardSeriesConfig;
  private _func: (data: (number | null)[]) => number | null;
  private _realStart!: Date;
  private _realEnd!: Date;
  private _groupByDurationMs: number;
  private _md5Config: string;

  constructor(
    index: number,
    graphSpan: number, // Expected in ms
    useCacheForSeries: boolean,
    config: ChartCardSeriesConfig,
    spanConfigForMD5: ChartCardSpanExtConfig | undefined, // For MD5 uniqueness
    useCompress = false, // Default compression to false
  ) {
    const aggregateFuncMap = {
      avg: this._average.bind(this),
      max: this._maximum.bind(this),
      min: this._minimum.bind(this),
      first: this._first.bind(this),
      last: this._last.bind(this),
      sum: this._sum.bind(this),
      median: this._median.bind(this),
      delta: this._delta.bind(this),
      diff: this._diff.bind(this),
      raw: () => null, // Raw doesn't use this path for aggregation
    };
    this._index = index;
    // Statistics are fetched on demand and not cached by this class's mechanism
    // as HA's recorder already pre-aggregates them.
    this._cache = config.statistics ? false : useCacheForSeries;
    this._useCompress = useCompress;
    this._entityID = config.entity;
    this._graphSpan = graphSpan;
    this._config = config;
    this._func = aggregateFuncMap[config.group_by.func];

    const duration = parseDuration(this._config.group_by.duration);
    if (duration === null || duration === undefined) {
      this._groupByDurationMs = 60000; // Default to 1 minute if parse fails
    } else {
      this._groupByDurationMs = duration;
    }

    // Create a stable string for MD5 hashing from relevant config parts
    const configForHash = {
      entity: config.entity,
      attribute: config.attribute,
      transform: config.transform,
      group_by_func: config.group_by.func,
      group_by_duration: config.group_by.duration,
      statistics_type: config.statistics?.type,
      statistics_period: config.statistics?.period,
      // Add other critical config that affects data shape
    };
    this._md5Config = SparkMD5.hash(
      `${this._graphSpan}${JSON.stringify(configForHash)}${JSON.stringify(
        spanConfigForMD5,
      )}`,
    );
  }

  set hass(hassInstance: HomeAssistant) {
    this._hass = hassInstance;
    this._entityState = hassInstance.states[this._entityID];
  }

  get history(): EntityCachePoints | undefined {
    return this._computedHistory;
  }

  get index(): number {
    return this._index;
  }

  get start(): Date {
    return this._realStart;
  }

  get end(): Date {
    return this._realEnd;
  }

  // cache setter not typically needed if set via constructor
  // set cache(val: boolean) { this._cache = val; }

  get lastState(): HassEntity | undefined {
    return this._entityState;
  }

  public nowValue(): number | null {
    if (!this._entityState) return null;
    let state: any;
    if (this._config.attribute) {
      state = this._entityState.attributes[this._config.attribute as string];
    } else {
      state = this._entityState.state;
    }
    if (this._config.transform) {
      state = this._applyTransform(state, this._entityState);
    }
    const val = parseFloat(state);
    return Number.isNaN(val) ? null : val;
  }

  // Min/max functions on _computedHistory (can be added if needed)

  private async _getCache(
    key: string,
    compressed: boolean,
  ): Promise<EntityEntryCache | undefined> {
    try {
      const cacheKey = `${key}_${this._md5Config}${
        compressed ? "-comp" : "-raw"
      }`;
      const data: EntityEntryCache | undefined | null =
        await localforage.getItem(cacheKey);
      if (data) {
        // Dates are stringified in JSON, convert back
        data.last_fetched = new Date(data.last_fetched);
        return compressed ? decompress(data) : data;
      }
    } catch (e) {}
    return undefined;
  }

  private async _setCache(
    key: string,
    data: EntityEntryCache,
    compressed: boolean,
  ): Promise<any> {
    try {
      const cacheKey = `${key}_${this._md5Config}${
        compressed ? "-comp" : "-raw"
      }`;
      return compressed
        ? localforage.setItem(cacheKey, compress(data))
        : localforage.setItem(cacheKey, data);
    } catch (e) {
      // Potentially clear cache if it's full or corrupted
      // localForage.removeItem(cacheKey);
      throw e; // rethrow for _updateHistory to catch
    }
  }

  public async updateHistory(start: Date, end: Date): Promise<boolean> {
    if (!this._hass) {
      return false;
    }
    this._entityState = this._hass.states[this._entityID]; // Refresh entity state

    let startHistory = new Date(start);
    if (this._config.group_by.func !== "raw") {
      const range = end.getTime() - start.getTime();
      const nbBuckets =
        Math.floor(range / this._groupByDurationMs) +
        (range % this._groupByDurationMs > 0 ? 1 : 0);
      startHistory = new Date(
        end.getTime() - (nbBuckets + 1) * this._groupByDurationMs,
      );
    }

    if (!this._entityState && !this._config.data_generator) {
      // Allow data_generator to run without entity
      this._updating = false;
      this._computedHistory = undefined;
      return false;
    }
    if (this._updating) {
      return false;
    }
    this._updating = true;

    if (this._config.ignore_history && this._entityState) {
      let currentState: any = null;
      if (this._config.attribute) {
        currentState = this._entityState.attributes?.[this._config.attribute];
      } else {
        currentState = this._entityState.state;
      }
      if (this._config.transform) {
        currentState = this._applyTransform(currentState, this._entityState);
      }
      let stateParsed: number | null = parseFloat(currentState as string);
      stateParsed = !Number.isNaN(stateParsed) ? stateParsed : null;
      this._computedHistory = [
        [new Date(this._entityState.last_updated).getTime(), stateParsed],
      ];
      this._updating = false;
      return true;
    }

    let history: EntityEntryCache | undefined = undefined;

    if (this._config.data_generator) {
      const generated = await this._generateData(start, end);
      if (generated) {
        history = {
          data: generated,
          span: this._graphSpan,
          last_fetched: new Date(),
        };
      }
    } else {
      this._realStart = new Date(start); // Use the requested start for fetching
      this._realEnd = new Date(end);

      let skipInitialState = false; // For fetchRecent if needed

      if (this._cache) {
        history = await this._getCache(this._entityID, this._useCompress);
      }

      if (history && history.span !== this._graphSpan) {
        // Invalidate cache if graph span changed
        history = undefined;
      }

      if (history?.data) {
        let firstPointStr = "N/A (empty cache array)";
        let lastPointStr = "N/A (empty cache array)";
        if (history.data.length > 0) {
          const firstTimestamp = history.data[0]
            ? history.data[0][0]
            : "undefined";
          const lastTimestamp = history.data[history.data.length - 1]
            ? history.data[history.data.length - 1][0]
            : "undefined";

          let firstISO = "Invalid/Error";
          if (typeof firstTimestamp === "number") {
            try {
              firstISO = new Date(firstTimestamp).toISOString();
            } catch (e) {
              firstISO = `Error: ${(e as Error).message}`;
            }
          } else {
            firstISO = "Not a number";
          }

          let lastISO = "Invalid/Error";
          if (typeof lastTimestamp === "number") {
            try {
              lastISO = new Date(lastTimestamp).toISOString();
            } catch (e) {
              lastISO = `Error: ${(e as Error).message}`;
            }
          } else {
            lastISO = "Not a number";
          }
          firstPointStr = `Raw: ${firstTimestamp}, ISO: ${firstISO}`;
          lastPointStr = `Raw: ${lastTimestamp}, ISO: ${lastISO}`;
        }
        // Filter cache to be roughly within the new overall window + a bit before
        const currentWindowStart = startHistory.getTime();
        const firstCachePointTime =
          history.data.length > 0 ? history.data[0][0] : 0;

        // If cache starts way before requested window, trim it
        // Keep some data before the window for continuity (e.g., 4 points or a fraction of groupByDuration)
        const lookBehind =
          this._config.group_by.func === "raw"
            ? 4
            : Math.max(4, this._groupByDurationMs * 2);
        const relevantCacheStartIndex = history.data.findIndex(
          (item) => item && item[0] >= currentWindowStart - lookBehind,
        );

        if (relevantCacheStartIndex > 0) {
          history.data = history.data.slice(relevantCacheStartIndex);
        } else if (
          relevantCacheStartIndex === -1 &&
          firstCachePointTime < currentWindowStart - lookBehind
        ) {
          // All cache data is too old
          history.data = [];
        }
      } else {
        history = undefined; // Ensure history is undefined if no valid data
      }

      const usableCache = !!(
        history?.data?.length && history.data[history.data.length - 1]
      );

      // If data in cache, get data from last data's time + 1ms
      // For statistics, align fetchStart to period boundaries if possible, or let HA handle it.
      const fetchStart = usableCache
        ? new Date(history!.data[history!.data.length - 1][0] + 1)
        : new Date(
            startHistory.getTime() +
              (this._config.group_by.func !== "raw" && !this._config.statistics
                ? 0
                : -1),
          ); // -1 for raw to get state right before window

      const fetchEnd = new Date(end); // Use requested end time

      let newStateHistory: EntityCachePoints = [];
      let newHistoryDataFetched = false;

      if (fetchStart < fetchEnd) {
        // Only fetch if there's a time range to fetch
        if (this._config.statistics && this._entityState) {
          // Statistics need an entity
          const fetchedStats = await this._fetchStatistics(
            fetchStart,
            fetchEnd,
            this._config.statistics.period,
          );
          if (fetchedStats && fetchedStats.length > 0) {
            newHistoryDataFetched = true;
            let lastNonNullStatValue: number | null = usableCache
              ? history!.data[history!.data.length - 1][1]
              : null;
            newStateHistory = fetchedStats.map((item) => {
              let statValueForTransform: number | string | null | undefined =
                item[this._config.statistics!.type || DEFAULT_STATISTICS_TYPE];

              let transformedVal: number | null;
              // _transformAndFill expects the raw state, then the full item, then last valid number
              // For stats, the 'item' is the stat object itself.
              [lastNonNullStatValue, transformedVal] = this._transformAndFill(
                statValueForTransform,
                item, // pass the stat item as context
                lastNonNullStatValue,
              );

              let displayDate: Date | null = null;
              const statStartDate = new Date(item.start);
              const align = this._config.statistics?.align || "middle";
              const periodMs =
                parseDuration(
                  this._config.statistics!.period === "5minute"
                    ? "5m"
                    : this._config.statistics!.period,
                ) || 3600000;

              if (align === "middle") {
                displayDate = new Date(statStartDate.getTime() + periodMs / 2);
              } else if (align === "start") {
                displayDate = statStartDate;
              } else {
                // end
                displayDate = new Date(item.end);
              }
              return [displayDate.getTime(), transformedVal];
            });
          }
        } else if (!this._config.statistics && this._entityState) {
          // Fetch regular history if not statistics and entity exists
          const fetchedRecent = await this._fetchRecent(
            fetchStart,
            fetchEnd,
            skipInitialState,
          );
          if (fetchedRecent && fetchedRecent.length > 0) {
            newHistoryDataFetched = true;
            let lastNonNullValue: number | null = usableCache
              ? history!.data[history!.data.length - 1][1]
              : null;
            newStateHistory = fetchedRecent.map((rawItem) => {
              let currentStateValue: any;
              if (this._config.attribute) {
                currentStateValue = rawItem.a?.[this._config.attribute];
              } else {
                currentStateValue = rawItem.s;
              }
              let transformedVal: number | null;
              [lastNonNullValue, transformedVal] = this._transformAndFill(
                currentStateValue,
                rawItem,
                lastNonNullValue,
              );

              // Ensure `lu` (last_updated) is present, as `lc` (last_changed) might be missing
              // from minimal_response history. `lu` is a reliable timestamp in seconds.
              const timestamp = rawItem.lu * 1000;
              return [timestamp, transformedVal];
            });
          }
        }
      }

      if (newHistoryDataFetched) {
        if (history?.data) {
          history.data.push(...newStateHistory);
          // Sort and remove duplicates (by timestamp) if necessary, especially if fetches overlap
          history.data.sort((a, b) => a[0] - b[0]);
          history.data = history.data.filter(
            (item, index, self) =>
              index === 0 || item[0] !== self[index - 1][0],
          );
        } else {
          history = {
            data: newStateHistory,
            span: this._graphSpan,
            last_fetched: new Date(),
          };
        }
        history.last_fetched = new Date(); // Update last_fetched time

        if (this._cache && history.data.length > 0) {
          // Only cache if there's data
          try {
            await this._setCache(this._entityID, history, this._useCompress);
          } catch (err) {
            localforage.removeItem(
              `${this._entityID}_${this._md5Config}${
                this._useCompress ? "-comp" : "-raw"
              }`,
            );
          }
        }
      }
    } // end of 'else' for data_generator

    if (!history || history.data.length === 0) {
      this._updating = false;
      this._computedHistory = undefined;
      return false;
    }

    // Filter data to the requested window [start, end] AFTER aggregation for continuity
    const filterToWindow = (points: EntityCachePoints) => {
      return points.filter(
        (pt) => pt[0] >= start.getTime() && pt[0] <= end.getTime(),
      );
    };

    const momentRangeObject = momentExtended.range(startHistory, end); // Use provided start/end for bucketing window

    if (this._config.group_by.func !== "raw") {
      const buckets = this._dataBucketer(history, momentRangeObject);
      const res: EntityCachePoints = buckets.map((bucket) => {
        const aggValue = this._func(bucket.data.map((p) => p[1]));
        return [bucket.timestamp, aggValue]; // Pass only values to agg func
      });
      // Remove leading nulls for line/area charts if they are truly leading after bucketing
      // this._computedHistory = this._config.type === 'line' || this._config.type === 'area' ? this._filterNulls(res) : res;
      this._computedHistory = res;
    } else {
      this._computedHistory = history.data;
    }

    // Filter final computed history to the exact window [start, end] requested by the card
    // This should happen AFTER grouping for accurate group calculations near boundaries
    if (this._computedHistory) {
      this._computedHistory = this._computedHistory.filter(
        (pt) => pt[0] >= start.getTime() && pt[0] <= end.getTime(),
      );
    }

    this._updating = false;
    return true;
  }

  private _transformAndFill(
    value: any,
    historyItem: HassEntity | HistoryState | StatisticValue, // This is the full state/history item
    lastValue: number | null,
  ): [number | null, number | null] {
    let stateNumber: number | null;
    if (this._config.transform) {
      const originalValue = value;
      value = this._applyTransform(value, historyItem);
    }
    if (
      value === null ||
      value === undefined ||
      String(value).toLowerCase() === "unknown" ||
      String(value).toLowerCase() === "unavailable"
    ) {
      stateNumber = null;
    } else {
      stateNumber = parseFloat(String(value));
      if (Number.isNaN(stateNumber)) {
        stateNumber = null;
      }
    }

    if (stateNumber === null) {
      if (this._config.fill_raw === "last") {
        return [lastValue, lastValue];
      }
      if (this._config.fill_raw === "zero") {
        return [0, 0];
      }
      return [null, null]; // fill_raw 'null' or undefined
    }
    return [stateNumber, stateNumber];
  }

  private _applyTransform(value: any, entityStateOrHistoryItem: any): any {
    try {
      // 'x' is the value, 'entity' is the full state/history item
      // 'hass' could also be passed if transforms need it, but GraphEntry._hass is available
      const func = new Function(
        "x",
        "entity",
        "hass",
        `'use strict'; ${this._config.transform}`,
      );
      const result = func(value, entityStateOrHistoryItem, this._hass);
      return result;
    } catch (e: any) {
      return value; // Return original value on error
    }
  }

  private async _fetchRecent(
    start: Date,
    end: Date,
    skipInitialState = false,
  ): Promise<HistoryState[]> {
    if (!this._hass || !this._entityID) {
      return [];
    }
    const callArgs = {
      type: "history/history_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      entity_ids: [this._entityID],
      minimal_response: !this._config.attribute, // if attribute needed, get full response for this entity
      no_attributes: !this._config.attribute, // if attribute needed, get attributes
      significant_changes_only: skipInitialState, // Approximation
    };
    try {
      // Using history_during_period for consistency with d3-card and to get attributes if needed.
      // minimal_response: true will omit attributes unless entity_ids has only one entity
      // no_attributes: true will always omit attributes
      // significant_changes_only: true can be used, but for charting often all points are better
      const historyData = await this._hass.callWS<{
        [entityId: string]: HistoryState[];
      }>({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [this._entityID],
        minimal_response: !this._config.attribute, // if attribute needed, get full response for this entity
        no_attributes: !this._config.attribute, // if attribute needed, get attributes
        significant_changes_only: skipInitialState, // Approximation
      });
      return historyData && historyData[this._entityID]
        ? historyData[this._entityID]
        : [];
    } catch (err) {
      return [];
    }
  }

  private async _generateData(
    start: Date,
    end: Date,
  ): Promise<EntityCachePoints | undefined> {
    if (!this._config.data_generator) {
      return undefined;
    }
    try {
      // Args: hass, entityId, start, end, config (seriesConfig)
      const func = new Function(
        "hass",
        "entityId",
        "start",
        "end",
        "config",
        `'use strict'; ${this._config.data_generator}`,
      );
      const result = await func(
        this._hass,
        this._entityID,
        start,
        end,
        this._config,
      );
      if (
        Array.isArray(result) &&
        result.every(
          (p: any) =>
            Array.isArray(p) &&
            p.length === 2 &&
            typeof p[0] === "number" &&
            (typeof p[1] === "number" || p[1] === null),
        )
      ) {
        return result as EntityCachePoints;
      } else {
        return undefined;
      }
    } catch (e: any) {
      return undefined;
    }
  }

  private async _fetchStatistics(
    start: Date,
    end: Date,
    period: string,
  ): Promise<StatisticValue[]> {
    if (!this._hass || !this._entityID) {
      return [];
    }
    const callArgs = {
      type: "recorder/get_statistics_during_period",
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: [this._entityID], // This assumes _entityID is a valid statistic_id
      period: period as any, // 'hour', 'day', 'month', '5minute'
    };
    try {
      // First, get all statistic_ids to find the one matching our entity.
      // This step can be skipped if we construct the statistic_id directly (e.g. sensor.energy_usage -> sensor.energy_usage_mean_statistics)
      // However, the exact statistic_id format can vary.
      // For simplicity, we'll assume the consumer of GraphEntry knows the correct statistic_id or that
      // entity_id can be used if HA resolves it.
      // The call requires `statistic_ids` not `entity_ids`.

      // ApexCharts-card attempts to find the correct statistic_id. Here, we'll simplify.
      // If this._entityID is already a statistic_id, it might work.
      // Otherwise, this might need adjustment based on how statistic_ids are formed/discovered.
      const statisticsData = await this._hass.callWS<{
        [statisticId: string]: StatisticValue[];
      }>({
        type: "recorder/get_statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: [this._entityID], // This assumes _entityID is a valid statistic_id
        period: period as any, // 'hour', 'day', 'month', '5minute'
      });
      return statisticsData && statisticsData[this._entityID]
        ? statisticsData[this._entityID]
        : [];
    } catch (err) {
      return [];
    }
  }

  private _dataBucketer(
    history: EntityEntryCache, // Contains { data: EntityCachePoints, ... }
    timeRange: DateRange, // moment.range(startHistory, end)
  ): { timestamp: number; data: EntityCachePoint[] }[] {
    if (!history.data || history.data.length === 0) {
      return [];
    }

    const buckets: { timestamp: number; data: EntityCachePoint[] }[] = [];
    let currentBucketStartMs = timeRange.start.valueOf();
    const rangeEndMs = timeRange.end.valueOf();

    while (currentBucketStartMs < rangeEndMs) {
      const bucketEndMs = currentBucketStartMs + this._groupByDurationMs;
      const pointsInBucket: EntityCachePoint[] = [];

      history.data.forEach((point) => {
        // Check if point timestamp is within [currentBucketStartMs, bucketEndMs)
        if (point[0] >= currentBucketStartMs && point[0] < bucketEndMs) {
          pointsInBucket.push(point);
        }
      });

      // Use the start of the bucket as its representative timestamp
      buckets.push({ timestamp: currentBucketStartMs, data: pointsInBucket });

      currentBucketStartMs = bucketEndMs; // Move to the next bucket start
    }
    return buckets;
  }

  private _sum(values: (number | null)[]): number | null {
    const M = this._filterNulls(values);
    return M.length === 0 ? null : M.reduce((P, C) => P + C, 0);
  }
  private _average(items: (number | null)[]): number | null {
    const M = this._filterNulls(items);
    return M.length === 0 ? null : M.reduce((P, C) => P + C, 0) / M.length;
  }
  private _minimum(items: (number | null)[]): number | null {
    const M = this._filterNulls(items);
    return M.length === 0 ? null : Math.min(...M);
  }
  private _maximum(items: (number | null)[]): number | null {
    const M = this._filterNulls(items);
    return M.length === 0 ? null : Math.max(...M);
  }
  private _last(items: (number | null)[]): number | null {
    const M = this._filterNulls(items); // filterNulls returns number[]
    return M.length === 0 ? null : M[M.length - 1];
  }
  private _first(items: (number | null)[]): number | null {
    const M = this._filterNulls(items);
    return M.length === 0 ? null : M[0];
  }
  private _median(items: (number | null)[]): number | null {
    const M = this._filterNulls(items);
    if (M.length === 0) return null;
    const S = [...M].sort((a, b) => a - b);
    const mid = Math.floor(S.length / 2);
    return S.length % 2 === 0 ? (S[mid - 1] + S[mid]) / 2 : S[mid];
  }
  private _delta(items: (number | null)[]): number | null {
    const M = this._filterNulls(items);
    return M.length < 2 ? null : Math.max(...M) - Math.min(...M);
  }
  private _diff(items: (number | null)[]): number | null {
    const M = this._filterNulls(items);
    return M.length < 2 ? null : M[M.length - 1] - M[0];
  }

  private _filterNulls(items: (number | null)[]): number[] {
    return items.filter(
      (i) => typeof i === "number" && !Number.isNaN(i),
    ) as number[];
  }
}
