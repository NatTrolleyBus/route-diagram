// Stop lists in, positions out...

const X0 = 34, ROW = 40, DX = 13, CW = 17;
const n1 = n => Math.round(n * 10) / 10;
const tw = (s, px) => [...String(s)].length * px * 0.58;
const cell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (cols, rows) => [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n') + '\n';

function block(id, route, d, nameOf, out) {
  const vs = (d.variants || []).filter(v => v && Array.isArray(v.stops) && v.stops.length);
  if (!vs.length) return false;

  const base = new Map(), visit = new Map();
  const seqs = vs.map(v => {
    const seen = new Map();
    return v.stops.map(s => {
      s = String(s);
      const k = (seen.get(s) || 0) + 1;
      seen.set(s, k);
      const n = k > 1 ? s + '~' + k : s;
      base.set(n, s);
      visit.set(n, k);
      return n;
    });
  });
  const ids = [...base.keys()];

  const links = new Map(), next = new Map(ids.map(n => [n, []]));
  const reach = (a, b, seen = new Set()) => {
    if (a === b) return true;
    seen.add(a);
    return next.get(a).some(n => !seen.has(n) && reach(n, b, seen));
  };
  seqs.forEach((q, i) => {
    for (let j = 1; j < q.length; j++) {
      let a = q[j - 1], b = q[j];
      let e = links.get(a + '\u0001' + b) || links.get(b + '\u0001' + a);
      if (!e) {
        if (reach(b, a)) [a, b] = [b, a];
        e = { a, b, trips: 0 };
        links.set(a + '\u0001' + b, e);
        next.get(a).push(b);
      }
      e.trips += Number(vs[i].trips) || 0;
    }
  });

  const row = new Map(ids.map(n => [n, 0]));
  for (let i = 0; i < ids.length; i++)
    for (const e of links.values())
      if (row.get(e.b) <= row.get(e.a)) row.set(e.b, row.get(e.a) + 1);

  const col = new Map();
  let c = -1;
  for (const q of seqs) {
    let fresh = true;
    for (const n of q) if (!col.has(n)) {
      if (fresh) { c++; fresh = false; }
      col.set(n, c);
    }
  }

  const numbered = vs.length > 1;
  const starts = new Map(), ends = new Map();
  const add = (m, n, k) => m.set(n, (m.get(n) || []).concat(k));
  seqs.forEach((q, i) => { add(starts, q[0], i + 1); add(ends, q[q.length - 1], i + 1); });
  const tagW = (word, nums) => tw(word, 10.5) + 5 + (numbered ? nums.length * (CW + 3) : 0);
  const wide = n => {
    const s = starts.get(n), e = ends.get(n);
    let w = tw(nameOf(base.get(n)), 12.5);
    if (s) w += 12 + tagW('start', s);
    if (e) w += (s ? 8 : 12) + tagW('end', e);
    return w;
  };
  const colX = [X0];
  for (let k = 0; k <= c; k++)
    colX.push(colX[k] + Math.max(...ids.filter(n => col.get(n) === k).map(wide)) + DX + 24);
  const X = n => n1(colX[col.get(n)]);
  const Y = n => row.get(n) * ROW;

  out.d.push({ diagram_id: id, route_id: route, direction_id: d.direction ?? '' });
  vs.forEach((v, i) => out.v.push({ diagram_id: id, variant_number: i + 1, trip_id: v.trip ?? '' }));
  for (const n of ids) out.s.push({ diagram_id: id, stop_id: base.get(n), visit: visit.get(n), x: X(n), y: Y(n) });
  for (const e of [...links.values()].sort((p, q) => p.trips - q.trips)) {
    const ax = X(e.a), bx = X(e.b);
    const m = bx > ax ? Y(e.a) + ROW / 2 : Y(e.b) - ROW / 2;
    out.e.push({
      diagram_id: id, from_stop_id: base.get(e.a), from_visit: visit.get(e.a),
      to_stop_id: base.get(e.b), to_visit: visit.get(e.b), points: ax === bx ? '' : `${ax} ${m};${bx} ${m}`,
    });
  }
  return true;
}

export function layoutRoute({ route = '', names, directions } = {}) {
  const nameOf = id => String((typeof names === 'function' ? names(id) : names && names[id]) || id);
  const out = { d: [], v: [], s: [], e: [] };
  let k = 0;
  for (const d of directions || []) if (block('d' + (k + 1), route, d, nameOf, out)) k++;
  return {
    'diagram.txt': csv(['diagram_id', 'route_id', 'direction_id'], out.d),
    'diagram_variants.txt': csv(['diagram_id', 'variant_number', 'trip_id'], out.v),
    'diagram_stops.txt': csv(['diagram_id', 'stop_id', 'visit', 'x', 'y'], out.s),
    'diagram_edges.txt': csv(['diagram_id', 'from_stop_id', 'from_visit', 'to_stop_id', 'to_visit', 'points'], out.e),
  };
}
