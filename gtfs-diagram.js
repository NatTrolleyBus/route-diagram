// GTFS diagram layout files.
//
// Stores only what GTFS doesn't know (where things are drawn) as four small
// GTFS-style tables that point into a feed. Everything else... such as stop names,
// stop sequences, headsigns, trip counts, route colour should be read back from
// the feed.
//
// Needs from the feed: routes.txt, trips.txt, stop_times.txt, stops.txt.
//
//   diagram.txt           diagram_id, route_id, direction_id
//   diagram_variants.txt  diagram_id, variant_number, trip_id
//   diagram_stops.txt     diagram_id, stop_id, visit, x, y
//   diagram_edges.txt     diagram_id, from_stop_id, from_visit, to_stop_id, to_visit, points
//
// - One diagram = one direction of one route. Diagrams are drawn top to
//   bottom in diagram.txt order; edges are painted in file order.
// - A variant = every trip of that route + direction with the same stop
//   sequence as `trip_id`. Its trip count and headsigns come from the feed.
// - `visit` is 1, or 2+ when a variant passes the same stop again (loops).
// - y is relative to the diagram's first stop row. `points` are the bends
//   between the two stops as "x y;x y" (empty for a straight line).

const X0 = 34;
const CORNER = 9;
const LABEL_DX = 13;
const CHIP_W = 17;
const CHIP_H = 15;
const LEG_ROW = 21;

const n1 = n => Math.round(n * 10) / 10;
const textW = (s, px) => [...String(s)].length * px * 0.58;

// ------------------------------------------------------------------ csv
export function parseCsv(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => !(r.length === 1 && r[0] === '')).map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}


// ----------------------------------------------------------------- feed
export function indexFeed(files) {
  for (const f of ['routes.txt', 'trips.txt', 'stop_times.txt', 'stops.txt'])
    if (files[f] == null) throw new Error('missing ' + f);
  const feed = { routesById: {}, stopsById: {}, tripsByRoute: {}, stopSeqByTrip: {} };
  for (const r of parseCsv(files['routes.txt'])) feed.routesById[r.route_id] = r;
  for (const s of parseCsv(files['stops.txt'])) feed.stopsById[s.stop_id] = s;
  for (const t of parseCsv(files['trips.txt'])) (feed.tripsByRoute[t.route_id] ||= []).push(t);
  const byTrip = {};
  for (const st of parseCsv(files['stop_times.txt'])) (byTrip[st.trip_id] ||= []).push(st);
  for (const tid in byTrip)
    feed.stopSeqByTrip[tid] = byTrip[tid].sort((a, b) => a.stop_sequence - b.stop_sequence).map(st => st.stop_id);
  return feed;
}

// ---------------------------------------------------------------- import
export function readLayout(files) {
  const get = n => { if (files[n] == null) throw new Error('missing ' + n); return parseCsv(files[n]); };
  return {
    diagrams: get('diagram.txt'),
    variants: get('diagram_variants.txt'),
    stops: get('diagram_stops.txt'),
    edges: get('diagram_edges.txt'),
  };
}

function cleanPoints(raw) {
  const pts = [];
  for (const p of raw) {
    const q = pts[pts.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 0.01 || Math.abs(q[1] - p[1]) > 0.01) pts.push(p);
  }
  for (let i = pts.length - 2; i > 0; i--) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    if ((Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) ||
        (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01)) pts.splice(i, 1);
  }
  return pts;
}

