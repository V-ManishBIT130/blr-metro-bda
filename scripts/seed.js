/**
 * Seed Script for Bengaluru Metro Analytics
 * ==========================================
 * 1. Inserts 83 stations into the `stations` collection with a 2dsphere index.
 * 1b. Inserts ~40 curated city hotspots (Cubbon Park, Lalbagh, ...) into the
 *     `hotspots` collection with a 2dsphere index (nearby-places feature).
 * 2. Generates ~1M synthetic trip documents with realistic patterns:
 *    - Bimodal weekday peaks (8-10am, 6-8pm), flat weekends
 *    - Interchange stations (Majestic, RV Road) get higher traffic
 *    - Dense-area stations biased for more frequent trips
 *    - Passenger count scaled by time-of-day
 * 3. Inserts trips in batches of 5,000 for performance.
 *
 * Usage: npm run seed
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'blr_metro';

// ── Station data ──
const stations = require('../data/stations.json');

// ── Curated city hotspots (nearby-places feature) ──
const hotspots = require('../data/hotspots.json');

// ── Configuration ──
const DAYS_OF_DATA = 90;
const BATCH_SIZE = 5000;
const TARGET_TRIPS = 1_000_000; // ~1M trips
const POPUP_RADIUS_M = 3000; // must match the API default in server/routes/stations.js
const EARTH_RADIUS_M = 6371000;

// ── High-traffic station IDs (appear more often as origin/destination) ──
const HIGH_TRAFFIC_STATIONS = new Set([
  'NADAPRABHU_KEMPEGOWDA_STATION_MAJESTIC', 'MAJESTIC_GREEN',
  'RV_ROAD', 'RV_ROAD_YELLOW',
  'WHITEFIELD', 'INDIRANAGAR', 'MG_ROAD', 'ELECTRONIC_CITY',
  'YESHWANTPUR', 'BAIYAPPANAHALLI', 'CUBBON_PARK',
  'CENTRAL_SILK_BOARD', 'BANASHANKARI', 'JAYANAGAR',
  'BTM_LAYOUT', 'BOMMANAHALLI', 'SILK_INSTITUTE',
  'MANTRI_SQUARE_SAMPIGE_ROAD', 'CHICKPETE',
  'TRINITY', 'RAJAJINAGAR', 'NAGASANDRA'
]);

const stationById = new Map(stations.map((station) => [station._id, station]));
const physicalStationKey = (stationId) => {
  const station = stationById.get(stationId);
  return station.location.coordinates.map((coordinate) => coordinate.toFixed(4)).join(',');
};

// ── Helpers ──

/**
 * Seeded pseudo-random number generator (Mulberry32).
 * Ensures reproducible data for demos.
 */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(42);

/**
 * Build a weighted station pool for origin/destination selection.
 * High-traffic stations get 4x weight; interchange stations get 6x.
 */
function buildWeightedPool() {
  const pool = [];
  for (const s of stations) {
    let weight = 1;
    if (s.is_interchange) weight = 6;
    else if (HIGH_TRAFFIC_STATIONS.has(s._id)) weight = 4;
    for (let i = 0; i < weight; i++) pool.push(s._id);
  }
  return pool;
}

/**
 * Hourly trip-rate multiplier simulating bimodal weekday ridership.
 * Returns a value 0..1 indicating relative trip density at the given hour.
 */
function hourlyMultiplier(hour, isWeekend) {
  if (isWeekend) {
    // Flat, lower traffic 9am–9pm
    if (hour >= 9 && hour <= 21) return 0.35;
    if (hour >= 6 && hour < 9) return 0.15;
    if (hour > 21 && hour <= 23) return 0.10;
    return 0.02; // late night
  }
  // Weekday bimodal peaks
  const peaks = {
    5: 0.08, 6: 0.20, 7: 0.55, 8: 0.95, 9: 1.0, 10: 0.65,
    11: 0.35, 12: 0.30, 13: 0.30, 14: 0.30, 15: 0.35, 16: 0.50,
    17: 0.80, 18: 1.0, 19: 0.90, 20: 0.50, 21: 0.25, 22: 0.10, 23: 0.05,
  };
  return peaks[hour] || 0.02;
}

