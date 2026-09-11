/**
 * Namma Metro Dashboard — Analytics & Route Search
 * ==================================================
 * - Top 10 busiest stations bar chart
 * - System-wide peak hours chart
 * - Per-line ridership doughnut chart
 * - Top 15 busiest routes table
 * - Route search with daily volume line charts
 * - Nearby stations with geospatial search
 */

// ── Chart.js Default Config ──
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(148, 163, 184, 0.08)';
Chart.defaults.font.family = "'Inter', -apple-system, sans-serif";

// ── Chart instances ──
let topStationsChart = null;
let peakHoursChart = null;
let lineStatsChart = null;
let routeForwardChart = null;
let routeReverseChart = null;
let weekdayWeekendChart = null;
let monthlyTrendChart = null;

// ── Tooltip Config ──
const tooltipConfig = {
  backgroundColor: 'rgba(10, 14, 26, 0.92)',
  titleColor: '#f1f5f9',
  bodyColor: '#94a3b8',
  borderColor: 'rgba(148, 163, 184, 0.15)',
  borderWidth: 1,
  cornerRadius: 8,
  padding: 12,
  titleFont: { weight: '600' }
};

// ── Load Dashboard ──
async function loadDashboard() {
  setDashboardLoading(true);
  try {
    const [overviewRes, stationsRes] = await Promise.all([
      fetch('/api/analytics/overview'),
      fetch('/api/stations').then(r => r.json())
    ]);
    if (!overviewRes.ok) throw new Error(`Analytics request failed: ${overviewRes.status}`);
    const overviewData = await overviewRes.json();
    const { topStations, peakHours, lineStats, topRoutes, weekdayWeekend, stationHeatmap, monthlyTrend, interchangeLoad } = overviewData;
    const stationsData = await stationsRes;

    // ── Summary Stats ──
    const lineTotal = lineStats.reduce((sum, l) => sum + l.passengers, 0);
    const lineTripTotal = lineStats.reduce((sum, l) => sum + l.trips, 0);

    document.getElementById('stat-stations').textContent = stationsData.length;
    document.getElementById('stat-trips').textContent = formatNumber(lineTripTotal);
    document.getElementById('stat-passengers').textContent = formatNumber(lineTotal);

    // ── Network Pulse ──
    renderNetworkPulse({ topStations, peakHours, lineStats, topRoutes, totalPassengers: lineTotal });

    // ── Top Stations Bar Chart ──
    renderTopStationsChart(topStations);

    // ── Peak Hours Chart ──
    renderPeakHoursChart(peakHours);

    // ── Line Stats Doughnut ──
    renderLineStatsChart(lineStats);

    // ── Top Routes Table ──
    renderTopRoutesTable(topRoutes);

    // ── 4 New Advanced Analytics ──
    if (weekdayWeekend) {
      renderWeekdayWeekendChart(weekdayWeekend);
    }
    if (interchangeLoad) {
      renderInterchangeCards(interchangeLoad);
    }
    if (stationHeatmap) {
      renderStationHeatmap(stationHeatmap);
    }
    if (monthlyTrend) {
      renderMonthlyTrendChart(monthlyTrend);
    }

    console.log('📊 Dashboard loaded with 8 complete analytics pipelines');
  } catch (err) {
    console.error('Failed to load dashboard:', err);
    showDashboardError();
  } finally {
    setDashboardLoading(false);
  }
}

function renderNetworkPulse({ topStations, peakHours, lineStats, topRoutes, totalPassengers }) {
  const peak = peakHours.reduce((highest, item) =>
    !highest || item.passengers > highest.passengers ? item : highest, null);
  const commutePassengers = peakHours
    .filter(({ hour }) => (hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20))
    .reduce((sum, item) => sum + item.passengers, 0);
  const topStationPassengers = topStations.reduce((sum, item) => sum + item.total_passengers, 0);
  const leadingLine = [...lineStats].sort((a, b) => b.passengers - a.passengers)[0];
  const leadingRoute = topRoutes[0];
  const pct = (value, total) => total ? Math.round((value / total) * 100) : 0;
  const hourLabel = peak ? `${String(peak.hour).padStart(2, '0')}:00–${String(peak.hour + 1).padStart(2, '0')}:00` : '—';
  const peakDailyAverage = peak ? Math.round(peak.passengers / 90) : 0;

  document.getElementById('pulse-peak-hour').textContent = hourLabel;
  document.getElementById('pulse-peak-detail').textContent = peak
    ? `${formatNumber(peakDailyAverage)} average passengers / day`
    : 'No hourly data available';
  document.getElementById('pulse-commute-share').textContent = `${pct(commutePassengers, totalPassengers)}%`;
  document.getElementById('pulse-concentration').textContent = `${pct(topStationPassengers, totalPassengers)}%`;
  document.getElementById('pulse-leading-line').textContent = leadingLine ? `${leadingLine.line} Line` : '—';
  document.getElementById('pulse-leading-detail').textContent = leadingLine
    ? `${pct(leadingLine.passengers, totalPassengers)}% of all passengers`
    : 'No line data available';

  const routeText = leadingRoute
    ? `${leadingRoute.from_name} → ${leadingRoute.to_name} is the highest-volume OD pair.`
    : 'Route demand is being calculated.';
  document.getElementById('pulse-summary').textContent = peak && leadingLine
    ? `${leadingLine.line} carries the most demand, with the strongest network pulse at ${hourLabel}. ${routeText}`
    : routeText;
}

