import json
import math
import heapq
from collections import defaultdict

INPUT_GEOJSON = "moscow.geojson"
OUTPUT_GEOJSON = "route.geojson"

# Координаты станций в формате (lon, lat)
START_STATION = (37.72799376190131, 55.67411570948639)
END_STATION = (37.48993888954895, 55.81520969268094)

# Максимальный разрыв, который можно автоматически склеить
SNAP_TOLERANCE = 0.0005

# Округление координат узлов графа
ROUND_DIGITS = 7

# Штрафы
BRIDGE_MULTIPLIER = 50.0       # умножение веса мостика на расстояние
BRIDGE_EXTRA_PENALTY = 1.0     # дополнительный фиксированный штраф за bridge
TURN_PENALTY = 0.003           # штраф за поворот
SHARP_TURN_FACTOR = 4.0        # усиление штрафа на резких углах
LINE_CHANGE_PENALTY = 0.05     # штраф за переход на другую линию


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def round_pt(pt):
    return (round(pt[0], ROUND_DIGITS), round(pt[1], ROUND_DIGITS))


def load_geojson(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_geojson(path, coords):
    data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "rail_route"
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[x, y] for x, y in coords]
                }
            }
        ]
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def extract_lines(data):
    lines = []

    for feature in data.get("features", []):
        geom = feature.get("geometry", {})
        gtype = geom.get("type")

        if gtype == "LineString":
            coords = geom.get("coordinates", [])
            if len(coords) >= 2:
                lines.append([tuple(c) for c in coords])

        elif gtype == "MultiLineString":
            for part in geom.get("coordinates", []):
                if len(part) >= 2:
                    lines.append([tuple(c) for c in part])

    return lines


def project_point_to_segment(p, a, b):
    ax, ay = a
    bx, by = b
    px, py = p

    abx = bx - ax
    aby = by - ay
    ab2 = abx * abx + aby * aby

    if ab2 == 0:
        return a, 0.0, dist(p, a)

    apx = px - ax
    apy = py - ay

    t = (apx * abx + apy * aby) / ab2
    t = max(0.0, min(1.0, t))

    proj = (ax + t * abx, ay + t * aby)
    return proj, t, dist(p, proj)


def find_best_projection(lines, point):
    best = None
    best_d = float("inf")

    for line_idx, line in enumerate(lines):
        for seg_idx in range(len(line) - 1):
            a = line[seg_idx]
            b = line[seg_idx + 1]
            proj, t, d = project_point_to_segment(point, a, b)

            if d < best_d:
                best_d = d
                best = {
                    "line_idx": line_idx,
                    "seg_idx": seg_idx,
                    "a": a,
                    "b": b,
                    "proj": proj,
                    "t": t,
                    "dist": d
                }

    return best


def build_graph_with_line_ids(lines):
    """
    graph[u] = [
        {
            "to": v,
            "weight": w,
            "kind": "rail" | "bridge",
            "line_id": ...
        }
    ]
    """
    graph = defaultdict(list)

    def add_edge(a, b, kind, line_id, weight=None):
        a = round_pt(a)
        b = round_pt(b)

        if a == b:
            return

        w = dist(a, b) if weight is None else weight

        graph[a].append({
            "to": b,
            "weight": w,
            "kind": kind,
            "line_id": line_id
        })
        graph[b].append({
            "to": a,
            "weight": w,
            "kind": kind,
            "line_id": line_id
        })

    # обычные ж/д сегменты
    for line_id, line in enumerate(lines):
        for i in range(len(line) - 1):
            add_edge(line[i], line[i + 1], kind="rail", line_id=line_id)

    # мостики между близкими концами разных линий
    endpoints = []
    for line_id, line in enumerate(lines):
        endpoints.append((line_id, line[0]))
        endpoints.append((line_id, line[-1]))

    for i in range(len(endpoints)):
        line_id_a, a = endpoints[i]
        a = round_pt(a)

        for j in range(i + 1, len(endpoints)):
            line_id_b, b = endpoints[j]
            b = round_pt(b)

            if line_id_a == line_id_b:
                continue

            d = dist(a, b)
            if d <= SNAP_TOLERANCE:
                add_edge(
                    a,
                    b,
                    kind="bridge",
                    line_id=f"bridge:{line_id_a}:{line_id_b}",
                    weight=d * BRIDGE_MULTIPLIER
                )

    return graph


def remove_edge(graph, u, v):
    graph[u] = [e for e in graph[u] if e["to"] != v]


