/**
 * Namma Metro Map — Leaflet.js Interactive Map
 * ==============================================
 * - Plots all stations as colored markers by line
 * - Draws polylines for each metro line
 * - On click: loads station stats and shows Chart.js popup
 * - Interchange stations get special markers
 */

// ── Map Initialization ──
const map = L.map('metro-map', {
  center: [12.9716, 77.5946],
  zoom: 12,
  zoomControl: true,
  attributionControl: true
});

// Free OpenStreetMap tile layer with dark styling (no API key required)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  className: 'dark-tiles',
  maxZoom: 19
}).addTo(map);

// ── Line Colors ──
const LINE_COLORS = {
  Purple: '#a855f7',
  Green: '#22c55e',
  Yellow: '#eab308'
};

const LINE_BG_COLORS = {
  Purple: 'rgba(168, 85, 247, 0.15)',
  Green: 'rgba(34, 197, 94, 0.15)',
  Yellow: 'rgba(234, 179, 8, 0.15)'
};

// ── Store for stations data ──
let allStations = [];
let stationMarkers = {};

// ── Station Marker Icon ──
function createStationIcon(line, isInterchange) {
  const color = LINE_COLORS[line] || '#6366f1';
  const size = isInterchange ? 14 : 10;
  const borderWidth = isInterchange ? 3 : 2;

  return L.divIcon({
    className: 'custom-station-marker',
    html: `<div style="
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border: ${borderWidth}px solid ${isInterchange ? '#ffffff' : 'rgba(255,255,255,0.6)'};
      border-radius: 50%;
      box-shadow: 0 0 ${isInterchange ? '12' : '8'}px ${color}80;
      transition: transform 0.2s, box-shadow 0.2s;
    "></div>`,
    iconSize: [size + borderWidth * 2, size + borderWidth * 2],
    iconAnchor: [(size + borderWidth * 2) / 2, (size + borderWidth * 2) / 2]
  });
}

// ── Station Stats Cache ──
const stationStatsCache = {};

// ── Hotspots Cache & Category Icons ──
const stationHotspotsCache = {};
const HOTSPOT_ICONS = {
  'Park': '🌳',
  'Monument': '🗿',
  'Museum': '🏛️',
  'Art Gallery': '🖼️',
  'Stadium': '🏟️',
  'Church': '⛪',
  'Market': '🛍️',
  'Mall': '🏬',
  'Lake': '🌊',
  'Food & Nightlife': '🍽️',
  'Tech Park': '💼',
  'Temple': '🛕',
  'Palace': '🏰',
  'Landmark': '📍'
};

// ── Format Number ──
function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return (n || 0).toLocaleString();
}

function getPeakHour(hourlyBreakdown = []) {
  return hourlyBreakdown.reduce((peak, item) =>
    !peak || item.passengers > peak.passengers ? item : peak, null);
}

// ── Station Rankings Cache ──
let stationRankings = new Map();