/**
 * Generate passenger count based on time-of-day factor.
 */
function passengerCount(multiplier) {
  const base = 20 + Math.floor(random() * 80); // 20–100 base
  return Math.max(5, Math.floor(base * (0.5 + multiplier * 1.5)));
}

/** Great-circle distance between two lat/lng points, in meters. */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function printHotspotCoverage() {
  console.log('\n🔎 Hotspot coverage report:');
  console.log('─'.repeat(80));

  let withinRadius = 0;
  for (const hotspot of hotspots) {
    const [lng, lat] = hotspot.location.coordinates;
    let nearest = null;
    for (const station of stations) {
      const [stationLng, stationLat] = station.location.coordinates;
      const distance = haversineMeters(lat, lng, stationLat, stationLng);
      if (!nearest || distance < nearest.distance) {
        nearest = { station, distance };
      }
    }

    const covered = nearest.distance <= POPUP_RADIUS_M;
    if (covered) withinRadius++;
    console.log(
      `   ${covered ? '✅' : '⚠️ '} ${hotspot.name.padEnd(46)} → ${nearest.station.name} (${Math.round(nearest.distance)} m)`
    );
  }

  console.log('─'.repeat(80));
  let stationsCovered = 0;
  const uncovered = [];
  for (const station of stations) {
    const [stationLng, stationLat] = station.location.coordinates;
    const nearestDistance = Math.min(
      ...hotspots.map((hotspot) => {
        const [lng, lat] = hotspot.location.coordinates;
        return haversineMeters(stationLat, stationLng, lat, lng);
      })
    );
    if (nearestDistance <= POPUP_RADIUS_M) stationsCovered++;
    else uncovered.push(`${station.name} (${Math.round(nearestDistance / 100) / 10} km to nearest hotspot)`);
  }

  console.log('\n📊 Coverage Summary:');
  console.log(`   Hotspots within ${POPUP_RADIUS_M / 1000} km of a station: ${withinRadius}/${hotspots.length}`);
  console.log(`   Stations with ≥1 hotspot within radius:  ${stationsCovered}/${stations.length}`);
  if (uncovered.length) {
    console.log(`   Stations using the city-wide fallback (${uncovered.length}) — still show ≥1 hotspot:`);
    for (const station of uncovered) console.log(`      • ${station}`);
  }
}