def insert_projection_into_graph(graph, proj_info):
    """
    Разбивает сегмент a-b точкой p, чтобы станция стала узлом графа.
    """
    a = round_pt(proj_info["a"])
    b = round_pt(proj_info["b"])
    p = round_pt(proj_info["proj"])
    line_id = proj_info["line_idx"]

    if p not in graph:
        graph[p] = []

    # убираем прямую связь a-b
    remove_edge(graph, a, b)
    remove_edge(graph, b, a)

    # вставляем a-p и p-b
    if a != p:
        wa = dist(a, p)
        graph[a].append({
            "to": p,
            "weight": wa,
            "kind": "rail",
            "line_id": line_id
        })
        graph[p].append({
            "to": a,
            "weight": wa,
            "kind": "rail",
            "line_id": line_id
        })

    if b != p:
        wb = dist(p, b)
        graph[b].append({
            "to": p,
            "weight": wb,
            "kind": "rail",
            "line_id": line_id
        })
        graph[p].append({
            "to": b,
            "weight": wb,
            "kind": "rail",
            "line_id": line_id
        })

    return p


def angle_penalty(prev_node, cur_node, next_node):
    if prev_node is None:
        return 0.0

    ax, ay = prev_node
    bx, by = cur_node
    cx, cy = next_node

    v1 = (bx - ax, by - ay)
    v2 = (cx - bx, cy - by)

    len1 = math.hypot(v1[0], v1[1])
    len2 = math.hypot(v2[0], v2[1])

    if len1 == 0 or len2 == 0:
        return 0.0

    cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (len1 * len2)
    cosang = max(-1.0, min(1.0, cosang))
    angle = math.acos(cosang)

    return TURN_PENALTY * (1.0 - cosang) * (1.0 + SHARP_TURN_FACTOR * (angle / math.pi))


def dijkstra_prefer_same_line(graph, start, end):
    """
    Состояние:
    - текущий узел
    - предыдущий узел
    - line_id предыдущего ребра

    Это позволяет штрафовать:
    - резкие повороты
    - переход на другую линию
    - bridge
    """
    pq = [(0.0, start, None, None)]
    best = {(start, None, None): 0.0}
    parent = {(start, None, None): None}

    final_state = None

    while pq:
        cur_cost, cur, prev, prev_line_id = heapq.heappop(pq)

        if cur_cost != best.get((cur, prev, prev_line_id), float("inf")):
            continue

        if cur == end:
            final_state = (cur, prev, prev_line_id)
            break

        for edge in graph[cur]:
            nxt = edge["to"]
            line_id = edge["line_id"]

            step_cost = edge["weight"]

            # штраф за поворот
            step_cost += angle_penalty(prev, cur, nxt)

            # штраф за bridge
            if edge["kind"] == "bridge":
                step_cost += BRIDGE_EXTRA_PENALTY

            # штраф за смену линии
            if prev_line_id is not None and line_id != prev_line_id:
                step_cost += LINE_CHANGE_PENALTY

            new_cost = cur_cost + step_cost
            state = (nxt, cur, line_id)

            if new_cost < best.get(state, float("inf")):
                best[state] = new_cost
                parent[state] = (cur, prev, prev_line_id)
                heapq.heappush(pq, (new_cost, nxt, cur, line_id))

    if final_state is None:
        return None

    path = []
    state = final_state
    while state is not None:
        cur, prev, prev_line_id = state
        path.append(cur)
        state = parent[state]

    path.reverse()

    # убираем подряд идущие дубли
    result = []
    for p in path:
        if not result or result[-1] != p:
            result.append(p)

    return result


def main():
    data = load_geojson(INPUT_GEOJSON)
    lines = extract_lines(data)

    if not lines:
        raise ValueError("В файле не найдено ни одного LineString/MultiLineString")

    graph = build_graph_with_line_ids(lines)

    start_proj = find_best_projection(lines, START_STATION)
    end_proj = find_best_projection(lines, END_STATION)

    if start_proj is None or end_proj is None:
        raise ValueError("Не удалось спроецировать станции на сеть")

    print("Стартовая проекция:", start_proj["proj"], "distance:", start_proj["dist"], "line:", start_proj["line_idx"])
    print("Конечная проекция:", end_proj["proj"], "distance:", end_proj["dist"], "line:", end_proj["line_idx"])

    start_node = insert_projection_into_graph(graph, start_proj)
    end_node = insert_projection_into_graph(graph, end_proj)

    path = dijkstra_prefer_same_line(graph, start_node, end_node)

    if not path:
        raise ValueError("Путь не найден")

    save_geojson(OUTPUT_GEOJSON, path)

    print("Готово:", OUTPUT_GEOJSON)
    print("Количество точек:", len(path))


if __name__ == "__main__":
    main()