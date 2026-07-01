const DATA_URL = "./merged.csv";
const APP_VERSION = "v9";
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
  currentWaterLevel: document.getElementById("currentWaterLevel"),
  currentWaterDetail: document.getElementById("currentWaterDetail"),
  currentTideLevel: document.getElementById("currentTideLevel"),
  currentTideDetail: document.getElementById("currentTideDetail"),
  lastUpdated: document.getElementById("lastUpdated"),
  rowCount: document.getElementById("rowCount"),
  mobileCurrentTide: document.getElementById("mobileCurrentTide"),
  mobileTideTrend: document.getElementById("mobileTideTrend"),
  mobileMoonAge: document.getElementById("mobileMoonAge"),
  mobileDateLabel: document.getElementById("mobileDateLabel"),
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
        tide: toNumber(row.tide_cm),
        tideName: String(row.tide_name ?? "").trim(),
        moonAge: toNumber(row.moon_age),
      };
    })
    .filter((row) => !Number.isNaN(row.datetime.getTime()))
    .sort((a, b) => a.datetime - b.datetime);
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

function formatLongDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
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

function getPreviousTideRow(rows, latest) {
  if (!latest) {
    return null;
  }
  for (let index = rows.length - 2; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.datetime < latest.datetime && row.tide !== null) {
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
    elements.currentWaterLevel.textContent = "--";
    elements.currentWaterDetail.textContent = "--";
    elements.currentTideLevel.textContent = "--";
    elements.currentTideDetail.textContent = "若津";
    elements.lastUpdated.textContent = "--";
    elements.rowCount.textContent = "0件";
    elements.mobileCurrentTide.textContent = "--";
    elements.mobileTideTrend.textContent = "--";
    elements.mobileMoonAge.textContent = "--";
    elements.mobileDateLabel.textContent = "--";
    return;
  }

  const previousTide = getPreviousTideRow(state.rows, latest);
  const tideDiff =
    previousTide && latest.tide !== null ? latest.tide - previousTide.tide : null;
  const tideTrend =
    tideDiff === null
      ? "--"
      : `${tideDiff >= 0 ? "上げ" : "下げ"} ${Math.abs(tideDiff).toFixed(0)}cm`;

  elements.currentWaterLevel.textContent = formatNumber(latest.downstream, "TPm");
  elements.currentWaterDetail.textContent = `上流 ${formatNumber(latest.upstream, "TPm")}`;
  elements.currentTideLevel.textContent = formatNumber(latest.tide, "cm", 0);
  elements.currentTideDetail.textContent = formatTideMeta(latest);
  elements.lastUpdated.textContent = formatDateTime(latest.datetime);
  elements.rowCount.textContent = `${state.rows.length}件`;
  elements.mobileCurrentTide.textContent =
    latest.tide === null ? "--" : `${latest.tide.toFixed(0)}cm`;
  elements.mobileTideTrend.textContent = tideTrend;
  elements.mobileMoonAge.textContent =
    latest.moonAge === null ? "--" : latest.moonAge.toFixed(1);
  elements.mobileDateLabel.textContent = formatLongDate(latest.datetime);
}

