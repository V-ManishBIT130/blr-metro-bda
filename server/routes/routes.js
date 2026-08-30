/**
 * Routes API
 * GET /api/routes?from=STATION_A&to=STATION_B
 * Returns historical trip volume between two stations over the last 90 days.
 */
const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

/**
 * GET /api/routes?from=WHITEFIELD&to=MAJESTIC
 * Returns:
 *  - daily breakdown of trip volume and passengers
 *  - average passengers per day
 *  - total trips and passengers
 */
router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to query params are required' });
    }

    const db = getDB();

    // Daily breakdown
    const dailyPipeline = [
      {
        $match: {
          from_station: from,
          to_station: to
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
          },
          total_passengers: { $sum: '$passenger_count' },
          trip_count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ];

    // Also get the reverse direction
    const reverseDailyPipeline = [
      {
        $match: {
          from_station: to,
          to_station: from
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
          },
          total_passengers: { $sum: '$passenger_count' },
          trip_count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ];

    // Total aggregate
    const totalPipeline = [
      {
        $match: {
          $or: [
            { from_station: from, to_station: to },
            { from_station: to, to_station: from }
          ]
        }
      },
      {
        $group: {
          _id: null,
          total_passengers: { $sum: '$passenger_count' },
          total_trips: { $sum: 1 }
        }
      }
    ];

    const [daily, reverseDaily, totalArr] = await Promise.all([
      db.collection('trips').aggregate(dailyPipeline).toArray(),
      db.collection('trips').aggregate(reverseDailyPipeline).toArray(),
      db.collection('trips').aggregate(totalPipeline).toArray()
    ]);

    const total = totalArr[0] || { total_passengers: 0, total_trips: 0 };
    const daysWithData = Math.max(daily.length, 1);
    const avgPassengersPerDay = Math.round(total.total_passengers / daysWithData);

    res.json({
      from_station: from,
      to_station: to,
      total_passengers: total.total_passengers,
      total_trips: total.total_trips,
      avg_passengers_per_day: avgPassengersPerDay,
      forward_daily: daily.map(d => ({
        date: d._id,
        passengers: d.total_passengers,
        trips: d.trip_count
      })),
      reverse_daily: reverseDaily.map(d => ({
        date: d._id,
        passengers: d.total_passengers,
        trips: d.trip_count
      }))
    });
  } catch (err) {
    console.error('Error fetching route data:', err);
    res.status(500).json({ error: 'Failed to fetch route data' });
  }
});

module.exports = router;
