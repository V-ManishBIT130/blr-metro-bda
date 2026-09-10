/**
 * Hotspot Seeder & Coverage Validator
 * ====================================
 * 1. Inserts curated Bengaluru hotspots (Cubbon Park, Lalbagh, ISKCON, ...)
 *    into the `hotspots` collection with a 2dsphere geo index, so station
 *    popups can run fast $geoNear queries.
 * 2. Validates coverage: prints the nearest metro station for every hotspot
 *    and reports how many stations have ≥ 1 hotspot within the default
 *    3 km popup radius (the rest rely on the API's city-wide fallback).
 *
 * Usage: node scripts/seed-hotspots.js   (or: npm run seed:hotspots)
 */

const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const hotspots = require('../data/hotspots.json');
const stations = require('../data/stations.json');

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'blr_metro';

const POPUP_RADIUS_M = 3000; // must match the API default in server/routes/stations.js
const EARTH_RADIUS_M = 6371000;

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

async function seed() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    console.log(`📦 Connected to MongoDB: ${dbName}`);

    // ── 1. Seed Hotspots ──
    console.log('\n📍 Seeding city hotspots...');
    const col = db.collection('hotspots');
    await col.deleteMany({});
    await col.insertMany(hotspots);
    await col.createIndex({ location: '2dsphere' });
    await col.createIndex({ category: 1 });
    console.log(`   ✅ Inserted ${hotspots.length} hotspots with 2dsphere index.`);

    // ── 2. Coverage Report ──
    console.log('\n🔎 Nearest station per hotspot:');
    console.log('─'.repeat(80));
    let withinRadius = 0;
    for (const h of hotspots) {
      const [lng, lat] = h.location.coordinates;
      let best = null;
      for (const s of stations) {
        const [slng, slat] = s.location.coordinates;
        const d = haversineMeters(lat, lng, slat, slng);
        if (!best || d < best.distance) best = { station: s, distance: d };
      }
      const ok = best.distance <= POPUP_RADIUS_M;
      if (ok) withinRadius++;
      console.log(
        `   ${ok ? '✅' : '⚠️ '} ${h.name.padEnd(46)} → ${best.station.name} (${Math.round(best.distance)} m)`
      );
    }
    console.log('─'.repeat(80));

    // Station coverage (reverse check)
    let stationsCovered = 0;
    const uncovered = [];
    for (const s of stations) {
      const [slng, slat] = s.location.coordinates;
      const nearest = Math.min(
        ...hotspots.map((h) => {
          const [lng, lat] = h.location.coordinates;
          return haversineMeters(slat, slng, lat, lng);
        })
      );
      if (nearest <= POPUP_RADIUS_M) stationsCovered++;
      else uncovered.push(`${s.name} (${Math.round(nearest / 100) / 10} km to nearest hotspot)`);
    }

    console.log('\n📊 Coverage Summary:');
    console.log(`   Hotspots within ${POPUP_RADIUS_M / 1000} km of a station: ${withinRadius}/${hotspots.length}`);
    console.log(`   Stations with ≥1 hotspot within radius:  ${stationsCovered}/${stations.length}`);
    if (uncovered.length) {
      console.log(`   Stations using the city-wide fallback (${uncovered.length}) — still show ≥1 hotspot:`);
      for (const u of uncovered) console.log(`      • ${u}`);
    }
    console.log('\n🎉 Hotspot seed complete.');
  } catch (err) {
    console.error('❌ Hotspot seed error:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

seed();