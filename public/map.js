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

// ── Format Number ──
function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return (n || 0).toLocaleString();
}

// ── Create Station Popup Element ──
function createPopupElement(station, data = null) {
  const container = document.createElement('div');
  const lineClass = station.line.toLowerCase();

  if (!data) {
    container.innerHTML = `
      <div class="popup-header">
        <div class="popup-station-name">${station.name}</div>
        <span class="popup-line-badge ${lineClass}">
          ● ${station.line} Line${station.is_interchange ? ' · ⇄ Interchange' : ''}
        </span>
      </div>
      <div class="popup-loading">
        <div class="spinner"></div>
        <div>Loading ridership data...</div>
      </div>
    `;
    return container;
  }

  container.innerHTML = `
    <div class="popup-header">
      <div class="popup-station-name">${station.name}</div>
      <span class="popup-line-badge ${lineClass}">
        ● ${station.line} Line${station.is_interchange ? ' · ⇄ Interchange' : ''}
      </span>
    </div>
    <div>
      <div class="popup-stats">
        <div class="popup-stat">
          <div class="popup-stat-value">${formatNumber(data.total_passengers)}</div>
          <div class="popup-stat-label">Total Passengers</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-value">${formatNumber(data.total_trips)}</div>
          <div class="popup-stat-label">Total Trips</div>
        </div>
      </div>
      <div class="popup-chart-container">
        <div class="popup-chart-title">Hourly Ridership Pattern</div>
        <div class="popup-chart-wrapper">
          <canvas class="popup-chart"></canvas>
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
            backgroundColor: color + '90',
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
              titleFont: { size: 10 },
              bodyFont: { size: 10 },
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
                font: { size: 8 },
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

  // If already cached, render immediately
  if (stationStatsCache[station._id]) {
    popup.setContent(createPopupElement(station, stationStatsCache[station._id]));
    popup.update();
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
      popup.setContent(createPopupElement(station, data));
      popup.update();
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
      maxWidth: 340,
      minWidth: 290,
      offset: [0, -8],
      closeButton: true,
      autoPan: true,
      autoPanPadding: [30, 30]
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
