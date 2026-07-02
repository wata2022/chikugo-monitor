const DATA_URL = "./merged.csv";
const WATER_COLUMNS = {
  downstream: "downstream_water_level_tpm",
  upstream: "upstream_water_level_tpm",
};

const state = {
  rows: [],
  days: 1,
};

const elements = {
  chart: document.getElementById("chart"),
  currentDownstreamLevel: document.getElementById("currentDownstreamLevel"),
  currentUpstreamLevel: document.getElementById("currentUpstreamLevel"),
  currentDownstreamUpdatedAt: document.getElementById("currentDownstreamUpdatedAt"),
  currentUpstreamUpdatedAt: document.getElementById("currentUpstreamUpdatedAt"),
  currentTideLevel: document.getElementById("currentTideLevel"),
  currentTideDetail: document.getElementById("currentTideDetail"),
  lastUpdated: document.getElementById("lastUpdated"),
  rowCount: document.getElementById("rowCount"),
  message: document.getElementById("message"),
  refreshButton: document.getElementById("refreshButton"),
  rangeButtons: Array.from(document.querySelectorAll(".range-button")),
};

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) {
    return [];
  }

  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

function splitCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function normalizeRows(rows) {
  return rows
    .map((row) => {
      const datetime = new Date(String(row.datetime).replace(" ", "T"));
      return {
        datetime,
        downstream: toNumber(row[WATER_COLUMNS.downstream]),
        upstream: toNumber(row[WATER_COLUMNS.upstream]),
        downstreamUpdatedAt: parseDate(row.downstream_updated_at),
        upstreamUpdatedAt: parseDate(row.upstream_updated_at),
        tide: toNumber(row.tide_cm),
        tideName: String(row.tide_name ?? "").trim(),
        moonAge: toNumber(row.moon_age),
      };
    })
    .filter((row) => !Number.isNaN(row.datetime.getTime()))
    .sort((a, b) => a.datetime - b.datetime);
}

function parseDate(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const date = new Date(text.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, unit, digits = 2) {
  if (value === null || value === undefined) {
    return "--";
  }
  return `${value.toFixed(digits)} ${unit}`;
}

function formatDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatTideMeta(row) {
  if (!row) {
    return "若津";
  }

  const parts = [];
  if (row.tideName) {
    parts.push(row.tideName);
  }
  if (row.moonAge !== null) {
    parts.push(`月齢 ${row.moonAge.toFixed(1)}`);
  }
  return parts.length ? `若津 / ${parts.join(" / ")}` : "若津";
}

function getLatestTideMetaRow(rows) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.tideName || row.moonAge !== null) {
      return row;
    }
  }
  return null;
}

function getLatestRow(rows) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.downstream !== null || row.upstream !== null || row.tide !== null) {
      return row;
    }
  }
  return null;
}

function getFilteredRows(rows, days) {
  if (!rows.length) {
    return [];
  }

  const latest = rows[rows.length - 1].datetime;
  if (days === 1) {
    return rows.filter((row) => row.datetime.toDateString() === latest.toDateString());
  }

  const start = new Date(latest);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return rows.filter((row) => row.datetime >= start);
}

function updateMetrics() {
  const latest = getLatestRow(state.rows);
  if (!latest) {
    elements.currentDownstreamLevel.textContent = "--";
    elements.currentUpstreamLevel.textContent = "--";
    elements.currentDownstreamUpdatedAt.textContent = "--";
    elements.currentUpstreamUpdatedAt.textContent = "--";
    elements.currentTideLevel.textContent = "--";
    elements.currentTideDetail.textContent = "若津";
    elements.lastUpdated.textContent = "--";
    elements.rowCount.textContent = "0件";
    return;
  }

  elements.currentDownstreamLevel.textContent = formatNumber(latest.downstream, "TPm");
  elements.currentUpstreamLevel.textContent = formatNumber(latest.upstream, "TPm");
  elements.currentDownstreamUpdatedAt.textContent = `更新 ${formatDateTime(latest.downstreamUpdatedAt)}`;
  elements.currentUpstreamUpdatedAt.textContent = `更新 ${formatDateTime(latest.upstreamUpdatedAt)}`;
  elements.currentDownstreamLevel.title = `下流更新 ${formatDateTime(latest.downstreamUpdatedAt)}`;
  elements.currentUpstreamLevel.title = `上流更新 ${formatDateTime(latest.upstreamUpdatedAt)}`;
  elements.currentTideLevel.textContent = formatNumber(latest.tide, "cm", 0);
  elements.currentTideDetail.textContent = formatTideMeta(latest);
  elements.lastUpdated.textContent = formatDateTime(latest.datetime);
  elements.rowCount.textContent = `${state.rows.length}件`;
}

