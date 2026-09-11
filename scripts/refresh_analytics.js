/**
 * Standalone analytics cache refresh script
 */
const { MongoClient } = require('mongodb');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.DB_NAME || 'blr_metro';

async function refreshAnalytics() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const tripsCol = db.collection('trips');
    console.log('⚡ Connected to MongoDB. Refreshing analytics overview cache...');

    console.log('1/5. Core analytics (top stations, peak hours, lines, routes)...');
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

    console.log('2/5. Weekday vs weekend dynamics...');
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

    console.log('3/5. Station-hour heatmap matrix...');
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

    console.log('4/5. Longitudinal trend (90-day daily + monthly)...');
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

    console.log('5/5. Interchange transit dynamics...');
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

    console.log('✨ SUCCESS: Dashboard analytics cache fully refreshed with all 4 new analytics modules!');
  } catch (err) {
    console.error('❌ Error refreshing analytics:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
}

refreshAnalytics();