function setDashboardLoading(isLoading) {
  document.querySelectorAll('[data-analysis]').forEach((panel) => {
    panel.classList.toggle('is-loading', isLoading);
  });
}

function showDashboardError() {
  document.querySelectorAll('[data-analysis]').forEach((panel) => {
    const label = panel.querySelector('.analysis-loading-label');
    if (label) label.textContent = 'Unable to load analysis';
  });
}

// ── Top 10 Stations ──
function renderTopStationsChart(data) {
  const ctx = document.getElementById('top-stations-chart');
  if (topStationsChart) topStationsChart.destroy();

  const labels = data.map(d => {
    const name = d.station_name || d.station_id;
    return name.length > 20 ? name.slice(0, 18) + '…' : name;
  });

  const colors = data.map(d => {
    const lc = window.LINE_COLORS || { Purple: '#a855f7', Green: '#22c55e', Yellow: '#eab308' };
    return (lc[d.line] || '#6366f1') + 'cc';
  });

  topStationsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Passengers',
        data: data.map(d => d.total_passengers),
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace('cc', '')),
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.7
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipConfig,
          callbacks: {
            title: (items) => data[items[0].dataIndex].station_name || data[items[0].dataIndex].station_id,
            label: (ctx) => `${formatNumber(ctx.raw)} passengers (${data[ctx.dataIndex].line} Line)`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            callback: (val) => formatNumber(val),
            font: { size: 11 }
          },
          grid: { color: 'rgba(148, 163, 184, 0.06)' }
        },
        y: {
          ticks: { font: { size: 11 } },
          grid: { display: false }
        }
      }
    }
  });
}