function roundedPath(pts) {
  let d = `M${n1(pts[0][0])} ${n1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const r = Math.min(CORNER, d1 / 2, d2 / 2);
    d += `L${n1(p1[0] + (p0[0] - p1[0]) * r / d1)} ${n1(p1[1] + (p0[1] - p1[1]) * r / d1)}` +
         `Q${n1(p1[0])} ${n1(p1[1])} ${n1(p1[0] + (p2[0] - p1[0]) * r / d2)} ${n1(p1[1] + (p2[1] - p1[1]) * r / d2)}`;
  }
  const last = pts[pts.length - 1];
  return d + `L${n1(last[0])} ${n1(last[1])}`;
}

function buildBlock(d, tables, feed, route, y0, errors, warnings) {
  const id = d.diagram_id, dir = d.direction_id || '';
  const errCount = errors.size;
  const key = (sid, visit) => sid + '\u0000' + visit;
  const nodeId = p => p.visit > 1 ? p.sid + '~' + p.visit : p.sid;

  // positions + edges from the layout
  const pos = new Map();
  for (const s of tables.stops) if (s.diagram_id === id) {
    const visit = Number(s.visit) || 1;
    pos.set(key(s.stop_id, visit), { sid: s.stop_id, visit, x: Number(s.x), y: Number(s.y) });
  }
  const edges = tables.edges.filter(e => e.diagram_id === id).map(e => ({
    a: key(e.from_stop_id, Number(e.from_visit) || 1),
    b: key(e.to_stop_id, Number(e.to_visit) || 1),
    bends: e.points ? e.points.split(';').map(p => p.trim().split(/\s+/).map(Number)) : [],
    trips: 0,
  }));
  const edgeOf = new Map();
  for (const e of edges) {
    if (!pos.has(e.a) || !pos.has(e.b)) errors.add(`${id}: an edge refers to a stop that isn't in diagram_stops.txt`);
    edgeOf.set(e.a + '\u0001' + e.b, e);
    edgeOf.set(e.b + '\u0001' + e.a, e);
  }

  // feed trips of this route + direction, grouped by identical stop sequence
  const trips = (feed.tripsByRoute[route.route_id] || []).filter(t => (t.direction_id || '') === dir);
  const groups = new Map(), tripById = new Map();
  for (const t of trips) {
    tripById.set(t.trip_id, t);
    const seq = feed.stopSeqByTrip[t.trip_id];
    if (!seq || !seq.length) continue;
    let g = groups.get(seq.join('>'));
    if (!g) groups.set(seq.join('>'), g = { seq, count: 0, headsigns: new Set(), used: false });
    g.count++;
    if (t.trip_headsign) g.headsigns.add(t.trip_headsign);
  }

  // variants: layout trip_id -> feed stop sequence -> must match the drawn stops/edges
  const variants = [];
  const vrows = tables.variants.filter(v => v.diagram_id === id).sort((a, b) => a.variant_number - b.variant_number);
  for (const v of vrows) {
    const seq = tripById.has(v.trip_id) && feed.stopSeqByTrip[v.trip_id];
    if (!seq || !seq.length) {
      errors.add(`${id}: trip ${v.trip_id} (variant ${v.variant_number}) is not a trip of route ${route.route_id}, direction ${dir || 'none'}, with stop_times`);
      continue;
    }
    const g = groups.get(seq.join('>'));
    g.used = true;
    const seen = new Map();
    const nodes = seq.map(sid => { const k = (seen.get(sid) || 0) + 1; seen.set(sid, k); return key(sid, k); });
    nodes.forEach((n, i) => {
      if (!pos.has(n)) return errors.add(`${id}: stop ${n.split('\u0000')[0]} (variant ${v.variant_number}) has no position in the layout`);
      if (!i) return;
      const e = edgeOf.get(nodes[i - 1] + '\u0001' + n);
      if (!e) errors.add(`${id}: variant ${v.variant_number} goes ${nodes[i - 1].split('\u0000')[0]} -> ${n.split('\u0000')[0]}, which the layout has no line for`);
      else e.trips += g.count;
    });
    variants.push({ number: Number(v.variant_number), name: [...g.headsigns].join(' / '), trips: g.count, nodes });
  }
  if (errors.size > errCount) return null;

  const unused = [...groups.values()].filter(g => !g.used);
  if (unused.length) {
    const n = unused.reduce((s, g) => s + g.count, 0);
    warnings.push(`${id}: ${n} trip${n === 1 ? '' : 's'} in ${unused.length} stop pattern${unused.length === 1 ? '' : 's'} on this route/direction ${unused.length === 1 ? 'is' : 'are'} not in the layout`);
  }
  const visited = new Set(variants.flatMap(v => v.nodes));
  const stale = [...pos.keys()].filter(k => !visited.has(k)).length;
  if (stale) warnings.push(`${id}: ${stale} positioned stop${stale === 1 ? ' is' : 's are'} not served by any variant`);

  // everything below is derived from the positions and the feed
  const numbered = variants.length > 1;
  const starts = new Map(), ends = new Map();
  const mark = (m, n, num) => m.set(n, (m.get(n) || []).concat(num));
  for (const v of variants) { mark(starts, v.nodes[0], v.number); mark(ends, v.nodes[v.nodes.length - 1], v.number); }
  const indeg = new Map(), outdeg = new Map();
  for (const e of edges) { outdeg.set(e.a, (outdeg.get(e.a) || 0) + 1); indeg.set(e.b, (indeg.get(e.b) || 0) + 1); }
  const junction = k => (indeg.get(k) || 0) > 1 || (outdeg.get(k) || 0) > 1;
  const radius = k => junction(k) ? 6 : (starts.has(k) || ends.has(k)) ? 5.5 : 4.5;
  const nameOf = sid => String((feed.stopsById[sid] && feed.stopsById[sid].stop_name) || sid);
  for (const p of pos.values()) if (!feed.stopsById[p.sid]) warnings.push(`${id}: stop ${p.sid} is not in stops.txt`);

  const legendX = X0 - 10;
  let ly = 26, right = 0;
  const legend = variants.map(v => {
    const name = v.name || 'Variant ' + v.number;
    const tripsLabel = `${v.trips} trip${v.trips === 1 ? '' : 's'}`;
    const cw = numbered ? CHIP_W : 18;
    right = Math.max(right, legendX + cw + 9 + textW(name, 12.5) + 10 + textW(tripsLabel, 11.5));
    const item = {
      number: v.number, name, trips: v.trips, tripsLabel, stops: v.nodes.map(k => nodeId(pos.get(k))),
      x: legendX, y: n1(y0 + ly + LEG_ROW / 2), textX: n1(legendX + cw + 9),
    };
    ly += LEG_ROW;
    return item;
  });
  const top = y0 + ly + 26;

  const tagW = (word, nums) => textW(word, 10.5) + 5 + (numbered ? nums.length * (CHIP_W + 3) : 0);
  let maxRight = 0, maxY = 0;
  const stops = [...pos].map(([k, p]) => {
    const name = nameOf(p.sid), st = starts.get(k), en = ends.get(k);
    let w = textW(name, 12.5);
    if (st) w += 12 + tagW('start', st);
    if (en) w += (st ? 8 : 12) + tagW('end', en);
    maxRight = Math.max(maxRight, p.x + LABEL_DX + w);
    maxY = Math.max(maxY, p.y);

    let cx = p.x + LABEL_DX + textW(name, 12.5) + 12;
    const tags = [];
    const tag = (kind, nums) => {
      const t = { kind, x: n1(cx), chips: [] };
      cx += textW(kind, 10.5) + 5;
      if (numbered) for (const number of nums) { t.chips.push({ number, x: n1(cx) }); cx += CHIP_W + 3; }
      tags.push(t);
    };
    if (st) tag('start', st);
    if (en) { if (st) cx += 5; tag('end', en); }
    return {
      id: nodeId(p), stopId: p.sid, name, x: n1(p.x), y: n1(top + p.y), r: radius(k),
      junction: junction(k), terminal: !!(st || en), labelX: n1(p.x + LABEL_DX), tags,
    };
  });

  const outEdges = edges.map(e => {
    const A = pos.get(e.a), B = pos.get(e.b);
    const pts = cleanPoints([
      [A.x, top + A.y + radius(e.a)],
      ...e.bends.map(([bx, by]) => [bx, top + by]),
      [B.x, top + B.y - radius(e.b)],
    ]);
    return { from: nodeId(A), to: nodeId(B), trips: e.trips, points: pts.map(p => [n1(p[0]), n1(p[1])]), path: roundedPath(pts) };
  });

  return {
    width: Math.max(maxRight, right) + 30,
    height: top - y0 + maxY + 30,
    data: {
      title: { text: dir === '' ? 'All headsigns' : `Direction ${dir}`, x: legendX, y: n1(y0 + 14) },
      numbered, variants: legend, edges: outEdges, stops,
    },
  };
}

