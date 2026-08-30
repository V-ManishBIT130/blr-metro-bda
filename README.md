# 🚇 Namma Metro Analytics — MongoDB Big Data Project

> Interactive web dashboard for exploring **synthetic** Bengaluru Metro (Namma Metro) ridership data, powered by **MongoDB** aggregation pipelines.

## 📋 Overview

This project demonstrates MongoDB's capabilities for storing, querying, and aggregating large datasets (~1M+ trip documents). It features:

- **83 real Namma Metro stations** across 3 operational lines (Purple, Green, Yellow)
- **~1 million synthetic trip records** with realistic bimodal ridership patterns
- **Interactive Leaflet.js map** with station markers, line polylines, and on-click stats
- **Route search** showing historical trip volume between any two stations
- **Analytics dashboard** with top stations, peak hours, and busiest routes
- **Geospatial search** using MongoDB's `$geoNear` and 2dsphere index

## 🛠️ Tech Stack

| Layer     | Technology              |
|-----------|------------------------|
| Database  | MongoDB (local or Atlas) |
| Backend   | Node.js + Express       |
| Frontend  | HTML/CSS/JS (no framework) |
| Map       | Leaflet.js + CartoDB Dark tiles |
| Charts    | Chart.js                |
| Styling   | Vanilla CSS (dark glassmorphism) |

## 🚀 Quick Start

### Prerequisites
- Node.js v18+ 
- MongoDB running locally on `mongodb://localhost:27017` (or Atlas)

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Seed the database (~1M trip documents, takes ~60-120 seconds)
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
│   └── stations.json          # 83 stations with name/line/sequence/lat-lng
├── scripts/
│   └── seed.js                # Generates + inserts synthetic trips
├── server/
│   ├── index.js               # Express app entry point
│   ├── db.js                  # MongoDB connection singleton
│   └── routes/
│       ├── stations.js        # Station CRUD + stats
│       ├── routes.js          # Route search (from→to)
│       └── analytics.js       # Dashboard aggregations
├── public/
│   ├── index.html             # Main HTML (SPA-style)
│   ├── style.css              # Dark glassmorphism theme
│   ├── map.js                 # Leaflet map + markers
│   └── dashboard.js           # Charts + analytics
├── .env                       # MongoDB connection config
└── package.json
```

## 📊 MongoDB Features Demonstrated

| Feature | Usage |
|---------|-------|
| **2dsphere Index** | Geospatial "nearest station" queries via `$geoNear` |
| **Compound Index** | `{from_station, to_station, timestamp}` for fast route lookups |
| **Aggregation Pipeline** | `$match`, `$group`, `$sort`, `$limit`, `$lookup`, `$project` |
| **$group by $hour** | Peak hours analysis from timestamps |
| **$dateToString** | Daily breakdown aggregations |
| **Volume** | ~1M+ trip documents |

## 🔌 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stations` | GET | List all 83 stations |
| `/api/stations/:id/stats` | GET | Hourly/daily ridership for a station |
| `/api/stations/nearby?lat=&lng=` | GET | Find nearest stations (geospatial) |
| `/api/routes?from=&to=` | GET | Trip volume between two stations |
| `/api/analytics/top-stations` | GET | Top 10 busiest stations |
| `/api/analytics/top-routes` | GET | Top 15 busiest OD pairs |
| `/api/analytics/peak-hours` | GET | System-wide hourly distribution |
| `/api/analytics/line-stats` | GET | Per-line passenger totals |

## ⚠️ Data Disclaimer

All ridership data is **synthetic/generated** for demonstration purposes. Station names and locations are based on real Namma Metro stations, but trip volumes and passenger counts are entirely fictional. This project is a MongoDB Big Data Analytics course assignment.

## 📝 License

ISC