async function buildAnalyticsOverview(tripsCol, db) {
  console.log('   📊 Aggregating core analytics overview...');
  const [coreResult] = await tripsCol.aggregate([
    {
      $facet: {
        topStations: [
          { $group: { _id: '$from_station', total_passengers: { $sum: '$passenger_count' }, total_trips: { $sum: 1 } } },
          { $sort: { total_passengers: -1 } }, { $limit: 10 },
          { $lookup: { from: 'stations', localField: '_id', foreignField: '_id', as: 'station_info' } },
          { $project: { _id: 0, station_id: '$_id', total_passengers: 1, total_trips: 1, station_name: { $arrayElemAt: ['$station_info.name', 0] }, line: { $arrayElemAt: ['$station_info.line', 0] } } }
        ],
        peakHours: [
          { $group: { _id: { $hour: '$timestamp' }, total_passengers: { $sum: '$passenger_count' }, total_trips: { $sum: 1 } } },
          { $sort: { _id: 1 } },
          { $project: { _id: 0, hour: '$_id', passengers: '$total_passengers', trips: '$total_trips' } }
        ],
        lineStats: [
          { $group: { _id: '$line', total_passengers: { $sum: '$passenger_count' }, total_trips: { $sum: 1 } } },
          { $sort: { total_passengers: -1 } },
          { $project: { _id: 0, line: '$_id', passengers: '$total_passengers', trips: '$total_trips' } }
        ],
        topRoutes: [
          { $group: { _id: { from: '$from_station', to: '$to_station' }, total_passengers: { $sum: '$passenger_count' }, total_trips: { $sum: 1 } } },
          { $lookup: { from: 'stations', localField: '_id.from', foreignField: '_id', as: 'from_info' } },
          { $lookup: { from: 'stations', localField: '_id.to', foreignField: '_id', as: 'to_info' } },
          { $match: { $expr: { $ne: [{ $arrayElemAt: ['$from_info.location', 0] }, { $arrayElemAt: ['$to_info.location', 0] }] } } },
          { $group: { _id: { from: { $arrayElemAt: ['$from_info.name', 0] }, to: { $arrayElemAt: ['$to_info.name', 0] } }, total_passengers: { $sum: '$total_passengers' }, total_trips: { $sum: '$total_trips' } } },
          { $project: { _id: 0, from_station: '$_id.from', to_station: '$_id.to', from_name: '$_id.from', to_name: '$_id.to', total_passengers: 1, total_trips: 1 } },
          { $sort: { total_passengers: -1 } }, { $limit: 15 }
        ]
      }
    }
  ]).toArray();

  console.log('   📊 Aggregating weekday vs weekend dynamics...');
  const weekdayWeekendRaw = await tripsCol.aggregate([
    {
      $project: {
        hour: { $hour: '$timestamp' },
        dayOfWeek: { $dayOfWeek: '$timestamp' },
        passenger_count: 1
      }
    },
    {
      $group: {
        _id: {
          hour: '$hour',
          isWeekend: { $in: ['$dayOfWeek', [1, 7]] }
        },
        passengers: { $sum: '$passenger_count' },
        trips: { $sum: 1 }
      }
    },
    { $sort: { '_id.hour': 1 } }
  ]).toArray();

  const weekdayHours = new Array(24).fill(0).map((_, h) => ({ hour: h, passengers: 0, trips: 0 }));
  const weekendHours = new Array(24).fill(0).map((_, h) => ({ hour: h, passengers: 0, trips: 0 }));
  let weekdayTotal = 0;
  let weekendTotal = 0;
  let weekdayTrips = 0;
  let weekendTrips = 0;

  for (const item of weekdayWeekendRaw) {
    const h = item._id.hour;
    if (item._id.isWeekend) {
      weekendHours[h] = { hour: h, passengers: item.passengers, trips: item.trips };
      weekendTotal += item.passengers;
      weekendTrips += item.trips;
    } else {
      weekdayHours[h] = { hour: h, passengers: item.passengers, trips: item.trips };
      weekdayTotal += item.passengers;
      weekdayTrips += item.trips;
    }
  }

  const weekdayWeekend = {
    weekday: weekdayHours,
    weekend: weekendHours,
    weekdayTotal,
    weekendTotal,
    weekdayTrips,
    weekendTrips,
    weekdayAvgDaily: Math.round(weekdayTotal / 64),
    weekendAvgDaily: Math.round(weekendTotal / 26),
    commuteRatio: ((weekdayTotal / 64) / (weekendTotal / 26)).toFixed(2)
  };

  console.log('   📊 Aggregating station-hour heatmap matrix...');
  const topStationIds = coreResult.topStations.slice(0, 10).map(s => s.station_id);
  const heatmapRaw = await tripsCol.aggregate([
    { $match: { from_station: { $in: topStationIds } } },
    {
      $group: {
        _id: {
          station: '$from_station',
          hour: { $hour: '$timestamp' }
        },
        passengers: { $sum: '$passenger_count' }
      }
    },
    { $sort: { '_id.station': 1, '_id.hour': 1 } }
  ]).toArray();

  const stationMap = new Map();
  for (const s of coreResult.topStations.slice(0, 10)) {
    stationMap.set(s.station_id, {
      station_id: s.station_id,
      station_name: s.station_name,
      line: s.line,
      total_passengers: s.total_passengers,
      hourly: new Array(24).fill(0),
      max_hourly: 0
    });
  }

  for (const row of heatmapRaw) {
    const st = stationMap.get(row._id.station);
    if (st) {
      st.hourly[row._id.hour] = row.passengers;
      if (row.passengers > st.max_hourly) st.max_hourly = row.passengers;
    }
  }
  const stationHeatmap = Array.from(stationMap.values());

  console.log('   📊 Aggregating longitudinal trend (90-day daily + monthly)...');
  const dailyRaw = await tripsCol.aggregate([
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
        passengers: { $sum: '$passenger_count' },
        trips: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } }
  ]).toArray();

  const dailyTrend = dailyRaw.map(d => ({
    date: d._id,
    passengers: d.passengers,
    trips: d.trips
  }));

  const monthlyBuckets = {};
  for (const d of dailyTrend) {
    const monthKey = d.date.substring(0, 7);
    if (!monthlyBuckets[monthKey]) monthlyBuckets[monthKey] = { month: monthKey, passengers: 0, trips: 0, days: 0 };
    monthlyBuckets[monthKey].passengers += d.passengers;
    monthlyBuckets[monthKey].trips += d.trips;
    monthlyBuckets[monthKey].days += 1;
  }
  const monthlyTrend = Object.values(monthlyBuckets);
  const peakDay = [...dailyTrend].sort((a, b) => b.passengers - a.passengers)[0];
  const avgDailyPassengers = Math.round(dailyTrend.reduce((acc, d) => acc + d.passengers, 0) / (dailyTrend.length || 1));

  console.log('   📊 Aggregating interchange transit dynamics...');
  const interchangeIds = [
    'NADAPRABHU_KEMPEGOWDA_STATION_MAJESTIC',
    'MAJESTIC_GREEN',
    'RV_ROAD',
    'RV_ROAD_YELLOW'
  ];

  const [interchangeRaw] = await tripsCol.aggregate([
    {
      $match: {
        $or: [
          { from_station: { $in: interchangeIds } },
          { to_station: { $in: interchangeIds } }
        ]
      }
    },
    {
      $facet: {
        majesticOutbound: [
          { $match: { from_station: { $in: ['NADAPRABHU_KEMPEGOWDA_STATION_MAJESTIC', 'MAJESTIC_GREEN'] } } },
          { $group: { _id: '$line', passengers: { $sum: '$passenger_count' }, trips: { $sum: 1 } } }
        ],
        majesticInbound: [
          { $match: { to_station: { $in: ['NADAPRABHU_KEMPEGOWDA_STATION_MAJESTIC', 'MAJESTIC_GREEN'] } } },
          { $group: { _id: '$line', passengers: { $sum: '$passenger_count' }, trips: { $sum: 1 } } }
        ],
        majesticHourly: [
          { $match: { from_station: { $in: ['NADAPRABHU_KEMPEGOWDA_STATION_MAJESTIC', 'MAJESTIC_GREEN'] } } },
          { $group: { _id: { $hour: '$timestamp' }, passengers: { $sum: '$passenger_count' } } },
          { $sort: { _id: 1 } }
        ],
        rvRoadOutbound: [
          { $match: { from_station: { $in: ['RV_ROAD', 'RV_ROAD_YELLOW'] } } },
          { $group: { _id: '$line', passengers: { $sum: '$passenger_count' }, trips: { $sum: 1 } } }
        ],
        rvRoadInbound: [
          { $match: { to_station: { $in: ['RV_ROAD', 'RV_ROAD_YELLOW'] } } },
          { $group: { _id: '$line', passengers: { $sum: '$passenger_count' }, trips: { $sum: 1 } } }
        ],
        rvRoadHourly: [
          { $match: { from_station: { $in: ['RV_ROAD', 'RV_ROAD_YELLOW'] } } },
          { $group: { _id: { $hour: '$timestamp' }, passengers: { $sum: '$passenger_count' } } },
          { $sort: { _id: 1 } }
        ]
      }
    }
  ]).toArray();

  const interchangeLoad = {
    majestic: {
      name: 'Nadaprabhu Kempegowda Station (Majestic)',
      lines: ['Purple', 'Green'],
      outbound: interchangeRaw.majesticOutbound.map(d => ({ line: d._id, passengers: d.passengers, trips: d.trips })),
      inbound: interchangeRaw.majesticInbound.map(d => ({ line: d._id, passengers: d.passengers, trips: d.trips })),
      hourly: interchangeRaw.majesticHourly.map(d => ({ hour: d._id, passengers: d.passengers })),
      totalPassengers: interchangeRaw.majesticOutbound.reduce((sum, d) => sum + d.passengers, 0) +
                       interchangeRaw.majesticInbound.reduce((sum, d) => sum + d.passengers, 0)
    },
    rvRoad: {
      name: 'Rashtreeya Vidyalaya Road (RV Road)',
      lines: ['Green', 'Yellow'],
      outbound: interchangeRaw.rvRoadOutbound.map(d => ({ line: d._id, passengers: d.passengers, trips: d.trips })),
      inbound: interchangeRaw.rvRoadInbound.map(d => ({ line: d._id, passengers: d.passengers, trips: d.trips })),
      hourly: interchangeRaw.rvRoadHourly.map(d => ({ hour: d._id, passengers: d.passengers })),
      totalPassengers: interchangeRaw.rvRoadOutbound.reduce((sum, d) => sum + d.passengers, 0) +
                       interchangeRaw.rvRoadInbound.reduce((sum, d) => sum + d.passengers, 0)
    }
  };

  const overviewPayload = {
    _id: 'dashboard',
    topStations: coreResult.topStations,
    peakHours: coreResult.peakHours,
    lineStats: coreResult.lineStats,
    topRoutes: coreResult.topRoutes,
    weekdayWeekend,
    stationHeatmap,
    monthlyTrend: {
      daily: dailyTrend,
      monthly: monthlyTrend,
      peakDay,
      avgDailyPassengers
    },
    interchangeLoad,
    generated_at: new Date()
  };

  await db.collection('analytics_overview').replaceOne(
    { _id: 'dashboard' },
    overviewPayload,
    { upsert: true }
  );
}