export function buildDiagram(tables, feed, { routeId, directionId = 'all' } = {}) {
  const ds = tables.diagrams.filter(d =>
    d.route_id === String(routeId) && (directionId === 'all' || (d.direction_id || '') === String(directionId ?? '')));
  if (!ds.length) return null;
  const route = feed.routesById[routeId];
  if (!route) throw new Error(`route ${routeId} is not in routes.txt`);

  const errors = new Set(), warnings = [], out = [], dividerY = [];
  let y = 18, width = 1;
  for (const d of ds) {
    const start = out.length ? y + 22 : y;
    const b = buildBlock(d, tables, feed, route, start, errors, warnings);
    if (!b) continue;
    if (out.length) dividerY.push(y);
    out.push(b.data);
    width = Math.max(width, b.width);
    y = start + b.height;
  }
  if (errors.size) throw new Error([...errors].join('\n'));

  const W = Math.ceil(width), H = Math.ceil(Math.max(1, y));
  return {
    diagram: {
      width: W, height: H, chip: { w: CHIP_W, h: CHIP_H },
      dividers: dividerY.map(dy => ({ x1: X0 - 10, x2: W - 20, y: dy })),
      directions: out,
    },
    route,
    warnings,
  };
}

// ------------------------------------------------------------------ zip
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = bytes => { let c = ~0; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };

// uncompressed zip (method 0), readable by everything
export function zipFiles(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
    loc.setUint16(12, 0x21, true); loc.setUint32(14, crc, true);
    loc.setUint32(18, data.length, true); loc.setUint32(22, data.length, true); loc.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(loc.buffer), nm, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(14, 0x21, true); cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nm.length, true);
    cen.setUint32(42, off, true);
    central.push(new Uint8Array(cen.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0), count = Object.keys(files).length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
  end.setUint32(12, size, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// reads stored or deflated entries (deflate needs DecompressionStream: modern browsers, Node 22+)
export async function unzipFiles(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), dec = new TextDecoder();
  let e = u.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const out = {};
  let p = dv.getUint32(e + 16, true);
  for (let i = dv.getUint16(e + 10, true); i > 0; i--) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true), loc = dv.getUint32(p + 42, true);
    const nlen = dv.getUint16(p + 28, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    if (name.endsWith('/')) continue;
    const start = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
    let data = u.subarray(start, start + size);
    if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (method !== 0) throw new Error(`${name}: unsupported zip compression`);
    out[name.split('/').pop()] = dec.decode(data);
  }
  return out;
}
