import * as d3 from "d3";
import { DEBUG_MODE } from "./constants";

import * as d3util from "./utils/d3";
import { parseHistorySpanToMs } from "./utils/date";
import alignSeries from "./utils/alignSeries";
import { getFilter } from "./utils/entityFilter";

import {
  GraphEntry,
  ChartCardSeriesConfig as GraphEntrySeriesConfig,
} from "./graphEntry";
import { CardConfig, SeriesConfig } from "./types-config";
import { cardConfigSchema } from "./types-config-zod";
import { Hass } from "./types-hass";

export interface SeriesData {
  config: SeriesConfig;
  meta: Record<string, any>;
  state: any | null;
  transformedState: any | null;
  history: Array<[Timestamp, Value | null]> | null;
  error: string | null;
}

type Timestamp = number;
type Value = number;

export {}; // Make this file a module

class D3Card extends HTMLElement {
  private _config: CardConfig | null = null;
  private _hass: Hass | null = null;
  private _svg: SVGSVGElement | null = null;
  private _cardElement: HTMLElement | null = null;
  private _svgD3Selection: d3.Selection<
    Element,
    unknown,
    null,
    undefined
  > | null = null;
  private _graphEntries: Map<string, GraphEntry> = new Map();

  // Default configuration options
  static readonly DEFAULT_CACHE_HISTORY = true;
  static readonly DEFAULT_USE_COMPRESSION = false;
  static readonly DEFAULT_GROUP_BY: GraphEntrySeriesConfig["group_by"] = {
    func: "raw",
    duration: "1s",
  };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  setConfig(config: any) {
    config = cardConfigSchema.parse(config);

    this._config = {
      title: "",
      height: "300px",
      series: [],
      use_compression: D3Card.DEFAULT_USE_COMPRESSION,
      ...config,
    };

    // Clear any existing graph entries when new config is set
    this._graphEntries.clear();
    this._renderCardBase();
    // If hass is already set, update visualization, otherwise it will be updated when hass is set.
    if (this._hass) {
      this._updateD3Visualization();
    }
  }

