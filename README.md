# 🚇 Namma Metro Analytics — MongoDB Big Data Project

> Interactive big data analytics dashboard for **Bengaluru Namma Metro** ridership data, powered by **MongoDB** aggregation pipelines, geospatial indexing, and precomputed analytics caching across **1 million+ trip documents**.

## 📋 Overview

This project demonstrates MongoDB's capabilities for storing, querying, and aggregating large-scale transit datasets. It features a futuristic, command-center–style dark UI with real-time telemetry aesthetics, glassmorphism cards, and interactive data visualizations.

### Core Dataset
- **83 real Namma Metro stations** across 3 operational lines (Purple, Green, Yellow)
- **~1 million synthetic trip records** with realistic bimodal commute patterns (morning 8–10 AM, evening 5–8 PM)
- **40 curated hotspots** — parks, museums, malls, tech parks near stations
- **80+ Bangalore localities** — neighborhoods, IT hubs, landmarks with GPS coordinates

### Application Views

| View | Description |
|------|-------------|
| **🗺️ Map** | Interactive Leaflet.js map with color-coded station markers, metro line polylines, and HUD-style station popups with ridership telemetry |
| **🔀 Routes** | Journey planner with stop-by-stop timeline, line interchange detection, estimated fare/duration, and daily trip volume charts |
| **📊 Analytics** | 8-panel analytics dashboard with top stations, peak hours, per-line ridership, busiest routes, weekday/weekend split, interchange dynamics, station demand heatmap, and 90-day longitudinal trend |
| **📍 Nearby** | Smart Metro Locator with area-name search, autocomplete, popular locality chips, GPS detection, radius filtering, and station distance cards |

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Database | MongoDB 7.0 (local or Atlas) |
| Backend | Node.js + Express 5 |
| Frontend | HTML / CSS / JavaScript (no framework) |
| Map | Leaflet.js + OpenStreetMap tiles |
| Charts | Chart.js 4.x |
| Styling | Vanilla CSS — dark theme with glassmorphism, glowing accents, micro-animations |

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- MongoDB running locally on `mongodb://localhost:27017` (or MongoDB Atlas)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Seed stations, hotspots, indexes, and ~1M trip documents (takes ~60-120 seconds)
npm run seed

# 3. Start the server
npm start
```

Open **http://localhost:3000** in your browser.

### Environment Variables (`.env`)

```env
MONGODB_URI=mongodb://localhost:27017
DB_NAME=blr_metro
PORT=3000
```

## 📁 Project Structure

```
blr-metro-bda/
├── data/
│   ├── stations.json              # 83 stations with name, line, sequence, lat-lng (GeoJSON)
│   ├── hotspots.json              # 40 curated Bengaluru landmarks & POIs for station popups
│   └── areas.json                 # 80+ Bangalore localities with GPS coords for Smart Locator
├── scripts/
│   ├── seed.js                    # Seeds stations, hotspots, indexes, synthetic trips, and analytics cache
│   └── refresh_analytics.js       # Regenerates precomputed analytics cache without re-seeding trips
├── server/
│   ├── index.js                   # Express app entry point
│   ├── db.js                      # MongoDB connection singleton
│   ├── journey.js                 # Graph-based journey computation (BFS pathfinding across metro lines)
│   └── routes/
│       ├── stations.js            # Station CRUD, stats, nearby ($geoNear), area search
│       ├── routes.js              # Route search (from→to) and journey planner
│       └── analytics.js           # Dashboard aggregations + 4 advanced analytics endpoints
├── public/
│   ├── index.html                 # Main HTML — all 4 views (Map, Routes, Analytics, Nearby)
│   ├── style.css                  # Dark futuristic theme — glassmorphism, HUD elements, animations
│   ├── map.js                     # Leaflet map, station markers, popup rendering, view navigation
│   └── dashboard.js               # Chart renderers, analytics panels, route search, Smart Locator
├── .env                           # MongoDB connection config
└── package.json
```

## 📊 MongoDB Features Demonstrated

| Feature | Usage |
|---------|-------|
| **2dsphere Index** | Geospatial "nearest station" queries via `$geoNear` aggregation pipeline |
| **Compound Index** | `{from_station, to_station, timestamp}` for fast route volume lookups |
| **Multi-Stage $facet** | Single aggregation pipeline producing topStations, peakHours, lineStats, and topRoutes simultaneously |
| **$group by $hour** | System-wide peak hours analysis extracted from timestamps |
| **$dayOfWeek** | Weekday vs Weekend commute pattern segregation |
| **$dateToString** | Daily and monthly rollup aggregations for longitudinal trend analysis |
| **$lookup** | Cross-collection joins between `trips` and `stations` for enriched analytics |
| **$match + $in** | Interchange-specific filtering for Majestic & RV Road hub analysis |
| **Precomputed Cache** | `analytics_overview` collection stores precomputed results for < 5ms API response times |
| **Volume** | ~1M+ trip documents with indexed queries |

## 📈 Analytics Modules

### Original Modules
1. **Top 10 Busiest Stations** — Bar chart from `$group` + `$sort` + `$limit` + `$lookup`
2. **System-Wide Peak Hours** — Line chart from `$group` by `$hour`
3. **Per-Line Ridership** — Doughnut chart from `$group` by line field
4. **Top 15 Busiest Routes** — Table from `$group` by `{from, to}` OD pairs
5. **Network Pulse** — Derived demand signals: strongest hour, commute concentration (07–10 & 17–20), origin concentration (top 10), leading corridor

### Advanced Analytics (New)
6. **Weekday vs Weekend Commute Split** — Dual-line overlay chart comparing weekday office rush vs weekend leisure flow. Uses `$dayOfWeek` to segregate data. Includes commute surge multiplier (weekday/weekend ratio).
7. **Multi-Line Interchange Dynamics** — Transfer volume analysis at Majestic (Purple ↔ Green) and RV Road (Green ↔ Yellow) hubs. Shows outbound/inbound split and corridor distribution per line.
8. **24-Hour Station Demand Heatmap Matrix** — Color-coded density table for top 10 stations × 24 hours. 4-tier intensity scale: dim → indigo → purple → hot pink (peak surge).
9. **90-Day Longitudinal Trajectory & Velocity** — Day-by-day ridership line chart across the full dataset. Peak day callout and 90-day daily average indicator.

## 🎯 Station Popup — Ridership Telemetry HUD

When clicking any station on the map, a redesigned popup appears with:

- **Live Telemetry badge** with animated pulse ring
- **Station rank badge** — `👑 Rank #N Network Busiest` for top 10 stations
- **Dual tabs**: ⚡ Ridership Telemetry | 📍 Nearby Hotspots
- **3 KPI metric cards** — Total Volume, Daily Average, Total Journeys
- **Peak Surge banner** — Shows peak hour window, average pax/hr, and wave type (Morning/Evening)
- **24-Hour Diurnal Demand Curve** — Gradient bar chart
- **Action buttons** — `Set Origin` and `Set Destination` for route planning

