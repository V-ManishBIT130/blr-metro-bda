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
    const { topStations, peakHours, lineStats, topRoutes } = await overviewRes.json();
    const stationsData = await stationsRes;

    // ── Summary Stats ──
    const totalPassengers = topStations.reduce((sum, s) => sum + s.total_passengers, 0);
    const totalTrips = topStations.reduce((sum, s) => sum + s.total_trips, 0);
    // Better: use line stats for true totals
    const lineTotal = lineStats.reduce((sum, l) => sum + l.passengers, 0);
    const lineTripTotal = lineStats.reduce((sum, l) => sum + l.trips, 0);

    document.getElementById('stat-stations').textContent = stationsData.length;
    document.getElementById('stat-trips').textContent = formatNumber(lineTripTotal);
    document.getElementById('stat-passengers').textContent = formatNumber(lineTotal);

    // ── Network Pulse ──
    // This translates the dashboard's raw aggregates into a quick planning read:
    // when demand is strongest, how commute-led it is, and where it concentrates.
    renderNetworkPulse({ topStations, peakHours, lineStats, topRoutes, totalPassengers: lineTotal });

    // ── Top Stations Bar Chart ──
    renderTopStationsChart(topStations);

    // ── Peak Hours Chart ──
    renderPeakHoursChart(peakHours);

    // ── Line Stats Doughnut ──
    renderLineStatsChart(lineStats);

    // ── Top Routes Table ──
    renderTopRoutesTable(topRoutes);

    console.log('📊 Dashboard loaded');
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
// ── Nearby Stations
// ══════════════════════════════════

document.getElementById('nearby-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const lat = document.getElementById('nearby-lat').value;
  const lng = document.getElementById('nearby-lng').value;
  await searchNearby(lat, lng);
});

document.getElementById('btn-use-location').addEventListener('click', () => {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by your browser.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('nearby-lat').value = pos.coords.latitude.toFixed(4);
      document.getElementById('nearby-lng').value = pos.coords.longitude.toFixed(4);
      searchNearby(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      alert('Unable to get your location: ' + err.message);
    }
  );
});

async function searchNearby(lat, lng) {
  const container = document.getElementById('nearby-results');
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = '<div class="nearby-message">Finding nearby stations…</div>';
  try {
    const res = await fetch(`/api/stations/nearby?lat=${lat}&lng=${lng}&limit=10`);
    if (!res.ok) throw new Error(`Nearby search failed: ${res.status}`);
    const data = await res.json();

    const lc = { Purple: '#a855f7', Green: '#22c55e', Yellow: '#eab308' };

    if (!data.length) {
      container.innerHTML = '<div class="nearby-message">No stations found within 50 km of these coordinates.</div>';
      return;
    }

    container.innerHTML = data.map((s, i) => {
      const distKm = (s.distance_meters / 1000).toFixed(2);
      const color = lc[s.line] || '#6366f1';
      return `
        <div class="nearby-card fade-in" style="animation-delay: ${i * 50}ms; border-left: 3px solid ${color};">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <strong style="font-size:15px;">${s.name}</strong>
            <span class="distance">${distKm} km</span>
          </div>
          <span class="popup-line-badge ${s.line.toLowerCase()}" style="margin-bottom:4px;">
            ● ${s.line} Line
          </span>
          <div style="margin-top:8px;font-size:12px;color:var(--text-muted);">
            ${s.is_interchange ? '⇄ Interchange Station · ' : ''}
            Station #${s.sequence} · ${s.distance_meters.toFixed(0)}m away
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Nearby search failed:', err);
    container.innerHTML = '<div class="nearby-message error">We could not find nearby stations. Check the coordinates and try again.</div>';
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

// ── Initialize ──
populateStationDropdowns();
