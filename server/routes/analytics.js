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

/**
 * GET /api/analytics/weekday-weekend
 * Returns weekday vs weekend hourly passenger distribution and comparisons.
 */
router.get('/weekday-weekend', async (req, res) => {
  try {
    const db = getDB();
    const stored = await db.collection('analytics_overview').findOne({ _id: 'dashboard' });
    if (stored && stored.weekdayWeekend) {
      return res.json(stored.weekdayWeekend);
    }

    // Fallback on-the-fly aggregation
    const weekdayWeekendRaw = await db.collection('trips').aggregate([
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

    res.json({
      weekday: weekdayHours,
      weekend: weekendHours,
      weekdayTotal,
      weekendTotal,
      weekdayTrips,
      weekendTrips,
      weekdayAvgDaily: Math.round(weekdayTotal / 64),
      weekendAvgDaily: Math.round(weekendTotal / 26),
      commuteRatio: ((weekdayTotal / 64) / (weekendTotal / 26)).toFixed(2)
    });
  } catch (err) {
    console.error('Error fetching weekday vs weekend analytics:', err);
    res.status(500).json({ error: 'Failed to fetch weekday-weekend analytics' });
  }
});

/**
 * GET /api/analytics/station-heatmap
 * Returns 24-hour density distribution for top stations.
 */
router.get('/station-heatmap', async (req, res) => {
  try {
    const db = getDB();
    const stored = await db.collection('analytics_overview').findOne({ _id: 'dashboard' });
    if (stored && stored.stationHeatmap) {
      return res.json(stored.stationHeatmap);
    }

    res.status(503).json({ error: 'Heatmap data generating, please refresh shortly' });
  } catch (err) {
    console.error('Error fetching station heatmap:', err);
    res.status(500).json({ error: 'Failed to fetch station heatmap' });
  }
});

/**
 * GET /api/analytics/monthly-trend
 * Returns longitudinal 90-day daily trajectory, weekly growth and monthly rollups.
 */
router.get('/monthly-trend', async (req, res) => {
  try {
    const db = getDB();
    const stored = await db.collection('analytics_overview').findOne({ _id: 'dashboard' });
    if (stored && stored.monthlyTrend) {
      return res.json(stored.monthlyTrend);
    }

    res.status(503).json({ error: 'Trend data generating, please refresh shortly' });
  } catch (err) {
    console.error('Error fetching monthly trend:', err);
    res.status(500).json({ error: 'Failed to fetch monthly trend' });
  }
});

/**
 * GET /api/analytics/interchange-load
 * Returns multi-line transfer volume dynamics at Majestic and RV Road hubs.
 */
router.get('/interchange-load', async (req, res) => {
  try {
    const db = getDB();
    const stored = await db.collection('analytics_overview').findOne({ _id: 'dashboard' });
    if (stored && stored.interchangeLoad) {
      return res.json(stored.interchangeLoad);
    }

    res.status(503).json({ error: 'Interchange data generating, please refresh shortly' });
  } catch (err) {
    console.error('Error fetching interchange load:', err);
    res.status(500).json({ error: 'Failed to fetch interchange load' });
  }
});

module.exports = router;