  _renderCardBase() {
    const root = this.shadowRoot!;
    Array.from(root.childNodes).forEach((child) => {
      if (child instanceof Element && child.tagName !== "SCRIPT")
        root.removeChild(child);
    });
    this._cardElement = document.createElement("ha-card");
    if (this._config!.title)
      (this._cardElement as any).header = this._config!.title;
    const content = document.createElement("div");
    content.style.padding = "0";
    content.classList.add("d3-container");
    const svgElement = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    ) as SVGSVGElement;
    svgElement.style.width = "100%";
    svgElement.style.height = this._config!.height || "300px";
    svgElement.style.display = "block";
    content.appendChild(svgElement);
    this._cardElement.appendChild(content);
    root.appendChild(this._cardElement);
    this._svg = svgElement; // Store the SVG element
    this._svgD3Selection = null; // Will be initialized in _updateD3Visualization
  }

  set hass(hass: Hass) {
    const oldHass = this._hass;
    this._hass = hass;

    if (!this._config) return;

    // Determine if a re-render is needed
    // This is a basic check. More sophisticated checks might compare specific entity states.
    let significantChange = !oldHass;
    if (this._config.series && oldHass) {
      for (const seriesConf of this._config.series) {
        if (
          seriesConf.entity !== undefined &&
          hass.states[seriesConf.entity] !== oldHass.states[seriesConf.entity]
        ) {
          significantChange = true;
          break;
        }
      }
    }

    if (significantChange) {
      this._updateD3Visualization();
    }
  }

  async _processEntitySeries(
    seriesConf: SeriesConfig,
    index: number,
  ): Promise<SeriesData> {
    const hass = this._hass!;
    const cardConfig = this._config!;

    const entityState = hass.states[seriesConf.entity!];
    let transformedState: any;
    let historyData: [number, number | null][] | null = null; // Match GraphEntry history type
    let error: string | null = null;

    if (
      !entityState &&
      !(
        seriesConf.group_by &&
        seriesConf.group_by.func === "raw" &&
        seriesConf.fetch_history
      )
    ) {
      // Allow history fetching even if entity is not (yet) in states, GraphEntry might handle it or use data_generator
      // However, if it's not for history and entity is not found, it's an error.
      // A raw history fetch might also proceed if data_generator is intended.
      error = `Entity ${seriesConf.entity} not found in hass.states.`;
    } else if (
      entityState &&
      seriesConf.transform &&
      typeof seriesConf.transform === "string"
    ) {
      try {
        // Note: The transform in GraphEntry is applied per data point.
        // This transform here is for the current state if needed outside of history.
        const transformFunc = new Function(
          "x",
          "entity",
          "hass",
          seriesConf.transform,
        );
        transformedState = transformFunc(entityState.state, entityState, hass);
      } catch (e: any) {
        console.error(
          `Error executing transform for entity ${seriesConf.entity}: ${e.message}`,
        );
        error = "Transform error";
      }
    }

    if (seriesConf.fetch_history && seriesConf.fetch_history.span) {
      const seriesKey = `${seriesConf.entity}-${index}`;
      let graphEntry = this._graphEntries.get(seriesKey);

      if (!graphEntry) {
        const graphSpanMs = parseHistorySpanToMs(seriesConf.fetch_history.span);
        if (graphSpanMs > 0) {
          const useCache =
            seriesConf.cache_history ?? D3Card.DEFAULT_CACHE_HISTORY;
          const groupByConfig = seriesConf.group_by ?? D3Card.DEFAULT_GROUP_BY;

          const geSeriesConfig: GraphEntrySeriesConfig = {
            entity: seriesConf.entity!,
            attribute: seriesConf.attribute,
            transform: seriesConf.transform, // GraphEntry will use this for its internal transformations
            group_by: groupByConfig,
            statistics: seriesConf.statistics,
            // fill_raw: seriesConf.fill_raw, // Add if D3CardSeriesConfig supports it
            // data_generator: seriesConf.data_generator, // Add if D3CardSeriesConfig supports it
            cache: useCache, // Explicitly passing our cache decision
          };

          graphEntry = new GraphEntry(
            index,
            graphSpanMs,
            useCache, // This is useCacheForSeries argument in GraphEntry
            geSeriesConfig,
            undefined, // spanConfigForMD5 (can be enhanced later if needed)
            cardConfig.use_compression ?? D3Card.DEFAULT_USE_COMPRESSION,
          );
          this._graphEntries.set(seriesKey, graphEntry);
        } else {
          error = error || `Invalid history span for ${seriesConf.entity}`;
        }
      }

      if (graphEntry) {
        graphEntry.hass = hass;

        const endTime = new Date();
        // graphSpanMs for GraphEntry is the total span it's configured for.
        // For updateHistory, we pass the specific window we want to refresh/fetch.
        const historySpanMsToFetch = parseHistorySpanToMs(
          seriesConf.fetch_history.span,
        );
        const startTime = new Date(endTime.getTime() - historySpanMsToFetch);

        try {
          const updated = await graphEntry.updateHistory(startTime, endTime);

          if (updated) {
            historyData = graphEntry.history || null;
          } else if (!graphEntry.history) {
            // error = error || `Failed to update history for ${seriesConf.entity}`; // Original commented out
            // console.warn(`D3Card: UpdateHistory returned false for ${seriesConf.entity}`); // Original commented out
            // Keep historyData as null
          } else {
            historyData = graphEntry.history || null; // Use existing history if update fails but history exists
          }
        } catch (e: any) {
          error = error || `History update error: ${e.message}`;
          historyData = null; // Ensure historyData is null on error
        }
      }
    }

    return {
      config: seriesConf,
      meta: seriesConf.meta || {},
      state: entityState || null, // Current state of the entity
      transformedState: transformedState, // Current state transformed (if applicable)
      history: historyData, // Historical data from GraphEntry
      error: error,
    };
  }

  async _processSeriesConfig(
    seriesConf: SeriesConfig,
    index: number,
  ): Promise<Array<SeriesData>> {
    let entities: Set<string> = new Set();

    if (seriesConf.entity !== undefined) entities.add(seriesConf.entity);

    if (seriesConf.entities !== undefined)
      seriesConf.entities.forEach((entity) => entities.add(entity));

    let filter = seriesConf.filter;
    if (filter) {
      let allEntities = Object.keys(this._hass!.states);

      if (filter.include) {
        let includeFilters = await Promise.all(
          filter.include.map((v) => getFilter(this._hass!, v)),
        );

        let includedEntities = allEntities.filter((entity) =>
          includeFilters.some((f) => f(entity)),
        );

        includedEntities.forEach((entity) => entities.add(entity));
      }
      if (filter.exclude) {
        let excludeFilters = await Promise.all(
          filter.exclude.map((v) => getFilter(this._hass!, v)),
        );

        let excludedEntities = allEntities.filter((entity) =>
          excludeFilters.some((f) => f(entity)),
        );

        excludedEntities.forEach((entity) => entities.delete(entity));
      }
    }

    let seriesPromises = Array.from(entities).map((entity) =>
      this._processEntitySeries(
        {
          ...seriesConf,
          entity: entity,
          entities: undefined,
          filter: undefined,
        },
        index,
      ),
    );

    return await Promise.all(seriesPromises);
  }

  async _updateD3Visualization() {
    if (!this._hass || !this._config || !this._cardElement) return;

    const cardConfig = this._config;
    const hass = this._hass;
    const cardElement = this._cardElement;
    const svgContainer = this.shadowRoot!.querySelector(".d3-container svg");
    if (!svgContainer) {
      console.error("D3Card: SVG container not found for rendering.");
      return;
    }
    this._svgD3Selection = d3.select(svgContainer);
    const svg = this._svgD3Selection;

    // Show a loading indicator perhaps?
    // svg.selectAll("*").remove();
    // svg.append("text").attr("x", "50%").attr("y", "50%").attr("text-anchor", "middle").text("Loading history...");

    const seriesPromises = (cardConfig.series || []).map((seriesConf, index) =>
      this._processSeriesConfig(seriesConf, index),
    );

    const seriesData: Array<SeriesData> = (
      await Promise.all(seriesPromises)
    ).flat();

    // Setup layout variables
    const cardClientWidth = cardElement.getBoundingClientRect().width;
    const svgActualHeight = parseFloat(svg.style("height"));

    const innerWidth = cardClientWidth;
    const innerHeight = svgActualHeight;

    // Define d3cardUtils
    const d3cardUtils = {
      getTimeDomain: d3util.getTimeDomain,
      getValueDomain: d3util.getValueDomain,
      createTimeScale: d3util.createTimeScale,
      createLinearScale: d3util.createLinearScale,
      drawXAxis: d3util.drawXAxis,
      drawYAxis: d3util.drawYAxis,
      createLineGenerator: d3util.createLineGenerator,
      getDefaultColorScale: d3util.getDefaultColorScale,
      makeElement: d3util.makeElement,
      alignSeries: alignSeries,
    };

    try {
      const userD3Function = new Function(
        "d3",
        "svg", // The main SVG element selection
        "seriesData",
        "hass",
        "cardConfig",
        "cardElement",
        "size",
        "utils", // Utility functions
        cardConfig.d3_code,
      );
      userD3Function(
        d3,
        svg,
        seriesData,
        hass,
        cardConfig,
        cardElement,
        {
          width: innerWidth,
          height: innerHeight,
        },
        d3cardUtils,
      );
    } catch (e: any) {
      console.error(
        `Error executing user d3_code: ${e.message}\nStack: ${e.stack}`,
      );
      svg.selectAll("*").remove();
      svg
        .append("text")
        .attr("x", innerWidth / 2) // Use innerWidth for centering
        .attr("y", innerHeight / 2) // Use innerHeight for centering
        .attr("text-anchor", "middle")
        .style("fill", "red")
        .text(`Error in d3_code: ${e.message.substring(0, 200)}...`); // Show first 100 chars
    }
  }

  getCardSize() {
    const heightStr = this._config ? this._config.height || "300px" : "300px";
    const heightPx = parseInt(heightStr, 10);
    return !isNaN(heightPx) ? Math.max(1, Math.ceil(heightPx / 50)) : 3;
  }
}

customElements.define("d3-card", D3Card);
