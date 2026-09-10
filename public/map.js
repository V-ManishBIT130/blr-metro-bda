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

// ── Create Station Popup Element ──
function createPopupElement(station, data = null) {
  const container = document.createElement('div');
  const lineClass = station.line.toLowerCase();

  if (!data) {
    container.innerHTML = `
      <div class="popup-header">
        <div class="popup-kicker">Station insight</div>
        <div class="popup-heading-row">
          <div class="popup-station-name">${station.name}</div>
          <span class="popup-line-badge ${lineClass}">● ${station.line}</span>
        </div>
        <div class="popup-station-meta">Station ${station.sequence}${station.is_interchange ? ' · Interchange' : ''} · 90-day dataset</div>
      </div>
      <div class="popup-loading">
        <div class="spinner"></div>
        <div>Loading station signals…</div>
      </div>
    `;
    return container;
  }

  const peakHour = getPeakHour(data.hourly_breakdown);
  const peakTime = peakHour ? `${String(peakHour.hour).padStart(2, '0')}:00` : '—';
  const peakDailyAverage = peakHour ? Math.round(peakHour.passengers / 90) : 0;

  container.innerHTML = `
    <div class="popup-header">
      <div class="popup-kicker">Station insight</div>
      <div class="popup-heading-row">
        <div class="popup-station-name">${station.name}</div>
        <span class="popup-line-badge ${lineClass}">● ${station.line}</span>
      </div>
      <div class="popup-station-meta">Station ${station.sequence}${station.is_interchange ? ' · Interchange' : ''} · 90-day dataset</div>
    </div>
    <div class="popup-body">
      <div class="popup-stats">
        <div class="popup-stat">
          <div class="popup-stat-label">Total Passengers</div>
          <div class="popup-stat-value">${formatNumber(data.total_passengers)}</div>
          <div class="popup-stat-detail">Entries + exits</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-label">Total Trips</div>
          <div class="popup-stat-value">${formatNumber(data.total_trips)}</div>
          <div class="popup-stat-detail">Recorded journeys</div>
        </div>
      </div>
      <div class="popup-demand-callout">
        <span class="popup-demand-icon">↗</span>
        <div><span>Peak movement</span><strong>${peakTime}</strong></div>
        <small>${formatNumber(peakDailyAverage)} avg. passengers / day</small>
      </div>
      <div class="popup-chart-container">
        <div class="popup-section-heading"><span>Ridership by hour</span><span>${peakTime} peak</span></div>
        <div class="popup-chart-wrapper">
          <canvas class="popup-chart"></canvas>
        </div>
      </div>
      <div class="popup-hotspots">
        <div class="popup-section-heading"><span>Nearby hotspots</span><span class="hotspot-radius">Within 3 km</span></div>
        <div class="hotspot-list">
          <div class="hotspot-loading">
            <div class="spinner"></div>
            <div>Finding places near ${station.name}...</div>
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
      new Chart(canvas, {
        type: 'bar',
        data: {
          labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
          datasets: [{
            data: hourlyData,
              backgroundColor: color + 'a8',
            borderColor: color,
            borderWidth: 1,
            borderRadius: 2,
            barPercentage: 0.75
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(10, 14, 26, 0.95)',
              titleColor: '#f1f5f9',
              bodyColor: '#94a3b8',
              borderColor: 'rgba(148, 163, 184, 0.15)',
              borderWidth: 1,
              cornerRadius: 6,
              padding: 8,
            titleFont: { size: 11 },
            bodyFont: { size: 11 },
              callbacks: {
                label: (ctx) => `${formatNumber(ctx.raw)} passengers`
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

  // Renders the full popup (stats + chart) and kicks off the hotspots fetch
  const renderFull = (data) => {
    popup.setContent(createPopupElement(station, data));
    popup.update();
    loadStationHotspots(station, marker);
  };

  // If already cached, render immediately
  if (stationStatsCache[station._id]) {
    renderFull(stationStatsCache[station._id]);
    return;
  }

  // Show loading state
  popup.setContent(createPopupElement(station, null));
  popup.update();

  try {
    const res = await fetch(`/api/stations/${station._id}/stats`);
    const data = await res.json();
    stationStatsCache[station._id] = data;

    // Update with loaded data if popup is still open
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
        <div style="color:#ef4444; padding:16px; font-size:12px; text-align:center;">Failed to load data</div>
      `;
      popup.setContent(errDiv);
      popup.update();
    }
  }
}

