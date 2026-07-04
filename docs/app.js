const DATA_URL = "./merged.csv";
const UPDATE_TRIGGER_URL = "";
const APP_VERSION = "v20";
const UPDATE_POLL_ATTEMPTS = 12;
const UPDATE_POLL_INTERVAL_MS = 10000;
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
  mobileCurrentTide: document.getElementById("mobileCurrentTide"),
  mobileTideTrend: document.getElementById("mobileTideTrend"),
  mobileMoonIcon: document.getElementById("mobileMoonIcon"),
  mobileMoonAge: document.getElementById("mobileMoonAge"),
  mobileTideName: document.getElementById("mobileTideName"),
  mobileDateLabel: document.getElementById("mobileDateLabel"),
  mobileDownstreamLevel: document.getElementById("mobileDownstreamLevel"),
  mobileUpstreamLevel: document.getElementById("mobileUpstreamLevel"),
  mobileDownstreamUpdatedAt: document.getElementById("mobileDownstreamUpdatedAt"),
  mobileUpstreamUpdatedAt: document.getElementById("mobileUpstreamUpdatedAt"),
  message: document.getElementById("message"),
  refreshButtons: [
    document.getElementById("refreshButton"),
    document.getElementById("mobileRefreshButton"),
  ].filter(Boolean),
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

function getMoonPhaseIcon(moonAge) {
  if (moonAge === null || moonAge === undefined) {
    return "🌕";
  }

  const normalizedAge = ((moonAge % 29.530588853) + 29.530588853) % 29.530588853;
  const phaseIndex = Math.round((normalizedAge / 29.530588853) * 8) % 8;
  return ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"][phaseIndex];
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

function getLatestSourceUpdatedAt(rows) {
  let latestTime = 0;
  rows.forEach((row) => {
    [row.downstreamUpdatedAt, row.upstreamUpdatedAt].forEach((date) => {
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        latestTime = Math.max(latestTime, date.getTime());
      }
    });
  });
  return latestTime ? new Date(latestTime) : null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
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
    elements.mobileCurrentTide.textContent = "--";
    elements.mobileTideTrend.textContent = "--";
    elements.mobileMoonIcon.textContent = "🌕";
    elements.mobileMoonAge.textContent = "月齢 --";
    elements.mobileTideName.textContent = "--";
    elements.mobileDateLabel.textContent = "--";
    elements.mobileDownstreamLevel.textContent = "--";
    elements.mobileUpstreamLevel.textContent = "--";
    elements.mobileDownstreamUpdatedAt.textContent = "--";
    elements.mobileUpstreamUpdatedAt.textContent = "--";
    return;
  }

  const previousTide = getPreviousTideRow(state.rows, latest);
  const tideDiff =
    previousTide && latest.tide !== null ? latest.tide - previousTide.tide : null;
  const tideTrend =
    tideDiff === null
      ? "--"
      : tideDiff === 0
        ? "変化なし 0cm"
        : `${tideDiff > 0 ? "上げ幅" : "下げ幅"} ${Math.abs(tideDiff).toFixed(0)}cm`;

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
  elements.mobileCurrentTide.textContent =
    latest.tide === null ? "--" : `${latest.tide.toFixed(0)}cm`;
  elements.mobileTideTrend.textContent = tideTrend;
  elements.mobileMoonIcon.textContent = getMoonPhaseIcon(latest.moonAge);
  elements.mobileMoonAge.textContent =
    latest.moonAge === null ? "月齢 --" : `月齢 ${latest.moonAge.toFixed(1)}`;
  elements.mobileTideName.textContent = latest.tideName || "--";
  elements.mobileDateLabel.textContent = formatLongDate(latest.datetime);
  elements.mobileDownstreamLevel.textContent = formatNumber(latest.downstream, "TPm");
  elements.mobileUpstreamLevel.textContent = formatNumber(latest.upstream, "TPm");
  elements.mobileDownstreamUpdatedAt.textContent = formatDateTime(latest.downstreamUpdatedAt);
  elements.mobileUpstreamUpdatedAt.textContent = formatDateTime(latest.upstreamUpdatedAt);
  elements.mobileDownstreamLevel.title = `下流更新 ${formatDateTime(latest.downstreamUpdatedAt)}`;
  elements.mobileUpstreamLevel.title = `上流更新 ${formatDateTime(latest.upstreamUpdatedAt)}`;
}

