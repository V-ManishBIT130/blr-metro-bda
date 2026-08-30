/**
 * Seed Script for Bengaluru Metro Analytics
 * ==========================================
 * 1. Inserts 83 stations into the `stations` collection with a 2dsphere index.
 * 2. Generates ~1M synthetic trip documents with realistic patterns:
 *    - Bimodal weekday peaks (8-10am, 6-8pm), flat weekends
 *    - Interchange stations (Majestic, RV Road) get higher traffic
 *    - Dense-area stations biased for more frequent trips
 *    - Passenger count scaled by time-of-day
 * 3. Inserts trips in batches of 5,000 for performance.
 *
 * Usage: node scripts/seed.js
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'blr_metro';

// ── Station data ──
const stations = require('../data/stations.json');

// ── Configuration ──
const DAYS_OF_DATA = 90;
const BATCH_SIZE = 5000;
const TARGET_TRIPS = 1_000_000; // ~1M trips

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

    // ── 2. Generate Synthetic Trips ──
    console.log('\n🎫 Generating synthetic trips...');
    const tripsCol = db.collection('trips');
    await tripsCol.deleteMany({});

    const weightedPool = buildWeightedPool();
    const endDate = new Date('2026-08-30T00:00:00Z');
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - DAYS_OF_DATA);

    // Calculate trips per hour to reach target total
    // 90 days * 18 active hours ≈ 1620 hourly slots
    // ~1M / 1620 ≈ 617 trips per active-hour on average
    // We scale by multiplier so peaks have more, off-peak has fewer

    let totalInserted = 0;
    let batch = [];

    const tripsPerHourBase = 700; // base trips per hour at peak

    for (let day = 0; day < DAYS_OF_DATA; day++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + day);
      const dayOfWeek = currentDate.getDay(); // 0=Sun, 6=Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      for (let hour = 5; hour <= 23; hour++) {
        const mult = hourlyMultiplier(hour, isWeekend);
        const tripsThisHour = Math.floor(tripsPerHourBase * mult);

        for (let t = 0; t < tripsThisHour; t++) {
          // Pick random from/to (ensure they're different)
          let fromIdx = Math.floor(random() * weightedPool.length);
          let toIdx = Math.floor(random() * weightedPool.length);
          while (weightedPool[toIdx] === weightedPool[fromIdx]) {
            toIdx = Math.floor(random() * weightedPool.length);
          }

          const fromStation = weightedPool[fromIdx];
          const toStation = weightedPool[toIdx];

          // Random minute within the hour
          const minute = Math.floor(random() * 60);
          const second = Math.floor(random() * 60);
          const timestamp = new Date(currentDate);
          timestamp.setUTCHours(hour, minute, second, 0);

          // Determine the line of the from_station
          const fromStationData = stations.find(s => s._id === fromStation);
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

    // ── 4. Summary ──
    const tripCount = await tripsCol.countDocuments();
    const stationCount = await stationsCol.countDocuments();
    console.log('\n' + '═'.repeat(50));
    console.log('  🎉 SEED COMPLETE');
    console.log('═'.repeat(50));
    console.log(`  Stations: ${stationCount}`);
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
