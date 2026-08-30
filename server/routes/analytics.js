/**
 * Analytics API Routes
 * GET /api/analytics/top-stations  — Top 10 busiest stations
 * GET /api/analytics/top-routes    — Top 15 busiest OD pairs
 * GET /api/analytics/peak-hours    — System-wide hourly distribution
 * GET /api/analytics/line-stats    — Per-line totals
 */
const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

/**
 * GET /api/analytics/top-stations
 * Returns the 10 busiest stations by total passenger count (as origin).
 */
router.get('/top-stations', async (req, res) => {
  try {
    const db = getDB();
    const pipeline = [
      {
        $group: {
          _id: '$from_station',
          total_passengers: { $sum: '$passenger_count' },
          total_trips: { $sum: 1 }
        }
      },
      { $sort: { total_passengers: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'stations',
          localField: '_id',
          foreignField: '_id',
          as: 'station_info'
        }
      },
      {
        $project: {
          station_id: '$_id',
          total_passengers: 1,
          total_trips: 1,
          station_name: { $arrayElemAt: ['$station_info.name', 0] },
          line: { $arrayElemAt: ['$station_info.line', 0] }
        }
      }
    ];

    const results = await db.collection('trips').aggregate(pipeline).toArray();
    res.json(results);
  } catch (err) {
    console.error('Error fetching top stations:', err);
    res.status(500).json({ error: 'Failed to fetch top stations' });
  }
});

/**
 * GET /api/analytics/top-routes
 * Returns the 15 busiest origin→destination pairs.
 */
router.get('/top-routes', async (req, res) => {
  try {
    const db = getDB();
    const pipeline = [
      {
        $group: {
          _id: {
            from: '$from_station',
            to: '$to_station'
          },
          total_passengers: { $sum: '$passenger_count' },
          total_trips: { $sum: 1 }
        }
      },
      { $sort: { total_passengers: -1 } },
      { $limit: 15 },
      {
        $lookup: {
          from: 'stations',
          localField: '_id.from',
          foreignField: '_id',
          as: 'from_info'
        }
      },
      {
        $lookup: {
          from: 'stations',
          localField: '_id.to',
          foreignField: '_id',
          as: 'to_info'
        }
      },
      {
        $project: {
          from_station: '$_id.from',
          to_station: '$_id.to',
          from_name: { $arrayElemAt: ['$from_info.name', 0] },
          to_name: { $arrayElemAt: ['$to_info.name', 0] },
          total_passengers: 1,
          total_trips: 1
        }
      }
    ];

    const results = await db.collection('trips').aggregate(pipeline).toArray();
    res.json(results);
  } catch (err) {
    console.error('Error fetching top routes:', err);
    res.status(500).json({ error: 'Failed to fetch top routes' });
  }
});

/**
 * GET /api/analytics/peak-hours
 * Returns system-wide passenger distribution by hour of day.
 */
router.get('/peak-hours', async (req, res) => {
  try {
    const db = getDB();
    const pipeline = [
      {
        $group: {
          _id: { $hour: '$timestamp' },
          total_passengers: { $sum: '$passenger_count' },
          total_trips: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ];

    const results = await db.collection('trips').aggregate(pipeline).toArray();
    res.json(results.map(r => ({
      hour: r._id,
      passengers: r.total_passengers,
      trips: r.total_trips
    })));
  } catch (err) {
    console.error('Error fetching peak hours:', err);
    res.status(500).json({ error: 'Failed to fetch peak hours' });
  }
});

/**
 * GET /api/analytics/line-stats
 * Returns per-line totals.
 */
router.get('/line-stats', async (req, res) => {
  try {
    const db = getDB();
    const pipeline = [
      {
        $group: {
          _id: '$line',
          total_passengers: { $sum: '$passenger_count' },
          total_trips: { $sum: 1 }
        }
      },
      { $sort: { total_passengers: -1 } }
    ];

    const results = await db.collection('trips').aggregate(pipeline).toArray();
    res.json(results.map(r => ({
      line: r._id,
      passengers: r.total_passengers,
      trips: r.total_trips
    })));
  } catch (err) {
    console.error('Error fetching line stats:', err);
    res.status(500).json({ error: 'Failed to fetch line stats' });
  }
});

module.exports = router;
