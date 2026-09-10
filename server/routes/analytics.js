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

const OVERVIEW_CACHE_MS = 30_000;
let overviewCache = null;

function buildOverviewPipeline() {
  return [
    {
      $facet: {
        topStations: [
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
        ],
        peakHours: [
          {
            $group: {
              _id: { $hour: '$timestamp' },
              total_passengers: { $sum: '$passenger_count' },
              total_trips: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ],
        lineStats: [
          {
            $group: {
              _id: '$line',
              total_passengers: { $sum: '$passenger_count' },
              total_trips: { $sum: 1 }
            }
          },
          { $sort: { total_passengers: -1 } }
        ],
        topRoutes: [
          {
            $group: {
              _id: { from: '$from_station', to: '$to_station' },
              total_passengers: { $sum: '$passenger_count' },
              total_trips: { $sum: 1 }
            }
          },
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
            $match: {
              $expr: {
                $ne: [
                  { $arrayElemAt: ['$from_info.location', 0] },
                  { $arrayElemAt: ['$to_info.location', 0] }
                ]
              }
            }
          },
          {
            $group: {
              _id: {
                from: { $arrayElemAt: ['$from_info.name', 0] },
                to: { $arrayElemAt: ['$to_info.name', 0] }
              },
              total_passengers: { $sum: '$total_passengers' },
              total_trips: { $sum: '$total_trips' }
            }
          },
          {
            $project: {
              _id: 0,
              from_station: '$_id.from',
              to_station: '$_id.to',
              from_name: '$_id.from',
              to_name: '$_id.to',
              total_passengers: 1,
              total_trips: 1
            }
          },
          { $sort: { total_passengers: -1 } },
          { $limit: 15 }
        ]
      }
    }
  ];
}

router.get('/overview', async (req, res) => {
  try {
    if (overviewCache && Date.now() - overviewCache.createdAt < OVERVIEW_CACHE_MS) {
      return res.json(overviewCache.data);
    }

    const db = getDB();
    const storedOverview = await db.collection('analytics_overview').findOne({ _id: 'dashboard' });
    if (storedOverview) {
      const { _id, generated_at, ...data } = storedOverview;
      overviewCache = { createdAt: Date.now(), data };
      return res.json(data);
    }

    const [result] = await db.collection('trips').aggregate(buildOverviewPipeline()).toArray();
    const data = {
      topStations: result.topStations,
      peakHours: result.peakHours.map((item) => ({
        hour: item._id,
        passengers: item.total_passengers,
        trips: item.total_trips
      })),
      lineStats: result.lineStats.map((item) => ({
        line: item._id,
        passengers: item.total_passengers,
        trips: item.total_trips
      })),
      topRoutes: result.topRoutes
    };
    overviewCache = { createdAt: Date.now(), data };
    res.json(data);
  } catch (err) {
    console.error('Error fetching analytics overview:', err);
    res.status(500).json({ error: 'Failed to fetch analytics overview' });
  }
});

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
        $lookup: {
          from: 'stations',
          localField: 'from_station',
          foreignField: '_id',
          as: 'from_info'
        }
      },
      {
        $lookup: {
          from: 'stations',
          localField: 'to_station',
          foreignField: '_id',
          as: 'to_info'
        }
      },
      {
        $match: {
          $expr: {
            $ne: [
              { $arrayElemAt: ['$from_info.location', 0] },
              { $arrayElemAt: ['$to_info.location', 0] }
            ]
          }
        }
      },
      {
        $group: {
          _id: {
            from: { $arrayElemAt: ['$from_info.name', 0] },
            to: { $arrayElemAt: ['$to_info.name', 0] }
          },
          total_passengers: { $sum: '$passenger_count' },
          total_trips: { $sum: 1 }
        }
      },
      {
        $project: {
          from_station: '$_id.from',
          to_station: '$_id.to',
          from_name: '$_id.from',
          to_name: '$_id.to',
          total_passengers: 1,
          total_trips: 1
        }
      },
      { $sort: { total_passengers: -1 } },
      { $limit: 15 }
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