// ── Peak Hours ──
function renderPeakHoursChart(data) {
  const ctx = document.getElementById('peak-hours-chart');
  if (peakHoursChart) peakHoursChart.destroy();

  // Ensure we have all 24 hours
  const hourData = new Array(24).fill(0);
  for (const d of data) {
    hourData[d.hour] = d.passengers;
  }

  // Create gradient
  const canvas = ctx;
  const chartCtx = canvas.getContext('2d');
  const gradient = chartCtx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
  gradient.addColorStop(1, 'rgba(99, 102, 241, 0.02)');

  peakHoursChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`),
      datasets: [{
        label: 'Passengers',
        data: hourData,
        fill: true,
        backgroundColor: gradient,
        borderColor: '#6366f1',
        borderWidth: 2.5,
        tension: 0.4,
        pointRadius: 3,
        pointBackgroundColor: '#6366f1',
        pointBorderColor: '#0a0e1a',
        pointBorderWidth: 2,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#818cf8'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipConfig,
          callbacks: {
            label: (ctx) => `${formatNumber(ctx.raw)} passengers`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 0,
            font: { size: 10 },
            callback: (val, idx) => idx % 3 === 0 ? `${idx}:00` : ''
          },
          grid: { color: 'rgba(148, 163, 184, 0.05)' }
        },
        y: {
          ticks: {
            callback: (val) => formatNumber(val),
            font: { size: 11 }
          },
          grid: { color: 'rgba(148, 163, 184, 0.06)' },
          beginAtZero: true
        }
      }
    }
  });
}

// ── Line Stats Doughnut ──
function renderLineStatsChart(data) {
  const ctx = document.getElementById('line-stats-chart');
  if (lineStatsChart) lineStatsChart.destroy();

  const lc = { Purple: '#a855f7', Green: '#22c55e', Yellow: '#eab308' };

  lineStatsChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: data.map(d => d.line + ' Line'),
      datasets: [{
        data: data.map(d => d.passengers),
        backgroundColor: data.map(d => lc[d.line] || '#6366f1'),
        borderColor: '#111827',
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            usePointStyle: true,
            pointStyle: 'circle',
            font: { size: 12, weight: '500' }
          }
        },
        tooltip: {
          ...tooltipConfig,
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((ctx.raw / total) * 100).toFixed(1);
              return `${formatNumber(ctx.raw)} passengers (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ── Top Routes Table ──
function renderTopRoutesTable(data) {
  const tbody = document.getElementById('top-routes-tbody');
  if (!tbody) return;

  tbody.innerHTML = data.map((r, i) => `
    <tr class="fade-in" style="animation-delay: ${i * 30}ms">
      <td class="rank">${i + 1}</td>
      <td>${r.from_name || r.from_station}</td>
      <td>${r.to_name || r.to_station}</td>
      <td class="passengers">${formatNumber(r.total_passengers)}</td>
    </tr>
  `).join('');
}

// ══════════════════════════════════
// ── Route Search
// ══════════════════════════════════

// Populate station dropdowns
async function populateStationDropdowns() {
  try {
    // Wait for allStations to be populated by map.js
    let attempts = 0;
    while ((!window.allStations || window.allStations.length === 0) && attempts < 50) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    const stations = window.allStations || [];
    if (stations.length === 0) {
      const res = await fetch('/api/stations');
      window.allStations = await res.json();
    }

    const fromSelect = document.getElementById('from-station');
    const toSelect = document.getElementById('to-station');

    // Group by line
    const byLine = {};
    for (const s of window.allStations) {
      if (!byLine[s.line]) byLine[s.line] = [];
      byLine[s.line].push(s);
    }

    for (const [line, stns] of Object.entries(byLine)) {
      stns.sort((a, b) => a.sequence - b.sequence);

      const fromGroup = document.createElement('optgroup');
      fromGroup.label = `${line} Line`;
      const toGroup = document.createElement('optgroup');
      toGroup.label = `${line} Line`;

      for (const s of stns) {
        const opt1 = new Option(s.name, s._id);
        const opt2 = new Option(s.name, s._id);
        fromGroup.appendChild(opt1);
        toGroup.appendChild(opt2);
      }

      fromSelect.appendChild(fromGroup);
      toSelect.appendChild(toGroup);
    }
  } catch (err) {
    console.error('Failed to populate dropdowns:', err);
  }
}

// Handle route search
document.getElementById('route-search-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const from = document.getElementById('from-station').value;
  const to = document.getElementById('to-station').value;
  if (!from || !to) return;
  if (from === to) {
    alert('Please select different stations.');
    return;
  }

  const btn = document.getElementById('btn-search-route');
  btn.textContent = 'Searching...';
  btn.disabled = true;

  try {
    const [volumeRes, journeyRes] = await Promise.all([
      fetch(`/api/routes?from=${from}&to=${to}`),
      fetch(`/api/routes/journey?from=${from}&to=${to}`)
    ]);
    if (!volumeRes.ok) throw new Error(`Route volume request failed: ${volumeRes.status}`);
    const data = await volumeRes.json();
    let journey = null;
    try { journey = await journeyRes.json(); } catch (_) { journey = null; }

    // Show results
    const resultsEl = document.getElementById('route-results');
    resultsEl.classList.add('visible');

    // Find station names
    const fromStation = (window.allStations || []).find(s => s._id === from);
    const toStation = (window.allStations || []).find(s => s._id === to);

    document.getElementById('route-from-name').textContent = fromStation?.name || from;
    document.getElementById('route-to-name').textContent = toStation?.name || to;
    document.getElementById('route-avg-passengers').textContent = formatNumber(data.avg_passengers_per_day);
    document.getElementById('route-total-trips').textContent = formatNumber(data.total_trips);
    document.getElementById('route-total-passengers').textContent = formatNumber(data.total_passengers);

    // ── Journey Details (stops, fare, distance, line changes) ──
    renderJourney(journey);

    // ── Forward Chart ──
    renderRouteChart('route-forward-chart', data.forward_daily, '#6366f1', 'routeForward');

    // ── Reverse Chart ──
    renderRouteChart('route-reverse-chart', data.reverse_daily, '#a855f7', 'routeReverse');

  } catch (err) {
    console.error('Route search failed:', err);
    alert('Failed to search route. Check console.');
  } finally {
    btn.textContent = 'Search Route';
    btn.disabled = false;
  }
});

document.getElementById('btn-swap-route').addEventListener('click', () => {
  const from = document.getElementById('from-station');
  const to = document.getElementById('to-station');
  [from.value, to.value] = [to.value, from.value];
  from.focus();
});

// ── Render Journey Details (path, segments, fare, interchanges) ──
function renderJourney(j) {
  const timeline = document.getElementById('journey-timeline');
  const note = document.getElementById('journey-transfer-note');
  const timing = document.getElementById('journey-timing');
  const linesBadge = document.getElementById('journey-lines-badge');
  const lc = window.LINE_COLORS || { Purple: '#a855f7', Green: '#22c55e', Yellow: '#eab308' };
  const lineBadge = (l) => {
    const c = lc[l] || '#6366f1';
    return `<span class="jline-badge" style="color:${c};border-color:${c}66;background:${c}1a;">● ${l}</span>`;
  };

  // Reset everything on error / missing data
  if (!j || j.error) {
    document.getElementById('jc-stops').textContent = '—';
    document.getElementById('jc-distance').textContent = '—';
    document.getElementById('jc-duration').textContent = '—';
    document.getElementById('jc-fare').textContent = '—';
    document.getElementById('jc-fare-slab').textContent = '—';
    document.getElementById('jc-changes').textContent = '—';
    document.getElementById('jc-roundtrip').textContent = '—';
    linesBadge.textContent = '—';
    note.style.display = 'none';
    timing.textContent = '';
    timeline.innerHTML = `<div class="journey-empty">⚠️ ${j?.error || 'Journey details unavailable.'}</div>`;
    return;
  }

  // ── Stat chips ──
  document.getElementById('jc-stops').textContent = j.stops;
  document.getElementById('jc-distance').textContent = j.total_distance_km + ' km';
  document.getElementById('jc-duration').textContent = '~' + j.duration_min + ' min';
  document.getElementById('jc-fare').textContent = '₹' + j.fare.single;
  document.getElementById('jc-fare-slab').textContent = j.fare.slab_label;
  document.getElementById('jc-changes').textContent = j.interchanges.length;
  document.getElementById('jc-roundtrip').textContent = '₹' + j.fare.round_trip;

  // ── Lines used badge ──
  linesBadge.innerHTML = j.lines_used.map(lineBadge).join(' ');

  // ── Line-change notice ──
  if (j.interchanges.length) {
    note.style.display = 'block';
    note.innerHTML = j.interchanges.map(x => `
      <span class="jtransfer-item">
        🔁 At <strong>${x.station}</strong> — change
        <b style="color:${lc[x.from_line] || '#6366f1'}">${x.from_line}</b> →
        <b style="color:${lc[x.to_line] || '#6366f1'}">${x.to_line}</b>
      </span>
    `).join('');
  } else {
    note.style.display = 'none';
    note.innerHTML = '';
  }

  // ── Indicative timings ──
  timing.textContent = `🚈 First train ${j.timing.first_train} · Last train ${j.timing.last_train} · Trains every ~${j.timing.frequency_min} min`;

  // ── Stop-by-stop timeline, grouped per line segment ──
  let html = '';
  let pi = 0; // current index in j.path (adjacent segments share boundary node)
  j.segments.forEach((seg, si) => {
    const color = lc[seg.line] || '#6366f1';
    html += `
      <div class="jseg-header" style="border-color:${color}55;">
        <span class="jseg-dot" style="background:${color};box-shadow:0 0 8px ${color}88;"></span>
        <span class="jseg-line" style="color:${color};">${seg.line} Line</span>
        <span class="jseg-meta">towards ${seg.towards} · ${seg.stops} stop${seg.stops > 1 ? 's' : ''} · ${seg.distance_km} km</span>
      </div>
      <div class="jseg-stops">`;

    const startK = si === 0 ? 0 : 1; // boundary node already rendered by previous segment
    for (let k = startK; k <= seg.stops; k++) {
      const node = j.path[pi + k];
      const globalIdx = pi + k;
      const isLastOfSeg = k === seg.stops;
      const isDestination = globalIdx === j.path.length - 1;
      const isTransfer = isLastOfSeg && node.transfer_to && !isDestination;

      let iconHtml;
      let tagHtml = '';
      if (globalIdx === 0) {
        iconHtml = `<span class="jstop-dot origin" style="background:${color};">🚩</span>`;
        tagHtml = `<span class="jstop-tag">Board here</span> ${node.lines && node.lines.length > 1 ? node.lines.map(lineBadge).join(' ') : lineBadge(seg.line)}`;
      } else if (isDestination) {
        iconHtml = `<span class="jstop-dot destination" style="background:${color};">🏁</span>`;
        tagHtml = `<span class="jstop-tag destination">Destination</span>`;
      } else if (isTransfer) {
        const tc = lc[node.transfer_to] || '#6366f1';
        iconHtml = `<span class="jstop-dot transfer">⇄</span>`;
        tagHtml = `<span class="jstop-tag transfer">Change to <b style="color:${tc};">${node.transfer_to} Line</b></span>`;
      } else {
        iconHtml = `<span class="jstop-dot" style="background:${color};"></span>`;
        if (node.is_interchange) tagHtml = `<span class="jstop-tag">⇄ Interchange available</span>`;
      }

      html += `
        <div class="jstop${isDestination ? ' destination' : ''}${isTransfer ? ' transfer' : ''}">
          <div class="jstop-rail">${iconHtml}<span class="jstop-connector" style="background:linear-gradient(${color}55, ${color}22);"></span></div>
          <div class="jstop-body">
            <span class="jstop-name">${node.name}</span>
            ${tagHtml}
          </div>
        </div>`;
    }
    html += `</div>`;
    pi += seg.stops; // next segment starts at this boundary node
  });

  timeline.innerHTML = html;
}

function renderRouteChart(canvasId, dailyData, color, chartKey) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  // Destroy existing
  if (chartKey === 'routeForward' && routeForwardChart) routeForwardChart.destroy();
  if (chartKey === 'routeReverse' && routeReverseChart) routeReverseChart.destroy();

  const chartCtx = ctx.getContext('2d');
  const gradient = chartCtx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, color + '40');
  gradient.addColorStop(1, color + '05');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dailyData.map(d => {
        const date = new Date(d.date);
        return date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
      }),
      datasets: [{
        label: 'Passengers',
        data: dailyData.map(d => d.passengers),
        fill: true,
        backgroundColor: gradient,
        borderColor: color,
        borderWidth: 2,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipConfig,
          callbacks: {
            title: (items) => dailyData[items[0].dataIndex].date,
            label: (ctx) => `${formatNumber(ctx.raw)} passengers`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            maxRotation: 0,
            font: { size: 10 },
            maxTicksLimit: 12
          },
          grid: { color: 'rgba(148, 163, 184, 0.05)' }
        },
        y: {
          ticks: {
            callback: (val) => formatNumber(val),
            font: { size: 11 }
          },
          grid: { color: 'rgba(148, 163, 184, 0.06)' },
          beginAtZero: true
        }
      }
    }
  });

  if (chartKey === 'routeForward') routeForwardChart = chart;
  if (chartKey === 'routeReverse') routeReverseChart = chart;
}