function drawChart() {
  const rows = getFilteredRows(state.rows, state.days);
  const x = rows.map((row) => row.datetime);
  const tideMetaRow = getLatestTideMetaRow(rows);
  const tideMetaText = formatTideMeta(tideMetaRow).replace("若津 / ", "");
  const isMobile = window.matchMedia("(max-width: 520px)").matches;
  const colors = {
    downstream: "#f4ff27",
    upstream: "#76f7ff",
    tide: "#ff8a18",
  };
  const config = {
    responsive: true,
    displaylogo: false,
    displayModeBar: false,
    scrollZoom: false,
    doubleClick: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
  };
  const traces = [
    {
      x,
      y: rows.map((row) => row.downstream),
      name: "下流水位",
      type: "scatter",
      mode: "lines+markers",
      line: { color: colors.downstream, width: isMobile ? 5.5 : 5.2 },
      marker: {
        size: isMobile ? 7.5 : 8,
        color: colors.downstream,
        line: { color: "#ffffff", width: isMobile ? 1.4 : 1.6 },
      },
      hovertemplate: "%{x|%m/%d %H:%M}<br>下流 %{y:.2f} TPm<extra></extra>",
      connectgaps: true,
    },
    {
      x,
      y: rows.map((row) => row.upstream),
      name: "上流水位",
      type: "scatter",
      mode: "lines+markers",
      line: { color: colors.upstream, width: isMobile ? 4.4 : 4.4 },
      marker: {
        size: isMobile ? 6.5 : 7,
        color: colors.upstream,
        line: { color: "#ffffff", width: isMobile ? 1.2 : 1.4 },
      },
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
      line: { color: colors.tide, width: isMobile ? 4.6 : 4.6 },
      marker: {
        size: isMobile ? 6.5 : 7,
        color: colors.tide,
        line: { color: "#ffffff", width: isMobile ? 1.2 : 1.4 },
      },
      hovertemplate:
        "%{x|%m/%d %H:%M}<br>潮位 %{y:.0f} cm<br>潮名 %{customdata[0]}<br>月齢 %{customdata[1]}<extra></extra>",
      connectgaps: true,
    },
  ];

  const layout = {
    autosize: true,
    margin: isMobile ? { t: 44, r: 40, b: 40, l: 42 } : { t: 54, r: 64, b: 54, l: 58 },
    paper_bgcolor: "#083d63",
    plot_bgcolor: "#0a6ea8",
    font: {
      family: '"Yu Gothic", Meiryo, sans-serif',
      color: "#f5fbff",
    },
    legend: {
      orientation: "h",
      x: 0,
      y: isMobile ? 1.22 : 1.14,
      font: { size: isMobile ? 11 : 13 },
    },
    xaxis: {
      tickformat: isMobile ? "%m/%d" : "%m/%d\n%H:%M",
      gridcolor: "rgba(255,255,255,0.28)",
      rangeslider: { visible: false },
      fixedrange: true,
      tickfont: { size: isMobile ? 10 : 13 },
      nticks: isMobile ? 4 : undefined,
    },
    yaxis: {
      title: "水位 TPm",
      color: colors.downstream,
      gridcolor: "rgba(255,255,255,0.26)",
      zerolinecolor: "rgba(255,255,255,0.55)",
      fixedrange: true,
      titlefont: { size: isMobile ? 11 : 14 },
      tickfont: { size: isMobile ? 10 : 13 },
    },
    yaxis2: {
      title: "潮位 cm",
      color: colors.tide,
      overlaying: "y",
      side: "right",
      fixedrange: true,
      titlefont: { size: isMobile ? 11 : 14 },
      tickfont: { size: isMobile ? 10 : 13 },
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
            y: isMobile ? 1.12 : 1.1,
            xanchor: "right",
            yanchor: "bottom",
            showarrow: false,
            align: "right",
            font: { size: isMobile ? 11 : 13, color: "#f4ff38" },
          },
        ]
      : [],
    hovermode: "x unified",
    dragmode: false,
  };

  Plotly.react(elements.chart, traces, layout, config);
  elements.message.textContent = rows.length
    ? tideMetaText
      ? `表示期間の潮名・月齢: ${tideMetaText}`
      : ""
    : "表示できるデータがありません。";
}

async function updateServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const registration = await navigator.serviceWorker.register(
    `./service-worker.js?${APP_VERSION}`
  );
  await registration.update();
}

async function loadData({ quiet = false } = {}) {
  elements.refreshButton.disabled = true;
  if (!quiet) {
    elements.message.textContent = "更新中...";
  }

  try {
    const response = await fetch(`${DATA_URL}?v=${Date.now()}`);
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
    updateServiceWorker().catch(() => {});
  });
}

window.addEventListener("DOMContentLoaded", () => loadData({ quiet: true }));