// ── Nearby Hotspots (per station) ──
const HOTSPOT_PREVIEW_COUNT = 3; // visible before expanding

async function loadStationHotspots(station, marker) {
  const popup = marker.getPopup();
  if (!popup) return;
  const content = popup.getContent();
  const listEl = (content && typeof content.querySelector === 'function')
    ? content.querySelector('.hotspot-list')
    : null;
  if (!listEl) return;

  // Already cached → render immediately
  if (stationHotspotsCache[station._id]) {
    renderHotspotList(listEl, stationHotspotsCache[station._id]);
    return;
  }

  try {
    const res = await fetch(`/api/stations/${station._id}/hotspots?limit=6&radius=3000`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    stationHotspotsCache[station._id] = payload;
    renderHotspotList(listEl, payload);
  } catch (err) {
    console.error('Failed to load hotspots:', err);
    listEl.innerHTML = '<div class="hotspot-empty">⚠️ Couldn\'t load nearby places</div>';
  }
}

function formatDistance(meters) {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Inline onclick handler — fires directly on the button (target phase),
// so it can't be swallowed by popup re-renders or event bubbling issues.
window.__toggleHotspots = function (btn, e) {
  if (e && e.stopPropagation) e.stopPropagation(); // don't let Leaflet treat it as a map click
  const section = btn.closest('.popup-hotspots');
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
    if (p) p.update(); // re-fit popup after expand/collapse
  }
};

function renderHotspotList(listEl, payload) {
  const hotspots = (payload && payload.hotspots) || [];
  const section = listEl.closest('.popup-hotspots');
  const radiusLabel = section && section.querySelector('.hotspot-radius');
  if (radiusLabel) radiusLabel.textContent = payload?.fallback ? 'Closest available' : 'Within 3 km';

  // Drop any previous toggle / note — re-added below the list
  if (section) {
    section.querySelectorAll('.hotspot-toggle, .hotspot-note').forEach(n => n.remove());
  }

  if (!hotspots.length) {
    listEl.innerHTML = '<div class="hotspot-empty">No hotspots found nearby.</div>';
    listEl.classList.remove('expanded');
    return;
  }

  // Render ALL rows upfront; CSS hides those beyond the preview count.
  // Toggling then only flips one class — no re-render, no listener rebinding.
  const rows = hotspots.map((h, i) => `
    <div class="hotspot-item${i === 0 ? ' hotspot-primary' : ''}${i >= HOTSPOT_PREVIEW_COUNT ? ' hotspot-extra' : ''}" title="${(h.description || '').replace(/"/g, '&quot;')}">
      <span class="hotspot-icon">${HOTSPOT_ICONS[h.category] || '📍'}</span>
      <div class="hotspot-info">
        <div class="hotspot-name">${h.name}</div>
        <div class="hotspot-meta">${h.category} · ★ ${h.rating != null ? h.rating.toFixed(1) : '—'} · 🚶 ${h.walk_minutes} min</div>
      </div>
      <span class="hotspot-distance">${formatDistance(h.distance_meters)}</span>
    </div>
  `).join('');
  listEl.innerHTML = rows;
  listEl.classList.remove('expanded'); // start collapsed

  let toggle = '';
  if (hotspots.length > HOTSPOT_PREVIEW_COUNT) {
    toggle = `<button class="hotspot-toggle" type="button" onclick="__toggleHotspots(this, event)">Show ${hotspots.length - HOTSPOT_PREVIEW_COUNT} more places</button>`;
  }

  // Station was outside the hotspot radius → nearest city-wide places shown
  const note = payload.fallback
    ? '<div class="hotspot-note">Closest known places — beyond the preferred walking radius</div>'
    : '';

  // Insert AFTER the scrollable list so the button is never clipped
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
      maxWidth: 380,
      minWidth: 330,
      offset: [0, -12],
      closeButton: true,
      autoPan: true,
      // Reserve more space above the popup so it never disappears beneath the fixed app header.
      autoPanPadding: [44, 44],
      autoPanPaddingTopLeft: [44, 150],
      autoPanPaddingBottomRight: [44, 44]
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
    const res = await fetch('/api/stations');
    allStations = await res.json();

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

    console.log(`🗺️ Map loaded: ${allStations.length} stations`);
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

// ── Start ──
initMap();

// Export for use in dashboard.js
window.allStations = allStations;
window.stationMarkers = stationMarkers;
window.initMap = initMap;
window.formatNumber = formatNumber;
window.LINE_COLORS = LINE_COLORS;
window.switchView = switchView;