function drawChart() {
  const rows = getFilteredRows(state.rows, state.days);
  const x = rows.map((row) => row.datetime);
  const tideMetaRow = getLatestTideMetaRow(rows);
  const tideMetaText = formatTideMeta(tideMetaRow).replace("若津 / ", "");
  const config = {
    responsive: true,
    displaylogo: false,
    scrollZoom: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };
  const traces = [
    {
      x,
      y: rows.map((row) => row.downstream),
      name: "下流水位",
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#1667b7", width: 3 },
      marker: { size: 6 },
      hovertemplate: "%{x|%m/%d %H:%M}<br>下流 %{y:.2f} TPm<extra></extra>",
      connectgaps: true,
    },
    {
      x,
      y: rows.map((row) => row.upstream),
      name: "上流水位",
      type: "scatter",
      mode: "lines+markers",
      line: { color: "#15803d", width: 2 },
      marker: { size: 5 },
      hovertemplate: "%{x|%m/%d %H:%M}<br>上流 %{y:.2f} TPm<extra></extra>",
      connectgaps: true,
    },
    {
      x,
      y: rows.map((row) => row.tide),
      customdata: rows.map((row) => [
        row.tideName || "--",
        row.moonAge === null ? "--" : row.moonAge.toFixed(1),
      ]),
      name: "潮位",
      type: "scatter",
      mode: "lines+markers",
      yaxis: "y2",
      line: { color: "#c2410c", width: 2 },
      marker: { size: 5 },
      hovertemplate:
        "%{x|%m/%d %H:%M}<br>潮位 %{y:.0f} cm<br>潮名 %{customdata[0]}<br>月齢 %{customdata[1]}<extra></extra>",
      connectgaps: true,
    },
  ];

  const layout = {
    autosize: true,
    margin: { t: 18, r: 54, b: 50, l: 52 },
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: {
      family: '"Yu Gothic", Meiryo, sans-serif',
      color: "#13201f",
    },
    legend: {
      orientation: "h",
      x: 0,
      y: 1.12,
      font: { size: 12 },
    },
    xaxis: {
      tickformat: "%m/%d\n%H:%M",
      gridcolor: "#e5ecea",
      rangeslider: { visible: false },
    },
    yaxis: {
      title: "水位 TPm",
      color: "#1667b7",
      gridcolor: "#e5ecea",
      zerolinecolor: "#d6e1de",
      fixedrange: false,
    },
    yaxis2: {
      title: "潮位 cm",
      color: "#c2410c",
      overlaying: "y",
      side: "right",
      fixedrange: false,
    },
    annotations: tideMetaRow
      ? [
          {
            text: `潮名 ${tideMetaRow.tideName || "--"} / 月齢 ${
              tideMetaRow.moonAge === null ? "--" : tideMetaRow.moonAge.toFixed(1)
            }`,
            xref: "paper",
            yref: "paper",
            x: 1,
            y: 1.08,
            xanchor: "right",
            yanchor: "bottom",
            showarrow: false,
            align: "right",
            font: { size: 12, color: "#5b6b68" },
          },
        ]
      : [],
    hovermode: "x unified",
    dragmode: "pan",
  };

  Plotly.react(elements.chart, traces, layout, config);
  elements.message.textContent = rows.length
    ? tideMetaText
      ? `表示期間の潮名・月齢: ${tideMetaText}`
      : ""
    : "表示できるデータがありません。";
}

async function loadData({ quiet = false } = {}) {
  elements.refreshButton.disabled = true;
  if (!quiet) {
    elements.message.textContent = "更新中...";
  }

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    state.rows = normalizeRows(parseCsv(text));
    updateMetrics();
    drawChart();
    elements.message.textContent = `更新しました: ${formatDateTime(new Date())}`;
  } catch (error) {
    elements.message.textContent = `データを取得できませんでした: ${error.message}`;
  } finally {
    elements.refreshButton.disabled = false;
  }
}

function setRange(days) {
  state.days = days;
  elements.rangeButtons.forEach((button) => {
    const active = Number(button.dataset.days) === days;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  drawChart();
}

elements.refreshButton.addEventListener("click", () => loadData());
elements.rangeButtons.forEach((button) => {
  button.addEventListener("click", () => setRange(Number(button.dataset.days)));
});

window.addEventListener("resize", () => {
  Plotly.Plots.resize(elements.chart);
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js");
  });
}

window.addEventListener("DOMContentLoaded", () => loadData({ quiet: true }));
