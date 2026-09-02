/**
 * Journey Engine — Route pathfinding + trip details
 * ==================================================
 * Computes the metro journey between two stations from the static station
 * dataset (data/stations.json), which is also what the DB is seeded from.
 *
 * Features:
 *  - Graph of all lines: consecutive stations (by `sequence`) are ride edges.
 *  - Physical interchange stations are duplicated per line in the dataset
 *    (e.g. NADAPRABHU_KEMPEGOWDA_STATION_MAJESTIC ↔ MAJESTIC_GREEN, and
 *    RV_ROAD ↔ RV_ROAD_YELLOW). They are grouped by identical coordinates and
 *    connected with zero-distance transfer edges.
 *  - Dijkstra with cost = hops + TRANSFER_COST per line change, so the
 *    algorithm prefers fewer interchanges among equally short paths and never
 *    adds pointless transfers.
 *  - Derives: stop count, intermediate stations, per-line segments with
 *    direction (towards terminus), total distance (haversine along the path),
 *    fare (BMRCL-style distance slabs — approximate, for demo), estimated
 *    duration, and lines used.
 */

const stations = require('../data/stations.json');

// ── Tuning constants ──
const TRANSFER_COST = 3;      // penalty (in "hops") for changing lines
const MIN_PER_HOP = 2.2;      // avg minutes between stations
const MIN_PER_TRANSFER = 4;   // avg minutes to change lines
const MIN_STARTUP = 1;        // boarding / initial wait allowance
const FREQUENCY_MIN = 8;      // indicative headway (synthetic)
const FIRST_TRAIN = '05:00 AM';
const LAST_TRAIN = '11:00 PM';

// BMRCL-style fare slabs: [max_km_for_slab, fare_₹] — approximate demo values.
const FARE_SLABS = [
  [2, 10], [4, 15], [6, 20], [8, 30], [10, 35], [12, 40], [14, 45], [16, 50],
  [18, 55], [20, 60], [22, 65], [25, 70], [28, 75], [30, 80], [32, 85],
  [34, 90], [36, 95], [38, 100], [40, 105], [42, 110], [44, 115], [46, 120],
  [48, 125], [50, 130], [52, 135], [54, 140], [56, 145], [58, 150], [60, 155],
  [Infinity, 160],
];

// ── Index the dataset ──
const byId = new Map(stations.map(s => [s._id, s]));

const linesMap = {}; // line -> stations sorted by sequence
for (const s of stations) {
  (linesMap[s.line] = linesMap[s.line] || []).push(s);
}
for (const l of Object.values(linesMap)) {
  l.sort((a, b) => a.sequence - b.sequence);
}

/** Haversine distance in meters between two [lng, lat] coordinates. */
function haversineMeters([lng1, lat1], [lng2, lat2]) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Group duplicated physical interchange stations (same coords, 2+ lines) ──
const coordKey = (s) => s.location.coordinates.map(c => Number(c.toFixed(4))).join(',');
const interchangeGroups = new Map(); // key -> [stationId, ...]
for (const s of stations) {
  const k = coordKey(s);
  if (!interchangeGroups.has(k)) interchangeGroups.set(k, []);
  interchangeGroups.get(k).push(s._id);
}
const groupOf = new Map(); // stationId -> group key (only multi-line groups)
for (const ids of interchangeGroups.values()) {
  const uniqueLines = new Set(ids.map(id => byId.get(id).line));
  if (ids.length > 1 && uniqueLines.size > 1) {
    for (const id of ids) groupOf.set(id, [...ids]);
  }
}

// ── Build adjacency list ──
// adj: stationId -> [{ to, type: 'ride'|'transfer', line, meters }]
const adj = new Map();
function addEdge(id, edge) {
  if (!adj.has(id)) adj.set(id, []);
  adj.get(id).push(edge);
}

for (const [line, list] of Object.entries(linesMap)) {
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i];
    const b = list[i + 1];
    const meters = haversineMeters(a.location.coordinates, b.location.coordinates);
    addEdge(a._id, { to: b._id, type: 'ride', line, meters });
    addEdge(b._id, { to: a._id, type: 'ride', line, meters });
  }
}

// Zero-distance transfer edges between duplicated interchange station IDs.
for (const ids of interchangeGroups.values()) {
  for (const a of ids) {
    for (const b of ids) {
      if (a !== b) addEdge(a, { to: b, type: 'transfer', line: null, meters: 0 });
    }
  }
}

// ── Dijkstra (cost = hops + transfer penalty) ──
function findShortestPath(fromId, toId) {
  const dist = new Map([[fromId, 0]]);
  const prev = new Map(); // id -> { node, edge }
  const visited = new Set();

  // Tiny graph (83 nodes) — simple O(V²) selection loop is plenty.
  while (true) {
    let cur = null;
    let curDist = Infinity;
    for (const [id, d] of dist.entries()) {
      if (!visited.has(id) && d < curDist) {
        cur = id;
        curDist = d;
      }
    }
    if (cur === null) break;
    if (cur === toId) break;
    visited.add(cur);

    for (const edge of adj.get(cur) || []) {
      const step = edge.type === 'ride' ? 1 : TRANSFER_COST;
      const nd = curDist + step;
      if (nd < (dist.has(edge.to) ? dist.get(edge.to) : Infinity)) {
        dist.set(edge.to, nd);
        prev.set(edge.to, { node: cur, edge });
      }
    }
  }

  if (!dist.has(toId)) return null;

  // Reconstruct raw node path (with the edge used to arrive at each node).
  const raw = [];
  for (let at = toId; at !== fromId; at = prev.get(at).node) {
    raw.unshift({ id: at, edgeIn: prev.get(at).edge });
  }
  raw.unshift({ id: fromId, edgeIn: null });
  return raw;
}

