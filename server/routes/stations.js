/**
 * Stations API Routes
 * GET /api/stations          — List all stations for map markers
 * GET /api/stations/:id/stats — Hourly/daily ridership for one station
 * GET /api/stations/nearby    — Nearest stations to a lat/lng point
 */
const express = require('express');
const router = express.Router();
const { getDB } = require('../db');

/**
 * GET /api/stations
 * Returns all stations sorted by line and sequence.
 */
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const stations = await db.collection('stations')
      .find({})
      .sort({ line: 1, sequence: 1 })
      .toArray();
    res.json(stations);
  } catch (err) {
    console.error('Error fetching stations:', err);
    res.status(500).json({ error: 'Failed to fetch stations' });
  }
});

/**
 * GET /api/stations/nearby?lat=12.97&lng=77.59&limit=5
 * Uses $geoNear to find nearest stations to a given point.
 */
router.get('/nearby', async (req, res) => {
  try {
    const { lat, lng, limit = 5 } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng query params are required' });
    }

    const db = getDB();
    const results = await db.collection('stations').aggregate([
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          distanceField: 'distance_meters',
          spherical: true,
          maxDistance: 50000 // 50km max
        }
      },
      { $limit: parseInt(limit) }
    ]).toArray();

    res.json(results);
  } catch (err) {
    console.error('Error finding nearby stations:', err);
    res.status(500).json({ error: 'Failed to find nearby stations' });
  }
});

/**
 * GET /api/stations/:id/stats
 * Returns ridership stats for a specific station:
 *  - total_passengers (as origin)
 *  - hourly_breakdown (passengers by hour of day)
 *  - daily_breakdown (passengers by day over last 90 days)
 */
router.get('/:id/stats', async (req, res) => {
  try {
    const stationId = req.params.id;
    const db = getDB();

    // Get hourly breakdown (aggregated across all days)
    const hourlyPipeline = [
      {
        $match: {
          $or: [
            { from_station: stationId },
            { to_station: stationId }
          ]
        }
      },
      {
        $group: {
          _id: { $hour: '$timestamp' },
          total_passengers: { $sum: '$passenger_count' },
          trip_count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ];

    // Get daily breakdown (last 90 days)
    const dailyPipeline = [
      {
        $match: {
          $or: [
            { from_station: stationId },
            { to_station: stationId }
          ]
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

    // Get total passengers
    const totalPipeline = [
      {
        $match: {
          $or: [
            { from_station: stationId },
            { to_station: stationId }
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

    const [hourly, daily, totalArr] = await Promise.all([
      db.collection('trips').aggregate(hourlyPipeline).toArray(),
      db.collection('trips').aggregate(dailyPipeline).toArray(),
      db.collection('trips').aggregate(totalPipeline).toArray()
    ]);

    const total = totalArr[0] || { total_passengers: 0, total_trips: 0 };

    res.json({
      station_id: stationId,
      total_passengers: total.total_passengers,
      total_trips: total.total_trips,
      hourly_breakdown: hourly.map(h => ({
        hour: h._id,
        passengers: h.total_passengers,
        trips: h.trip_count
      })),
      daily_breakdown: daily.map(d => ({
        date: d._id,
        passengers: d.total_passengers,
        trips: d.trip_count
      }))
    });
  } catch (err) {
    console.error('Error fetching station stats:', err);
    res.status(500).json({ error: 'Failed to fetch station stats' });
  }
});

module.exports = router;
