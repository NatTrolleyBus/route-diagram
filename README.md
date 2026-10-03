# route-diagram

Turn a transit route’s stop patterns into a clean, schematic line diagram.

You give it stop sequences. It gives you positions: which column each stop sits in and where the lines bend, as four small GTFS-style CSV tables.

<img width="4110" height="4850" alt="Metro_A_Line+Metro_B_Line+Metro_C_Line+Metro_D_Line+Metro_E_Line+Metro_K_Line_dir0_merged" src="https://github.com/user-attachments/assets/22e11068-42c7-4cd7-b56e-5c385f65762f" />
<img width="2534" height="2462" alt="C+D+E+T+W+R_dir0_merged" src="https://github.com/user-attachments/assets/77e2d4b3-2356-4637-96ac-9548a32aec2a" />


## Files

| File | What it does | Use it for |
| --- | --- | --- |
| `route-diagram.js` | Turns stop sequences into the four `diagram_*.txt` tables. | Creating layouts |
| `gtfs-diagram.js` | Reads the layout tables and a GTFS feed, and returns positions to draw. Also reads feeds, parses CSV, and zips/unzips. | Drawing diagrams |

From the feed, only `routes.txt`, `trips.txt`, `stop_times.txt` and `stops.txt` are used.

## Use it with GTFS

```js
import { layoutRoute } from './route-diagram.js';
import { indexFeed, readLayout, buildDiagram } from './gtfs-diagram.js';
```

### 1. Load the feed

Pass the text of `routes.txt`, `trips.txt`, `stop_times.txt` and `stops.txt`.

### 2. Group trips into variants

For each route and direction, group trips by identical stop sequence. Each group is a variant: `{ trip, trips, stops }`, busiest first.

### 3. Make the layout

You get the four `diagram_*.txt` tables back as CSV strings.

### 4. Rebuild it

It throws if the feed no longer matches the layout.

### 5. Draw it

`diagram` contains plain coordinates: each stop has `x`, `y`, `r`, `name` and `labelX`, and each edge comes with a ready-made `path`. Render it however you like, whether that's SVG, canvas, React, PDF, or something else.

## Plain CSV

The layout and the feed are both plain CSV in a single `files` object, so `indexFeed(files)` and `readLayout(files)` can read the same one. That also means you can write the four layout files straight into the feed folder, commit them to git, hand-edit them (nudge an `x` or `y`), or ship them with a website.

## The layout files

```text
diagram.txt             diagram_id, route_id, direction_id
diagram_variants.txt    diagram_id, variant_number, trip_id
diagram_stops.txt       diagram_id, stop_id, visit, x, y
diagram_edges.txt       diagram_id, from_stop_id, from_visit, to_stop_id, to_visit, points
```

### A small sample

**diagram_stops.txt**

```csv
diagram_id,stop_id,visit,x,y
d1,a,1,34,0
d1,b,1,34,40
d1,c,1,34,80
d1,g,1,217,80
d1,h,1,217,120
```

**diagram_edges.txt**

```csv
diagram_id,from_stop_id,from_visit,to_stop_id,to_visit,points
d1,a,1,b,1,
d1,b,1,c,1,
d1,b,1,g,1,34 60;217 60
d1,g,1,h,1,
```