// ══════════════════════════════════
// ── 1. Weekday vs Weekend Analysis
// ══════════════════════════════════

function renderWeekdayWeekendChart(data) {
  const ctx = document.getElementById('weekday-weekend-chart');
  if (!ctx) return;
  if (weekdayWeekendChart) weekdayWeekendChart.destroy();

  if (document.getElementById('ww-weekday-avg')) {
    document.getElementById('ww-weekday-avg').textContent = `${formatNumber(data.weekdayAvgDaily)} / day`;
  }
  if (document.getElementById('ww-weekend-avg')) {
    document.getElementById('ww-weekend-avg').textContent = `${formatNumber(data.weekendAvgDaily)} / day`;
  }
  if (document.getElementById('ww-commute-ratio')) {
    document.getElementById('ww-commute-ratio').textContent = `${data.commuteRatio}x Surge`;
  }

  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const weekdayCounts = (data.weekday || []).map(d => Math.round(d.passengers / 64));
  const weekendCounts = (data.weekend || []).map(d => Math.round(d.passengers / 26));

  weekdayWeekendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: hours,
      datasets: [
        {
          label: 'Weekday Avg (Office Rush)',
          data: weekdayCounts,
          borderColor: '#818cf8',
          backgroundColor: 'rgba(99, 102, 241, 0.22)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 6,
          pointBackgroundColor: '#818cf8'
        },
        {
          label: 'Weekend Avg (Leisure Flow)',
          data: weekendCounts,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 6,
          pointBackgroundColor: '#f59e0b'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#cbd5e1', boxWidth: 12, usePointStyle: true, font: { size: 11 } }
        },
        tooltip: {
          ...tooltipConfig,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)} avg passengers`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: (val, idx) => idx % 3 === 0 ? `${idx}h` : '' },
          grid: { color: 'rgba(148, 163, 184, 0.06)' }
        },
        y: {
          ticks: { callback: (val) => formatNumber(val), color: '#94a3b8', font: { size: 10 } },
          grid: { color: 'rgba(148, 163, 184, 0.06)' },
          beginAtZero: true
        }
      }
    }
  });
}

// ══════════════════════════════════
// ── 2. Interchange Load Dynamics
// ══════════════════════════════════

function renderInterchangeCards(data) {
  const container = document.getElementById('interchange-cards-container');
  if (!container) return;

  const hubs = [
    { key: 'majestic', info: data.majestic, desc: 'Central city transit nexus linking East-West Purple Line & North-South Green Line' },
    { key: 'rvRoad', info: data.rvRoad, desc: 'South Bengaluru hub linking the Green Line & the Electronics City Yellow Line' }
  ];

  container.innerHTML = hubs.map(h => {
    const hub = h.info;
    if (!hub) return '';
    const outboundTotal = (hub.outbound || []).reduce((s, d) => s + d.passengers, 0);
    const inboundTotal = (hub.inbound || []).reduce((s, d) => s + d.passengers, 0);
    const total = outboundTotal + inboundTotal;

    const outPills = (hub.outbound || []).map(o => `
      <span class="hub-line-chip ${o.line.toLowerCase()}">
        ● ${o.line}: ${formatNumber(o.passengers)}
      </span>
    `).join('');

    return `
      <div class="interchange-card">
        <div class="interchange-card-top">
          <div>
            <div class="interchange-title">${hub.name}</div>
            <div class="interchange-sub">${h.desc}</div>
          </div>
          <div class="interchange-total-stat">
            <span class="stat-big-val">${formatNumber(total)}</span>
            <span class="stat-big-lbl">90-Day Transfers</span>
          </div>
        </div>

        <div class="interchange-metrics-bar">
          <div class="flow-pill">
            <span class="flow-dir-icon">↗</span>
            <div>
              <span class="flow-lbl">Outbound Volume</span>
              <strong class="flow-val">${formatNumber(outboundTotal)}</strong>
            </div>
          </div>
          <div class="flow-pill">
            <span class="flow-dir-icon">↙</span>
            <div>
              <span class="flow-lbl">Inbound Inflow</span>
              <strong class="flow-val">${formatNumber(inboundTotal)}</strong>
            </div>
          </div>
        </div>

        <div class="interchange-lines-row">
          <span class="corridor-lbl">Corridor Distribution:</span>
          <div class="corridor-pills">${outPills}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════
// ── 3. Station Demand Heatmap Matrix
// ══════════════════════════════════

function renderStationHeatmap(data) {
  const table = document.getElementById('station-heatmap-table');
  if (!table) return;

  let theadHtml = '<thead><tr><th class="hm-station-col">Station</th>';
  for (let h = 0; h < 24; h++) {
    theadHtml += `<th class="hm-hour-col">${h}h</th>`;
  }
  theadHtml += '<th class="hm-total-col">Total</th></tr></thead>';

  let systemMax = 1;
  data.forEach(st => {
    (st.hourly || []).forEach(val => {
      if (val > systemMax) systemMax = val;
    });
  });

  let tbodyHtml = '<tbody>';
  data.forEach(st => {
    const lineClass = (st.line || 'purple').toLowerCase();
    tbodyHtml += `<tr><td class="hm-station-cell">
      <div class="hm-station-name-row">
        <span class="hm-line-dot ${lineClass}"></span>
        <span class="hm-name" title="${st.station_name}">${st.station_name}</span>
      </div>
    </td>`;

    for (let h = 0; h < 24; h++) {
      const val = (st.hourly && st.hourly[h]) || 0;
      const ratio = val / systemMax;
      let bgStyle = '';
      let textClass = 'hm-val-low';

      if (ratio > 0.75) {
        bgStyle = `background: rgba(236, 72, 153, ${0.45 + ratio * 0.5}); box-shadow: inset 0 0 8px rgba(236, 72, 153, 0.4);`;
        textClass = 'hm-val-peak';
      } else if (ratio > 0.45) {
        bgStyle = `background: rgba(168, 85, 247, ${0.35 + ratio * 0.4});`;
        textClass = 'hm-val-high';
      } else if (ratio > 0.2) {
        bgStyle = `background: rgba(99, 102, 241, ${0.22 + ratio * 0.35});`;
        textClass = 'hm-val-mid';
      } else if (val > 0) {
        bgStyle = `background: rgba(30, 41, 59, 0.4);`;
        textClass = 'hm-val-dim';
      } else {
        bgStyle = `background: rgba(15, 23, 42, 0.25);`;
        textClass = 'hm-val-zero';
      }

      const formatted = val > 0 ? formatNumber(val) : '—';
      const tooltip = `${st.station_name} at ${h}:00 — ${val.toLocaleString()} passengers`;
      tbodyHtml += `<td class="hm-cell ${textClass}" style="${bgStyle}" title="${tooltip}">
        <span class="hm-cell-content">${formatted}</span>
      </td>`;
    }

    tbodyHtml += `<td class="hm-total-cell"><strong>${formatNumber(st.total_passengers)}</strong></td></tr>`;
  });
  tbodyHtml += '</tbody>';

  table.innerHTML = theadHtml + tbodyHtml;
}

// ══════════════════════════════════
// ── 4. 90-Day Longitudinal Trend
// ══════════════════════════════════

function renderMonthlyTrendChart(data) {
  const ctx = document.getElementById('monthly-trend-chart');
  if (!ctx) return;
  if (monthlyTrendChart) monthlyTrendChart.destroy();

  const daily = data.daily || [];
  if (data.peakDay && document.getElementById('trend-peak-pill')) {
    document.getElementById('trend-peak-pill').textContent = `🔥 Peak Day: ${data.peakDay.date} (${formatNumber(data.peakDay.passengers)} pax)`;
  }
  if (data.avgDailyPassengers && document.getElementById('trend-avg-pill')) {
    document.getElementById('trend-avg-pill').textContent = `⚡ 90-Day Avg: ${formatNumber(data.avgDailyPassengers)} / day`;
  }

  const labels = daily.map(d => d.date);
  const values = daily.map(d => d.passengers);

  monthlyTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Daily Passengers',
        data: values,
        borderColor: '#a855f7',
        backgroundColor: (context) => {
          const chart = context.chart;
          const { ctx, chartArea } = chart;
          if (!chartArea) return 'rgba(168, 85, 247, 0.15)';
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
          gradient.addColorStop(1, 'rgba(168, 85, 247, 0.01)');
          return gradient;
        },
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointBackgroundColor: '#c084fc',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipConfig,
          callbacks: {
            title: (items) => `Date: ${items[0].label}`,
            label: (ctx) => `Ridership: ${formatNumber(ctx.raw)} passengers`
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            maxRotation: 0,
            callback: (val, idx) => {
              const d = labels[idx];
              if (!d) return '';
              return idx % 10 === 0 ? d.slice(5) : '';
            }
          },
          grid: { color: 'rgba(148, 163, 184, 0.05)' }
        },
        y: {
          ticks: {
            callback: (val) => formatNumber(val),
            color: '#64748b',
            font: { size: 10 }
          },
          grid: { color: 'rgba(148, 163, 184, 0.06)' },
          beginAtZero: false
        }
      }
    }
  });
}

