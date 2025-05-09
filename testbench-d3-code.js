// Placeholder D3 code - replace with actual D3 rendering logic
// This code will run inside the D3Card class's _updateD3Visualization method
// It has access to:
// - 'd3'
// - 'svg': the d3 selection of the svg element
// - 'seriesData': the fetched and processed history data for series
// - 'hass': the hass object
// - 'cardConfig': the card's config object
// - 'cardElement'
// - 'innerWidth': width of the SVG
// - 'innerHeight': height of the SVG
// - 'mainGroup'
// - 'margin'
// - 'd3cardUtils'

if (false) {
  console.log("Executing d3_code from external file");
  console.log("SVG selection:", svg);
  console.log("Data:", seriesData);
  console.log("Dimensions:", innerWidth, innerHeight);

  // Example: Clear previous rendering and draw a circle
  svg.selectAll("*").remove(); // Clear previous content

  if (
    seriesData &&
    seriesData.length > 0 &&
    seriesData[0] &&
    seriesData[0].history &&
    seriesData[0].history.length > 0
  ) {
    const firstEntityHistory = seriesData[0].history;
    const firstDataPoint = firstEntityHistory[0];

    svg
      .append("text")
      .attr("x", 10)
      .attr("y", 20)
      .text("Sample D3 Code from External File");

    svg
      .append("text")
      .attr("x", 10)
      .attr("y", 40)
      .text("Entity: " + seriesData[0].config.entity);

    svg
      .append("text")
      .attr("x", 10)
      .attr("y", 60)
      .text(
        "First data point: " +
          firstDataPoint[1] +
          " at " +
          new Date(firstDataPoint[0]).toLocaleTimeString(),
      );

    svg
      .append("circle")
      .attr("cx", innerWidth / 2)
      .attr("cy", innerHeight / 2)
      .attr("r", Math.min(innerWidth, innerHeight) / 4)
      .style("fill", "steelblue");
  } else {
    svg
      .append("text")
      .attr("x", 10)
      .attr("y", 20)
      .text(
        "No data available to render for entity: " +
          (seriesData && seriesData.length > 0
            ? seriesData[0].entity_id
            : "N/A"),
      );
  }
}

// STACKED AREA

// Specify the chart’s dimensions.
const width = size.width;
const height = size.height;
const marginTop = 20;
const marginRight = 20;
const marginBottom = 20;
const marginLeft = 30;

const aligned = utils.alignSeries(seriesData.map((series) => series.history));

// Determine the series that need to be stacked.
const series = d3
  .stack()
  .keys(seriesData.map((_, idx) => idx))
  .value((d, key) => d[key + 1])(aligned);

// Prepare the scales for positional and color encodings.
const x = d3
  .scaleUtc()
  .domain(d3.extent(aligned, (d) => d[0]))
  .range([marginLeft, width - marginRight]);

const y = d3
  .scaleLinear()
  .domain([0, d3.max(series, (d) => d3.max(d, (d) => d[1]))])
  .rangeRound([height - marginBottom, marginTop]);

const color = d3
  .scaleOrdinal()
  .domain(series.map((d) => d.key))
  .range(d3.schemeTableau10);

// Construct an area shape.
const area = d3
  .area()
  .x((d) => x(d.data[0]))
  .y0((d) => y(d[0]))
  .y1((d) => y(d[1]));

// Add the y-axis, remove the domain line, add grid lines and a label.
svg
  .append("g")
  .attr("transform", `translate(${marginLeft},0)`)
  .call(d3.axisLeft(y).ticks(height / 80))
  .call((g) => g.select(".domain").remove())
  .call((g) =>
    g
      .selectAll(".tick line")
      .clone()
      .attr("x2", width - marginLeft - marginRight)
      .attr("stroke-opacity", 0.1),
  )
  .call((g) =>
    g
      .append("text")
      .attr("x", -marginLeft)
      .attr("y", 10)
      .attr("fill", "currentColor")
      .attr("text-anchor", "start")
      .text("↑ Unemployed persons"),
  );

// Append a path for each series.
svg
  .append("g")
  .selectAll()
  .data(series)
  .join("path")
  .attr("fill", (d) => color(d.key))
  .attr("d", area)
  .append("title")
  .text((d) => d.key);

// Append the horizontal axis atop the area.
svg
  .append("g")
  .attr("transform", `translate(0,${height - marginBottom})`)
  .call(d3.axisBottom(x).tickSizeOuter(0));
