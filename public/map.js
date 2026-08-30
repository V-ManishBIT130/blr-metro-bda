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

// Dark tile layer (CartoDB Dark Matter)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd',
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

// ── Popup Chart Cache ──
const popupCharts = {};

// ── Create Station Popup Content ──
function createPopupContent(station) {
  const lineClass = station.line.toLowerCase();
  return `
    <div class="popup-header">
      <div class="popup-station-name">${station.name}</div>
      <span class="popup-line-badge ${lineClass}">
        ● ${station.line} Line${station.is_interchange ? ' · ⇄ Interchange' : ''}
      </span>
    </div>
    <div class="popup-loading" id="popup-loading-${station._id}">
      <div class="spinner"></div>
      <div>Loading ridership data...</div>
    </div>
    <div id="popup-data-${station._id}" style="display:none;">
      <div class="popup-stats">
        <div class="popup-stat">
          <div class="popup-stat-value" id="popup-passengers-${station._id}">—</div>
          <div class="popup-stat-label">Total Passengers</div>
        </div>
        <div class="popup-stat">
          <div class="popup-stat-value" id="popup-trips-${station._id}">—</div>
          <div class="popup-stat-label">Total Trips</div>
        </div>
      </div>
      <div class="popup-chart-container">
        <div class="popup-chart-title">Hourly Ridership Pattern</div>
        <canvas class="popup-chart" id="popup-chart-${station._id}"></canvas>
      </div>
    </div>
  `;
}

// ── Format Number ──
function formatNumber(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

// ── Load Station Stats on Popup Open ──
async function loadStationStats(stationId) {
  try {
    const res = await fetch(`/api/stations/${stationId}/stats`);
    const data = await res.json();

    // Hide loading, show data
    const loadEl = document.getElementById(`popup-loading-${stationId}`);
    const dataEl = document.getElementById(`popup-data-${stationId}`);
    if (loadEl) loadEl.style.display = 'none';
    if (dataEl) dataEl.style.display = 'block';

    // Fill stats
    const passEl = document.getElementById(`popup-passengers-${stationId}`);
    const tripsEl = document.getElementById(`popup-trips-${stationId}`);
    if (passEl) passEl.textContent = formatNumber(data.total_passengers);
    if (tripsEl) tripsEl.textContent = formatNumber(data.total_trips);

    // Render hourly chart
    const canvas = document.getElementById(`popup-chart-${stationId}`);
    if (!canvas) return;

    // Destroy existing chart for this station if it exists
    if (popupCharts[stationId]) {
      popupCharts[stationId].destroy();
    }

    // Prepare 24-hour data
    const hourlyData = new Array(24).fill(0);
    for (const h of data.hourly_breakdown) {
      hourlyData[h.hour] = h.passengers;
    }

    const station = allStations.find(s => s._id === stationId);
    const color = LINE_COLORS[station?.line] || '#6366f1';

    popupCharts[stationId] = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: Array.from({ length: 24 }, (_, i) => `${i}:00`),
        datasets: [{
          data: hourlyData,
          backgroundColor: color + '60',
          borderColor: color,
          borderWidth: 1,
          borderRadius: 2,
          barPercentage: 0.8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(10, 14, 26, 0.9)',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(148, 163, 184, 0.12)',
            borderWidth: 1,
            cornerRadius: 8,
            padding: 10,
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

  } catch (err) {
    console.error('Failed to load station stats:', err);
    const loadEl = document.getElementById(`popup-loading-${stationId}`);
    if (loadEl) loadEl.innerHTML = '<div style="color: #ef4444;">Failed to load data</div>';
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

    // Bind popup
    const popup = L.popup({
      className: 'station-popup',
      maxWidth: 380,
      minWidth: 300,
      closeButton: true,
      autoPan: true,
      autoPanPadding: [40, 40]
    }).setContent(createPopupContent(station));

    marker.bindPopup(popup);

    // Load stats when popup opens
    marker.on('popupopen', () => {
      loadStationStats(station._id);
    });

    // Clean up chart when popup closes
    marker.on('popupclose', () => {
      if (popupCharts[station._id]) {
        popupCharts[station._id].destroy();
        delete popupCharts[station._id];
      }
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