window.__switchPopupTab = function (btn, tabName) {
  const container = btn.closest('.station-popup-inner');
  if (!container) return;
  container.querySelectorAll('.popup-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  container.querySelectorAll('.popup-tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = container.querySelector(`.pane-${tabName}`);
  if (targetPane) targetPane.classList.add('active');

  const openMarker = Object.values(stationMarkers || {}).find(m => m.isPopupOpen && m.isPopupOpen());
  if (openMarker) {
    const p = openMarker.getPopup();
    if (p) p.update();
  }
};

window.setRouteFromStation = function (stationId) {
  const fromSelect = document.getElementById('from-station');
  if (fromSelect) {
    fromSelect.value = stationId;
  }
  switchView('routes');
};

window.setRouteToStation = function (stationId) {
  const toSelect = document.getElementById('to-station');
  if (toSelect) {
    toSelect.value = stationId;
  }
  switchView('routes');
};

// ── Create Station Popup Element ──
function createPopupElement(station, data = null) {
  const container = document.createElement('div');
  container.className = 'station-popup-inner';
  const lineClass = station.line.toLowerCase();
  const rank = stationRankings.get(station._id);
  const rankBadge = rank
    ? `<span class="popup-rank-pill top-rank">👑 Rank #${rank} Network Busiest</span>`
    : `<span class="popup-rank-pill">● Sequence #${station.sequence}</span>`;

  if (!data) {
    container.innerHTML = `
      <div class="popup-header">
        <div class="popup-kicker-row">
          <span class="popup-telemetry-status"><span class="pulse-ring"></span> Live Telemetry</span>
          ${rankBadge}
        </div>
        <div class="popup-heading-row">
          <div class="popup-station-name">${station.name}</div>
          <span class="popup-line-badge ${lineClass}">● ${station.line}</span>
        </div>
        <div class="popup-station-meta">Station ${station.sequence}${station.is_interchange ? ' · ⇄ Multi-Line Interchange' : ''} · 90-Day Analytics</div>
      </div>
      <div class="popup-loading">
        <div class="spinner"></div>
        <div>Aggregating station telemetry & ridership signals…</div>
      </div>
    `;
    return container;
  }

  const peakHour = getPeakHour(data.hourly_breakdown);
  const peakTime = peakHour ? `${String(peakHour.hour).padStart(2, '0')}:00` : '—';
  const nextHourStr = peakHour ? `${String((peakHour.hour + 1) % 24).padStart(2, '0')}:00` : '—';
  const peakDailyAverage = peakHour ? Math.round(peakHour.passengers / 90) : 0;
  const avgDailyTotal = Math.round(data.total_passengers / 90);

  container.innerHTML = `
    <div class="popup-header">
      <div class="popup-kicker-row">
        <span class="popup-telemetry-status"><span class="pulse-ring"></span> Live Telemetry</span>
        ${rankBadge}
      </div>
      <div class="popup-heading-row">
        <div class="popup-station-name">${station.name}</div>
        <span class="popup-line-badge ${lineClass}">● ${station.line} Line</span>
      </div>
      <div class="popup-station-meta">Station #${station.sequence}${station.is_interchange ? ' · ⇄ Multi-Line Interchange' : ''} · 90-Day Dataset</div>
      
      <!-- Dual View Tabs -->
      <div class="popup-tab-nav">
        <button type="button" class="popup-tab-btn active" onclick="window.__switchPopupTab(this, 'telemetry')">
          <span class="tab-icon">⚡</span> Ridership Telemetry
        </button>
        <button type="button" class="popup-tab-btn" onclick="window.__switchPopupTab(this, 'hotspots')">
          <span class="tab-icon">📍</span> Nearby Hotspots <span class="hotspot-badge-pill" id="hotspot-badge-${station._id}">…</span>
        </button>
      </div>
    </div>

    <div class="popup-body">
      <!-- TAB 1: TELEMETRY & HOURLY DEMAND -->
      <div class="popup-tab-pane pane-telemetry active">
        <div class="popup-stats-grid">
          <div class="popup-stat-box">
            <div class="ps-label">Total Volume</div>
            <div class="ps-value">${formatNumber(data.total_passengers)}</div>
            <div class="ps-sub">Entries + Exits</div>
          </div>
          <div class="popup-stat-box">
            <div class="ps-label">Daily Average</div>
            <div class="ps-value">${formatNumber(avgDailyTotal)}</div>
            <div class="ps-sub">Passengers / day</div>
          </div>
          <div class="popup-stat-box">
            <div class="ps-label">Total Journeys</div>
            <div class="ps-value">${formatNumber(data.total_trips)}</div>
            <div class="ps-sub">Recorded trips</div>
          </div>
        </div>

        <div class="popup-peak-banner">
          <div class="peak-icon-wrap">⚡</div>
          <div class="peak-info">
            <div class="peak-title">Peak Surge: <strong>${peakTime} – ${nextHourStr}</strong></div>
            <div class="peak-desc">${formatNumber(peakDailyAverage)} avg. passengers / hr · ${peakHour && peakHour.hour < 12 ? 'Morning Commute Wave' : 'Evening Return Wave'}</div>
          </div>
        </div>

        <div class="popup-chart-section">
          <div class="popup-chart-header">
            <span>24-Hour Diurnal Demand Curve</span>
            <span class="chart-tag">${peakTime} peak</span>
          </div>
          <div class="popup-chart-wrapper">
            <canvas class="popup-chart"></canvas>
          </div>
        </div>

        <div class="popup-actions-row">
          <button type="button" class="btn-popup-action origin" onclick="window.setRouteFromStation('${station._id}')">
            <span>🔀</span> Set Origin
          </button>
          <button type="button" class="btn-popup-action dest" onclick="window.setRouteToStation('${station._id}')">
            <span>🎯</span> Set Destination
          </button>
        </div>
      </div>

      <!-- TAB 2: NEARBY HOTSPOTS -->
      <div class="popup-tab-pane pane-hotspots">
        <div class="popup-section-heading">
          <span>Points of Interest & Landmarks</span>
          <span class="hotspot-radius">Within 3 km</span>
        </div>
        <div class="hotspot-list">
          <div class="hotspot-loading">
            <div class="spinner"></div>
            <div>Scanning places near ${station.name}...</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const canvas = container.querySelector('canvas');
  if (canvas) {
    const hourlyData = new Array(24).fill(0);
    for (const h of (data.hourly_breakdown || [])) {
      hourlyData[h.hour] = h.passengers;
    }
    const color = LINE_COLORS[station.line] || '#6366f1';

    requestAnimationFrame(() => {
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createLinearGradient(0, 0, 0, 130);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, color + '22');

      new Chart(canvas, {
        type: 'bar',
        data: {
          labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
          datasets: [{
            data: hourlyData,
            backgroundColor: gradient,
            borderColor: color,
            borderWidth: 1.5,
            borderRadius: 3,
            hoverBackgroundColor: color,
            barPercentage: 0.8
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 350 },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(6, 9, 20, 0.95)',
              titleColor: '#f1f5f9',
              bodyColor: '#cbd5e1',
              borderColor: color + '60',
              borderWidth: 1,
              cornerRadius: 6,
              padding: 8,
              titleFont: { size: 11, weight: '600' },
              bodyFont: { size: 11 },
              callbacks: {
                title: (items) => `Window: ${items[0].label}`,
                label: (ctx) => `Demand: ${formatNumber(ctx.raw)} (${formatNumber(Math.round(ctx.raw / 90))}/day)`
              }
            }
          },
          scales: {
            x: {
              display: true,
              ticks: {
                color: '#64748b',
                font: { size: 9, weight: '600' },
                maxRotation: 0,
                callback: (val, idx) => idx % 4 === 0 ? `${idx}h` : ''
              },
              grid: { display: false }
            },
            y: {
              display: false,
              beginAtZero: true
            }
          }
        }
      });
    });
  }

  return container;
}

// ── Open / Load Popup ──
async function handleMarkerOpen(station, marker) {
  const popup = marker.getPopup();
  if (!popup) return;

  const renderFull = (data) => {
    popup.setContent(createPopupElement(station, data));
    popup.update();
    loadStationHotspots(station, marker);
  };

  if (stationStatsCache[station._id]) {
    renderFull(stationStatsCache[station._id]);
    return;
  }

  popup.setContent(createPopupElement(station, null));
  popup.update();

  try {
    const res = await fetch(`/api/stations/${station._id}/stats`);
    const data = await res.json();
    stationStatsCache[station._id] = data;

    if (marker.isPopupOpen()) {
      renderFull(data);
    }
  } catch (err) {
    console.error('Failed to load station stats:', err);
    if (marker.isPopupOpen()) {
      const errDiv = document.createElement('div');
      errDiv.innerHTML = `
        <div class="popup-header">
          <div class="popup-station-name">${station.name}</div>
        </div>
        <div style="color:#ef4444; padding:16px; font-size:12px; text-align:center;">Failed to load station telemetry</div>
      `;
      popup.setContent(errDiv);
      popup.update();
    }
  }
}

// ── Nearby Hotspots (per station) ──
const HOTSPOT_PREVIEW_COUNT = 3;

async function loadStationHotspots(station, marker) {
  const popup = marker.getPopup();
  if (!popup) return;
  const content = popup.getContent();
  const listEl = (content && typeof content.querySelector === 'function')
    ? content.querySelector('.hotspot-list')
    : null;
  if (!listEl) return;

  if (stationHotspotsCache[station._id]) {
    renderHotspotList(station, listEl, stationHotspotsCache[station._id]);
    return;
  }

  try {
    const res = await fetch(`/api/stations/${station._id}/hotspots?limit=6&radius=3000`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    stationHotspotsCache[station._id] = payload;
    renderHotspotList(station, listEl, payload);
  } catch (err) {
    console.error('Failed to load hotspots:', err);
    listEl.innerHTML = '<div class="hotspot-empty">⚠️ Couldn\'t load nearby places</div>';
  }
}

function formatDistance(meters) {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

window.__toggleHotspots = function (btn, e) {
  if (e && e.stopPropagation) e.stopPropagation();
  const section = btn.closest('.popup-tab-pane') || btn.closest('.popup-hotspots');
  const list = section && section.querySelector('.hotspot-list');
  if (!list) return;
  const showAll = !list.classList.contains('expanded');
  list.classList.toggle('expanded', showAll);
  btn.textContent = showAll
    ? 'Show fewer places'
    : `Show ${Math.max(0, list.querySelectorAll('.hotspot-item').length - HOTSPOT_PREVIEW_COUNT)} more places`;
  const openMarker = Object.values(stationMarkers || {}).find(m => m.isPopupOpen && m.isPopupOpen());
  if (openMarker) {
    const p = openMarker.getPopup();
    if (p) p.update();
  }
};

function renderHotspotList(station, listEl, payload) {
  const hotspots = (payload && payload.hotspots) || [];
  const section = listEl.closest('.popup-tab-pane') || listEl.closest('.popup-hotspots');
  const radiusLabel = section && section.querySelector('.hotspot-radius');
  if (radiusLabel) radiusLabel.textContent = payload?.fallback ? 'Closest available' : 'Within 3 km';

  // Update badge pill in popup header tab
  const badgePill = document.getElementById(`hotspot-badge-${station._id}`);
  if (badgePill) {
    badgePill.textContent = hotspots.length ? `${hotspots.length}` : '0';
  }

  if (section) {
    section.querySelectorAll('.hotspot-toggle, .hotspot-note').forEach(n => n.remove());
  }

  if (!hotspots.length) {
    listEl.innerHTML = '<div class="hotspot-empty">No hotspots found nearby.</div>';
    listEl.classList.remove('expanded');
    return;
  }

  const rows = hotspots.map((h, i) => `
    <div class="hotspot-item${i === 0 ? ' hotspot-primary' : ''}${i >= HOTSPOT_PREVIEW_COUNT ? ' hotspot-extra' : ''}" title="${(h.description || '').replace(/"/g, '&quot;')}">
      <span class="hotspot-icon">${HOTSPOT_ICONS[h.category] || '📍'}</span>
      <div class="hotspot-info">
        <div class="hotspot-name">${h.name}</div>
        <div class="hotspot-meta">
          <span class="hotspot-cat">${h.category}</span>
          ${h.rating != null ? `<span class="hotspot-star">★ ${h.rating.toFixed(1)}</span>` : ''}
          <span class="hotspot-walk">🚶 ${h.walk_minutes} min</span>
        </div>
      </div>
      <span class="hotspot-distance">${formatDistance(h.distance_meters)}</span>
    </div>
  `).join('');
  listEl.innerHTML = rows;
  listEl.classList.remove('expanded');

  let toggle = '';
  if (hotspots.length > HOTSPOT_PREVIEW_COUNT) {
    toggle = `<button class="hotspot-toggle" type="button" onclick="__toggleHotspots(this, event)">Show ${hotspots.length - HOTSPOT_PREVIEW_COUNT} more places</button>`;
  }

  const note = payload.fallback
    ? '<div class="hotspot-note">Closest known places — beyond the preferred walking radius</div>'
    : '';

  if (section) listEl.insertAdjacentHTML('afterend', toggle + note);
}

// ── Draw Metro Lines ──
function drawMetroLines(stations) {
  const lines = {};

  for (const station of stations) {
    if (!lines[station.line]) lines[station.line] = [];
    lines[station.line].push(station);
  }

  for (const [lineName, lineStations] of Object.entries(lines)) {
    // Sort by sequence
    lineStations.sort((a, b) => a.sequence - b.sequence);

    const coords = lineStations.map(s => [s.location.coordinates[1], s.location.coordinates[0]]);
    const color = LINE_COLORS[lineName] || '#6366f1';

    // Draw the line
    L.polyline(coords, {
      color: color,
      weight: 3,
      opacity: 0.7,
      smoothFactor: 1.5,
      dashArray: null
    }).addTo(map);

    // Draw a subtle glow behind
    L.polyline(coords, {
      color: color,
      weight: 8,
      opacity: 0.15,
      smoothFactor: 1.5
    }).addTo(map);
  }
}

// ── Plot Station Markers ──
function plotStations(stations) {
  for (const station of stations) {
    const lat = station.location.coordinates[1];
    const lng = station.location.coordinates[0];

    const marker = L.marker([lat, lng], {
      icon: createStationIcon(station.line, station.is_interchange),
      title: station.name
    }).addTo(map);

    // Bind popup with clean initial content
    const popup = L.popup({
      className: 'station-popup',
      maxWidth: 420,
      minWidth: 350,
      offset: [0, -12],
      closeButton: true,
      autoPan: true,
      autoPanPadding: [40, 40],
      autoPanPaddingTopLeft: [40, 130],
      autoPanPaddingBottomRight: [40, 40]
    }).setContent(createPopupElement(station, null));

    marker.bindPopup(popup);

    // Load / display stats when popup opens
    marker.on('popupopen', () => {
      handleMarkerOpen(station, marker);
    });

    stationMarkers[station._id] = marker;
  }
}

// ── Initialize Map ──
async function initMap() {
  try {
    const [stationsRes, topRes] = await Promise.all([
      fetch('/api/stations').then(r => r.json()),
      fetch('/api/analytics/top-stations').then(r => r.ok ? r.json() : []).catch(() => [])
    ]);

    allStations = stationsRes;

    // Populate rankings
    stationRankings.clear();
    if (Array.isArray(topRes)) {
      topRes.forEach((s, idx) => {
        stationRankings.set(s.station_id || s._id, idx + 1);
      });
    }

    // Update legend counts
    const counts = { Purple: 0, Green: 0, Yellow: 0 };
    for (const s of allStations) {
      if (counts[s.line] !== undefined) counts[s.line]++;
    }
    document.getElementById('purple-count').textContent = counts.Purple;
    document.getElementById('green-count').textContent = counts.Green;
    document.getElementById('yellow-count').textContent = counts.Yellow;

    // Draw lines first (behind markers)
    drawMetroLines(allStations);

    // Plot markers
    plotStations(allStations);

    console.log(`🗺️ Map loaded: ${allStations.length} stations, ${stationRankings.size} ranked`);
  } catch (err) {
    console.error('Failed to initialize map:', err);
  }
}

// ── View Navigation ──
const navButtons = document.querySelectorAll('.nav-btn');
const views = {
  map: document.getElementById('view-map'),
  routes: document.getElementById('view-routes'),
  dashboard: document.getElementById('view-dashboard'),
  nearby: document.getElementById('view-nearby')
};

function switchView(viewName) {
  // Update nav buttons
  navButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Show/hide views
  for (const [name, el] of Object.entries(views)) {
    if (name === 'map') {
      el.classList.toggle('active', name === viewName);
      el.style.display = name === viewName ? '' : 'none';
    } else {
      el.classList.toggle('active', name === viewName);
    }
  }

  // Invalidate map size when switching back to map
  if (viewName === 'map') {
    setTimeout(() => map.invalidateSize(), 100);
  }

  // Load dashboard data on first view
  if (viewName === 'dashboard' && !window._dashboardLoaded) {
    window._dashboardLoaded = true;
    if (typeof loadDashboard === 'function') loadDashboard();
  }
}

navButtons.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ── Focus & Open Station Marker ──
function focusStationOnMap(stationId) {
  switchView('map');
  const marker = stationMarkers[stationId];
  if (marker) {
    const latLng = marker.getLatLng();
    map.flyTo(latLng, 14, { duration: 0.8 });
    setTimeout(() => {
      marker.openPopup();
    }, 850);
  }
}

// ── Start ──
initMap();

// Export for use in dashboard.js
window.allStations = allStations;
window.stationMarkers = stationMarkers;
window.initMap = initMap;
window.formatNumber = formatNumber;
window.LINE_COLORS = LINE_COLORS;
window.switchView = switchView;
window.focusStationOnMap = focusStationOnMap;