function drawChart() {
  const rows = getFilteredRows(state.rows, state.days);
  const x = rows.map((row) => row.datetime);
  const isMobile = window.matchMedia("(max-width: 520px)").matches;
  const isMultiDay = state.days > 1;
  const markerSize = isMultiDay ? 0 : isMobile ? 7.5 : 8;
  const tideMarkerSize = isMultiDay ? 0 : isMobile ? 6.5 : 7;
  const traceMode = isMultiDay ? "lines" : "lines+markers";
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
      mode: traceMode,
      line: { color: colors.downstream, width: isMultiDay ? 4 : isMobile ? 5.5 : 5.2 },
      marker: {
        size: markerSize,
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
      mode: traceMode,
      line: { color: colors.upstream, width: isMultiDay ? 3.2 : 4.4 },
      marker: {
        size: tideMarkerSize,
        color: colors.upstream,
        line: { color: "#ffffff", width: isMobile ? 1.2 : 1.4 },
      },
      hovertemplate: "%{x|%m/%d %H:%M}<br>上流 %{y:.2f} TPm<extra></extra>",
      connectgaps: true,
    },
    {
      x,
      y: rows.map((row) => row.tide),
      name: "潮位",
      type: "scatter",
      mode: traceMode,
      yaxis: "y2",
      line: { color: colors.tide, width: isMultiDay ? 3.4 : 4.6 },
      marker: {
        size: tideMarkerSize,
        color: colors.tide,
        line: { color: "#ffffff", width: isMobile ? 1.2 : 1.4 },
      },
      hovertemplate: "%{x|%m/%d %H:%M}<br>潮位 %{y:.0f} cm<extra></extra>",
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
      tickformat: state.days === 1 ? (isMobile ? "%H:%M" : "%m/%d\n%H:%M") : "%m/%d",
      gridcolor: "rgba(255,255,255,0.28)",
      rangeslider: { visible: false },
      fixedrange: true,
      tickfont: { size: isMobile ? 10 : 13 },
      nticks: state.days === 1 ? (isMobile ? 5 : 8) : state.days === 3 ? 6 : 8,
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
    annotations: [],
    hovermode: "x unified",
    dragmode: false,
  };

  Plotly.react(elements.chart, traces, layout, config);
  elements.message.textContent = rows.length ? "" : "表示できるデータがありません。";
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
  if (!quiet) {
    elements.message.textContent = "更新中...";
  }

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
  if (!quiet) {
    elements.message.textContent = `更新しました: ${formatDateTime(new Date())}`;
  }
}

async function reloadData({ quiet = false } = {}) {
  elements.refreshButtons.forEach((button) => {
    button.disabled = true;
  });

  try {
    await loadData({ quiet });
  } catch (error) {
    elements.message.textContent = `データを取得できませんでした: ${error.message}`;
  } finally {
    elements.refreshButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}

async function triggerRemoteUpdate() {
  if (!UPDATE_TRIGGER_URL) {
    return false;
  }

  const updateKey = window.prompt("更新キーを入力してください");
  if (!updateKey) {
    throw new Error("更新キーが入力されていません");
  }

  const response = await fetch(UPDATE_TRIGGER_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${updateKey}`,
    },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      if (body.error) {
        message = body.error;
      }
    } catch (error) {
      // Ignore non-JSON error bodies.
    }
    throw new Error(message);
  }
  return true;
}

async function refreshFromSource() {
  elements.refreshButtons.forEach((button) => {
    button.disabled = true;
  });

  try {
    const previousUpdatedAt = getLatestSourceUpdatedAt(state.rows);
    if (!UPDATE_TRIGGER_URL) {
      await loadData();
      return;
    }

    elements.message.textContent = "元データ更新を開始しています...";
    await triggerRemoteUpdate();
    elements.message.textContent = "元データ更新中...";

    for (let attempt = 1; attempt <= UPDATE_POLL_ATTEMPTS; attempt += 1) {
      await sleep(UPDATE_POLL_INTERVAL_MS);
      await loadData({ quiet: true });
      const currentUpdatedAt = getLatestSourceUpdatedAt(state.rows);
      if (
        currentUpdatedAt
        && (!previousUpdatedAt || currentUpdatedAt.getTime() > previousUpdatedAt.getTime())
      ) {
        elements.message.textContent = `更新しました: ${formatDateTime(currentUpdatedAt)}`;
        return;
      }
      elements.message.textContent = `元データ更新中... ${attempt}/${UPDATE_POLL_ATTEMPTS}`;
    }

    elements.message.textContent = "更新処理を開始しました。少し待って再度更新してください。";
  } catch (error) {
    elements.message.textContent = `データ更新を開始できませんでした: ${error.message}`;
  } finally {
    elements.refreshButtons.forEach((button) => {
      button.disabled = false;
    });
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

elements.refreshButtons.forEach((button) => {
  button.addEventListener("click", () => refreshFromSource());
});
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

window.addEventListener("DOMContentLoaded", () => reloadData({ quiet: true }));