## 📍 Smart Metro Locator

The Nearby section replaces raw coordinate inputs with a user-friendly area search:

- **Area search input** with live autocomplete from 80+ curated Bangalore localities
- **Popular locality chips** — Indiranagar, Koramangala, Whitefield, HSR Layout, MG Road, etc.
- **GPS radar detection** — Uses browser geolocation API
- **Radius filter pills** — All, < 3 km, < 5 km, < 10 km
- **Station cards** with line badges, distance (km), walk/drive time estimates, and action buttons

## 💡 Network Pulse Methodology

The dashboard converts aggregation output into four planning-oriented signals:
- **Strongest Hour** — The hour with highest system-wide passenger volume
- **Commute-Shaped Demand** — Share of demand in morning (07–10) and evening (17–20) windows
- **Origin Concentration** — Percentage of demand originating at the top 10 stations
- **Leading Corridor** — The metro line carrying the highest passenger share

These are derived from the same 90-day synthetic dataset — no live ridership claim is implied.

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stations` | GET | List all 83 stations |
| `/api/stations/:id/stats` | GET | Hourly/daily ridership breakdown for a station |
| `/api/stations/nearby?lat=&lng=&limit=` | GET | Find nearest stations using `$geoNear` (2dsphere) |
| `/api/stations/:id/hotspots` | GET | Curated hotspots near a station |
| `/api/stations/areas?q=` | GET | Search Bangalore localities by name/category |
| `/api/routes?from=&to=` | GET | Trip volume between two stations with daily breakdown |
| `/api/routes/journey?from=&to=` | GET | Journey details: stops, line changes, direction, distance, fare, duration |
| `/api/analytics/overview` | GET | Combined analytics overview (cached, < 5ms) |
| `/api/analytics/top-stations` | GET | Top 10 busiest stations |
| `/api/analytics/top-routes` | GET | Top 15 busiest OD pairs |
| `/api/analytics/peak-hours` | GET | System-wide hourly distribution |
| `/api/analytics/line-stats` | GET | Per-line passenger totals |
| `/api/analytics/weekday-weekend` | GET | Weekday vs weekend hourly split with commute ratio |
| `/api/analytics/station-heatmap` | GET | 24-hour density matrix for top 10 stations |
| `/api/analytics/monthly-trend` | GET | 90-day daily trajectory, peak day, monthly rollups |
| `/api/analytics/interchange-load` | GET | Transfer volumes at Majestic & RV Road interchange hubs |

## ⚡ Performance

| Metric | Value |
|--------|-------|
| Trip documents | ~1,000,000 |
| Analytics cache response | < 5ms |
| Geospatial nearby query | ~25ms |
| Full $facet aggregation (uncached) | ~5s |
| Precomputed cache generation | ~15s |

The `analytics_overview` collection stores precomputed results from expensive aggregation pipelines. The seed script (`npm run seed`) and the standalone `scripts/refresh_analytics.js` both regenerate this cache.

## ⚠️ Data Disclaimer

All ridership data is **synthetic/generated** for demonstration purposes. Station names and locations are based on real Namma Metro stations, but trip volumes and passenger counts are entirely fictional. The purpose is to demonstrate MongoDB's capabilities for storing, querying, and aggregating large datasets (~1M+ documents).

## 📝 License

ISC