// ══════════════════════════════════
// ── 5. Smart Metro Locator & Nearby Search
// ══════════════════════════════════

let allBangaloreAreas = [];
let currentNearbyStations = [];
let activeNearbyFilterRadius = 50000;

async function initNearbySection() {
  try {
    const res = await fetch('/api/stations/areas');
    if (res.ok) {
      allBangaloreAreas = await res.json();
    }
  } catch (err) {
    console.warn('Could not load areas from API:', err);
  }

  renderPopularAreaChips();
  setupAreaAutocomplete();

  // Custom coordinates toggle
  const toggleBtn = document.getElementById('btn-toggle-coords');
  const coordsForm = document.getElementById('coords-form');
  const toggleIcon = document.getElementById('coords-toggle-icon');
  if (toggleBtn && coordsForm) {
    toggleBtn.addEventListener('click', () => {
      const isOpen = coordsForm.style.display !== 'none';
      coordsForm.style.display = isOpen ? 'none' : 'block';
      if (toggleIcon) toggleIcon.textContent = isOpen ? '▸' : '▾';
    });
  }

  if (coordsForm) {
    coordsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lat = parseFloat(document.getElementById('nearby-lat').value);
      const lng = parseFloat(document.getElementById('nearby-lng').value);
      if (!isNaN(lat) && !isNaN(lng)) {
        await searchNearby(lat, lng, `Coordinates (${lat.toFixed(3)}, ${lng.toFixed(3)})`);
      }
    });
  }

  // GPS Location button
  const gpsBtn = document.getElementById('btn-use-location');
  if (gpsBtn) {
    gpsBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }
      gpsBtn.classList.add('scanning');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          gpsBtn.classList.remove('scanning');
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const input = document.getElementById('nearby-area-input');
          if (input) input.value = `📍 Current Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
          await searchNearby(lat, lng, 'Your Current Location');
        },
        (err) => {
          gpsBtn.classList.remove('scanning');
          alert('Unable to detect GPS location: ' + err.message);
        },
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  // Radius filter pills
  const radiusPills = document.querySelectorAll('.nearby-radius-filter .radius-pill');
  radiusPills.forEach(pill => {
    pill.addEventListener('click', () => {
      radiusPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeNearbyFilterRadius = parseInt(pill.dataset.radius, 10) || 50000;
      renderNearbyCards(currentNearbyStations, activeNearbyFilterRadius);
    });
  });

  // Default initial scan around central city (MG Road / Vidhana Soudha)
  searchNearby(12.9756, 77.6080, 'MG Road / Central Bengaluru');
}

function renderPopularAreaChips() {
  const container = document.getElementById('quick-area-chips');
  if (!container) return;

  const popularNames = [
    'Indiranagar', 'Koramangala', 'Whitefield', 'HSR Layout',
    'MG Road', 'Malleshwaram', 'BTM Layout', 'Electronic City',
    'Jayanagar', 'Cubbon Park', 'Central Silk Board', 'Hebbal'
  ];

  container.innerHTML = popularNames.map(name => {
    const area = allBangaloreAreas.find(a => a.name.toLowerCase() === name.toLowerCase()) || {
      name, coordinates: [77.6, 12.97]
    };
    return `<button type="button" class="quick-chip" onclick="window.__selectAreaChip('${area.name}')">${area.name}</button>`;
  }).join('');
}

window.__selectAreaChip = function (areaName) {
  const area = allBangaloreAreas.find(a => a.name.toLowerCase() === areaName.toLowerCase());
  if (!area) return;
  const input = document.getElementById('nearby-area-input');
  const clearBtn = document.getElementById('btn-clear-area');
  const dropdown = document.getElementById('nearby-dropdown');

  if (input) input.value = area.name;
  if (clearBtn) clearBtn.style.display = 'block';
  if (dropdown) dropdown.style.display = 'none';

  searchNearby(area.coordinates[1], area.coordinates[0], area.name);
};

function setupAreaAutocomplete() {
  const input = document.getElementById('nearby-area-input');
  const clearBtn = document.getElementById('btn-clear-area');
  const dropdown = document.getElementById('nearby-dropdown');
  if (!input || !dropdown) return;

  let selectedIdx = -1;

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (!val) {
      dropdown.style.display = 'none';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }
    if (clearBtn) clearBtn.style.display = 'block';

    const matches = allBangaloreAreas.filter(a =>
      a.name.toLowerCase().includes(val) ||
      a.category.toLowerCase().includes(val) ||
      (a.description && a.description.toLowerCase().includes(val))
    ).slice(0, 8);

    if (!matches.length) {
      dropdown.innerHTML = '<div class="dropdown-empty">No matching Bengaluru areas found</div>';
      dropdown.style.display = 'block';
      return;
    }

    selectedIdx = -1;
    dropdown.innerHTML = matches.map((m, idx) => `
      <div class="dropdown-item" data-idx="${idx}">
        <div class="dd-title-row">
          <strong class="dd-name">${m.name}</strong>
          <span class="dd-cat">${m.category}</span>
        </div>
        <div class="dd-desc">${m.description || ''}</div>
      </div>
    `).join('');

    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.idx, 10);
        const area = matches[idx];
        if (area) {
          input.value = area.name;
          dropdown.style.display = 'none';
          searchNearby(area.coordinates[1], area.coordinates[0], area.name);
        }
      });
    });
  });

  input.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.dropdown-item');
    if (dropdown.style.display === 'none' || !items.length) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = allBangaloreAreas.find(a => a.name.toLowerCase().includes(input.value.trim().toLowerCase()));
        if (first) {
          input.value = first.name;
          searchNearby(first.coordinates[1], first.coordinates[0], first.name);
        }
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % items.length;
      items.forEach((item, i) => item.classList.toggle('highlighted', i === selectedIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + items.length) % items.length;
      items.forEach((item, i) => item.classList.toggle('highlighted', i === selectedIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && items[selectedIdx]) {
        items[selectedIdx].click();
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none';
    }
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      dropdown.style.display = 'none';
      input.focus();
    });
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.nearby-search-box')) {
      dropdown.style.display = 'none';
    }
  });
}

async function searchNearby(lat, lng, locationLabel = '') {
  const container = document.getElementById('nearby-results');
  const statusBar = document.getElementById('nearby-status-bar');
  const statusText = document.getElementById('nearby-status-text');

  if (statusBar) statusBar.style.display = 'flex';
  if (statusText) statusText.innerHTML = `Scanning 2dsphere index for stations near <strong>${locationLabel || 'coordinates'}</strong>…`;

  container.innerHTML = `
    <div class="nearby-loading-state">
      <div class="radar-scan-anim"></div>
      <div class="nl-text">Executing MongoDB 2dsphere $geoNear spatial pipeline…</div>
    </div>
  `;

  try {
    const res = await fetch(`/api/stations/nearby?lat=${lat}&lng=${lng}&limit=12`);
    if (!res.ok) throw new Error(`Nearby search failed: ${res.status}`);
    const data = await res.json();
    currentNearbyStations = data;

    if (!data.length) {
      container.innerHTML = `
        <div class="nearby-empty-state">
          <span class="ne-icon">📍</span>
          <strong>No Stations within 50 km</strong>
          <p>No metro stations found near ${locationLabel}. Try another locality in Bengaluru.</p>
        </div>
      `;
      return;
    }

    if (statusText) {
      statusText.innerHTML = `Showing <strong>${data.length} closest stations</strong> to <strong>${locationLabel || 'location'}</strong>`;
    }

    renderNearbyCards(data, activeNearbyFilterRadius);
  } catch (err) {
    console.error('Nearby search failed:', err);
    container.innerHTML = `<div class="nearby-error-state">⚠️ Failed to query geospatial nearby stations. Check coordinates and try again.</div>`;
  }
}

function renderNearbyCards(stations, maxDistanceMeters = 50000) {
  const container = document.getElementById('nearby-results');
  const filtered = stations.filter(s => s.distance_meters <= maxDistanceMeters);

  if (!filtered.length) {
    container.innerHTML = `
      <div class="nearby-empty-state">
        <span class="ne-icon">🔍</span>
        <strong>No stations within this distance filter</strong>
        <p>Try clicking a wider radius like &lt; 10 km or All.</p>
      </div>
    `;
    return;
  }

  const lc = { Purple: '#a855f7', Green: '#22c55e', Yellow: '#eab308' };

  container.innerHTML = filtered.map((s, i) => {
    const distKm = (s.distance_meters / 1000).toFixed(2);
    const color = lc[s.line] || '#6366f1';
    const walkMins = Math.max(1, Math.round(s.distance_meters / 80));
    const driveMins = Math.max(1, Math.round(s.distance_meters / 350));
    const lineClass = (s.line || 'purple').toLowerCase();

    return `
      <div class="nearby-futuristic-card fade-in" style="animation-delay: ${i * 40}ms; --card-accent: ${color};">
        <div class="nfc-top">
          <div class="nfc-station-badge">
            <span class="nfc-line-dot ${lineClass}"></span>
            <span class="nfc-line-name">${s.line} Line</span>
          </div>
          <div class="nfc-distance-tag">
            <span class="dist-val">${distKm}</span>
            <span class="dist-unit">km</span>
          </div>
        </div>

        <div class="nfc-name">${s.name}</div>

        <div class="nfc-commute-estimate">
          <div class="nfc-est-item">
            <span class="est-icon">🚶</span>
            <span class="est-val">${walkMins} min</span>
            <span class="est-sub">walk</span>
          </div>
          <div class="nfc-est-item">
            <span class="est-icon">🚗</span>
            <span class="est-val">${driveMins} min</span>
            <span class="est-sub">cab / auto</span>
          </div>
          <div class="nfc-est-item">
            <span class="est-icon">🎯</span>
            <span class="est-val">#${s.sequence}</span>
            <span class="est-sub">sequence</span>
          </div>
        </div>

        <div class="nfc-meta-row">
          ${s.is_interchange ? '<span class="nfc-interchange-badge">⇄ Interchange Junction</span>' : '<span class="nfc-regular-badge">● Standard Station</span>'}
          <span class="nfc-raw-dist">${Math.round(s.distance_meters)}m exact</span>
        </div>

        <div class="nfc-actions">
          <button type="button" class="btn-nfc-action btn-nfc-map" onclick="window.focusStationOnMap('${s._id}')">
            <span>🗺️</span> View on Map
          </button>
          <button type="button" class="btn-nfc-action btn-nfc-route" onclick="window.setRouteToStation('${s._id}')">
            <span>🔀</span> Plan Route
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// ── Initialize ──
populateStationDropdowns();
initNearbySection();