// ── Journey assembly ──

/** Same physical interchange group? */
function samePhysicalStation(idA, idB) {
  const ga = groupOf.get(idA);
  return !!ga && ga.includes(idB);
}

/** Fare lookup from distance in km. Returns { fare, slab_label }. */
function fareFor(distanceKm) {
  for (let i = 0; i < FARE_SLABS.length; i++) {
    const [maxKm, fare] = FARE_SLABS[i];
    if (distanceKm <= maxKm) {
      const minKm = i === 0 ? 0 : FARE_SLABS[i - 1][0];
      return { fare, slab_label: i === 0 ? '0–2 km' : `${minKm}–${maxKm} km` };
    }
  }
  return { fare: 160, slab_label: '60+ km' };
}

/** Terminus name a train on `line` heads towards, given travel direction. */
function towardsFor(line, fromSeq, toSeq) {
  const list = linesMap[line];
  return toSeq >= fromSeq ? list[list.length - 1].name : list[0].name;
}

/**
 * Compute full journey details between two station IDs.
 * Returns an object with `error` for invalid/unreachable selections,
 * otherwise the complete journey details.
 */
function computeJourney(fromId, toId) {
  const from = byId.get(fromId);
  const to = byId.get(toId);
  if (!from || !to) return { error: 'Unknown station ID.' };
  if (fromId === toId || samePhysicalStation(fromId, toId)) {
    return { error: 'Origin and destination are the same station.' };
  }

  const raw = findShortestPath(fromId, toId);
  if (!raw) return { error: 'No route found between the selected stations.' };

  // Total distance (transfer edges contribute ~0 m — same physical point).
  const totalDistanceKm =
    raw.reduce((sum, n) => sum + (n.edgeIn ? n.edgeIn.meters : 0), 0) / 1000;

  // ── Segments: maximal runs of ride edges on the same line ──
  const segments = [];
  let current = null;
  for (let i = 1; i < raw.length; i++) {
    const node = raw[i];
    const e = node.edgeIn;
    if (e.type === 'ride') {
      if (current && current.line === e.line) {
        current.toId = node.id;
        current.stops += 1;
        current.meters += e.meters;
      } else {
        if (current) segments.push(current);
        current = {
          line: e.line,
          fromId: raw[i - 1].id,
          toId: node.id,
          stops: 1,
          meters: e.meters,
        };
      }
    }
    // Transfer edges are absorbed — the next ride edge starts a new segment.
  }
  if (current) segments.push(current);

  // Enrich segments with names/direction/distance.
  const segs = segments.map(seg => {
    const f = byId.get(seg.fromId);
    const t = byId.get(seg.toId);
    return {
      line: seg.line,
      from: f.name,
      to: t.name,
      towards: towardsFor(seg.line, f.sequence, t.sequence),
      stops: seg.stops,
      distance_km: +(seg.meters / 1000).toFixed(1),
    };
  });

  // Interchange events happen where consecutive segments meet.
  const interchanges = [];
  for (let i = 0; i < segs.length - 1; i++) {
    interchanges.push({
      station: segs[i].to,
      from_line: segs[i].line,
      to_line: segs[i + 1].line,
    });
  }

  // ── Timeline path (display nodes) — merge duplicate interchange IDs ──
  const path = [];
  for (const node of raw) {
    const s = byId.get(node.id);
    const prev = path[path.length - 1];
    if (prev && samePhysicalStation(prev.id, s._id)) {
      // Same physical station as previous node → a line-change point.
      if (prev.line !== s.line) {
        prev.transfer_to = s.line;
        prev.lines = [...new Set([...(prev.lines || [prev.line]), s.line])];
      }
      continue;
    }
    path.push({
      id: s._id,
      name: s.name,
      line: s.line,
      sequence: s.sequence,
      is_interchange: s.is_interchange || undefined,
      lat: s.location.coordinates[1],
      lng: s.location.coordinates[0],
    });
  }
  path[0].lines = path[0].lines || [path[0].line];
  path[0].is_origin = true;
  path[path.length - 1].is_destination = true;

  const stops = raw.filter(n => n.edgeIn && n.edgeIn.type === 'ride').length;
  const { fare, slab_label } = fareFor(totalDistanceKm);
  const durationMin = Math.max(
    2,
    Math.round(stops * MIN_PER_HOP + interchanges.length * MIN_PER_TRANSFER + MIN_STARTUP)
  );

  return {
    from: { id: from._id, name: from.name, line: from.line },
    to: { id: to._id, name: to.name, line: to.line },
    found: true,
    stops,
    intermediate_stations: path.slice(1, -1).map(p => p.name),
    lines_used: [...new Set(segs.map(s => s.line))],
    interchanges,
    segments: segs,
    total_distance_km: +totalDistanceKm.toFixed(1),
    duration_min: durationMin,
    fare: {
      single: fare,
      round_trip: fare * 2,
      slab_label,
      note: 'Approximate demo fare (BMRCL-style distance slabs)',
    },
    timing: {
      first_train: FIRST_TRAIN,
      last_train: LAST_TRAIN,
      frequency_min: FREQUENCY_MIN,
    },
    path,
  };
}

module.exports = { computeJourney };