// ── Main Seed Function ──

async function seed() {
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db(dbName);
    console.log(`📦 Connected to MongoDB: ${dbName}`);

    // ── 1. Seed Stations ──
    console.log('\n🚇 Seeding stations...');
    const stationsCol = db.collection('stations');
    await stationsCol.deleteMany({});
    await stationsCol.insertMany(stations);
    await stationsCol.createIndex({ location: '2dsphere' });
    await stationsCol.createIndex({ line: 1 });
    console.log(`   ✅ Inserted ${stations.length} stations with 2dsphere index.`);

    // ── 1b. Seed Hotspots (tourist/city places near stations) ──
    console.log('\n📍 Seeding city hotspots...');
    const hotspotsCol = db.collection('hotspots');
    await hotspotsCol.deleteMany({});
    await hotspotsCol.insertMany(hotspots);
    await hotspotsCol.createIndex({ location: '2dsphere' });
    await hotspotsCol.createIndex({ category: 1 });
    console.log(`   ✅ Inserted ${hotspots.length} hotspots with 2dsphere index.`);
    printHotspotCoverage();

    // ── 2. Generate Synthetic Trips ──
    console.log('\n🎫 Generating synthetic trips...');
    const tripsCol = db.collection('trips');
    await tripsCol.deleteMany({});

    const weightedPool = buildWeightedPool();
    const endDate = new Date('2026-08-30T00:00:00Z');
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - DAYS_OF_DATA);

    let totalInserted = 0;
    let batch = [];

    // Allocate the exact target across hourly slots while preserving the
    // weekday/weekend and peak-hour weighting from hourlyMultiplier().
    const hourlySlots = [];
    let totalWeight = 0;
    for (let day = 0; day < DAYS_OF_DATA; day++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + day);
      const dayOfWeek = currentDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      for (let hour = 5; hour <= 23; hour++) {
        const weight = hourlyMultiplier(hour, isWeekend);
        hourlySlots.push({ currentDate, hour, weight });
        totalWeight += weight;
      }
    }

    let allocatedTrips = 0;
    let cumulativeWeight = 0;

    for (const slot of hourlySlots) {
      cumulativeWeight += slot.weight;
      const targetAllocation = Math.floor((cumulativeWeight * TARGET_TRIPS) / totalWeight);
      const tripsThisHour = targetAllocation - allocatedTrips;
      allocatedTrips = targetAllocation;
      const mult = slot.weight;

      for (let t = 0; t < tripsThisHour; t++) {
          // Pick random from/to (ensure they're different)
          let fromIdx = Math.floor(random() * weightedPool.length);
          let toIdx = Math.floor(random() * weightedPool.length);
          while (physicalStationKey(weightedPool[toIdx]) === physicalStationKey(weightedPool[fromIdx])) {
            toIdx = Math.floor(random() * weightedPool.length);
          }

          const fromStation = weightedPool[fromIdx];
          const toStation = weightedPool[toIdx];

          // Random minute within the hour
          const minute = Math.floor(random() * 60);
          const second = Math.floor(random() * 60);
          const timestamp = new Date(slot.currentDate);
          timestamp.setUTCHours(slot.hour, minute, second, 0);

          // Determine the line of the from_station
          const fromStationData = stationById.get(fromStation);
          const line = fromStationData ? fromStationData.line : 'Purple';

          batch.push({
            from_station: fromStation,
            to_station: toStation,
            timestamp,
            passenger_count: passengerCount(mult),
            line
          });

          if (batch.length >= BATCH_SIZE) {
            await tripsCol.insertMany(batch);
            totalInserted += batch.length;
            process.stdout.write(`\r   📊 Inserted ${totalInserted.toLocaleString()} trips...`);
            batch = [];
          }
      }
    }

    // Insert remaining
    if (batch.length > 0) {
      await tripsCol.insertMany(batch);
      totalInserted += batch.length;
    }

    console.log(`\n   ✅ Inserted ${totalInserted.toLocaleString()} total trips.`);

    // ── 3. Create Indexes ──
    console.log('\n📇 Creating indexes on trips...');
    await tripsCol.createIndex(
      { from_station: 1, to_station: 1, timestamp: 1 },
      { name: 'route_time_idx' }
    );
    await tripsCol.createIndex(
      { from_station: 1, timestamp: 1 },
      { name: 'station_time_idx' }
    );
    await tripsCol.createIndex(
      { to_station: 1, timestamp: 1 },
      { name: 'to_station_time_idx' }
    );
    await tripsCol.createIndex(
      { timestamp: 1 },
      { name: 'timestamp_idx' }
    );
    console.log('   ✅ All indexes created.');

    console.log('\n⚡ Building dashboard analytics cache...');
    await buildAnalyticsOverview(tripsCol, db);
    console.log('   ✅ Dashboard analytics cache refreshed.');

    // ── 4. Summary ──
    const tripCount = await tripsCol.countDocuments();
    const stationCount = await stationsCol.countDocuments();
    const hotspotCount = await hotspotsCol.countDocuments();
    console.log('\n' + '═'.repeat(50));
    console.log('  🎉 SEED COMPLETE');
    console.log('═'.repeat(50));
    console.log(`  Stations: ${stationCount}`);
    console.log(`  Hotspots: ${hotspotCount}`);
    console.log(`  Trips:    ${tripCount.toLocaleString()}`);
    console.log(`  Date range: ${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}`);
    console.log('═'.repeat(50));

  } catch (err) {
    console.error('❌ Seed error:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seed();
