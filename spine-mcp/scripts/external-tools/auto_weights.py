"""libigl BBW backend. Input/output JSON files; no Spine files are touched here."""
import json
import sys
import numpy as np
import igl
from scipy.optimize import linear_sum_assignment
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components


def solve(data):
    v = np.asarray(data["vertices"], dtype=np.float64)
    f = np.asarray(data["triangles"], dtype=np.int64)
    bones = np.asarray(data["bones"], dtype=np.float64)
    if v.ndim != 2 or v.shape[1] != 2 or len(v) < 3 or len(v) > 4096:
        raise ValueError("Expected 3..4096 planar vertices")
    if f.ndim != 2 or f.shape[1] != 3 or not len(f) or np.min(f) < 0 or np.max(f) >= len(v):
        raise ValueError("Invalid triangle indices")
    if bones.ndim != 2 or bones.shape[1] != 4 or not 1 <= len(bones) <= min(64, len(v)):
        raise ValueError("Expected 1..64 bones, no more than vertices")
    if not np.isfinite(v).all() or not np.isfinite(bones).all():
        raise ValueError("Nonfinite coordinates")
    scale = float(np.max(np.ptp(v, axis=0)))
    if scale <= 1e-12:
        raise ValueError("Collapsed mesh")
    origin = np.min(v, axis=0)
    v = (v - origin) / scale
    start = (bones[:, :2] - origin) / scale
    end = (bones[:, 2:] - origin) / scale
    a = v[f[:, 1]] - v[f[:, 0]]
    b = v[f[:, 2]] - v[f[:, 0]]
    if np.any(np.abs(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) < 1e-12):
        raise ValueError("Degenerate mesh triangles")
    delta = end - start
    length = np.sum(delta * delta, axis=1)
    t = np.sum((v[:, None, :] - start) * delta, axis=2) / np.maximum(length, 1e-20)
    closest = start + np.clip(t, 0, 1)[:, :, None] * delta
    distances = np.sum((v[:, None, :] - closest) ** 2, axis=2)
    pins = {}
    for pin in data.get("pins", []):
        vertex, bone = pin["vertexIndex"], pin["boneIndex"]
        if not 0 <= vertex < len(v) or not 0 <= bone < len(bones) or vertex in pins:
            raise ValueError("Invalid or duplicate pin")
        pins[vertex] = bone
    # Give each bone a distinct seed. The midpoint term resolves ties along a bone.
    missing = [j for j in range(len(bones)) if j not in pins.values()]
    free = [i for i in range(len(v)) if i not in pins]
    if len(missing) > len(free):
        raise ValueError("Not enough free vertices for all bone handles")
    midpoint = (start + end) / 2
    costs = distances + 0.05 * np.sum((v[:, None, :] - midpoint) ** 2, axis=2)
    if missing:
        rows, cols = linear_sum_assignment(costs[np.ix_(free, missing)].T)
        for row, col in zip(rows, cols):
            pins[free[col]] = missing[row]
    # Extend handles along bone segments where no other handle has claimed a vertex.
    for j in range(len(bones)):
        for fraction in (0.1, 0.5, 0.9):
            i = int(np.argmin(np.sum((v - (start[j] + fraction * delta[j])) ** 2, axis=1)))
            if i not in pins and int(np.argmin(distances[i])) == j:
                pins[i] = j
    edges = np.vstack((f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]))
    graph = coo_matrix((np.ones(len(edges) * 2),
                        (np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]])), shape=(len(v), len(v)))
    count, labels = connected_components(graph)
    used = set(f.ravel().tolist())
    if len(used) != len(v):
        raise ValueError("Mesh contains unused vertices")
    for component in range(count):
        indices = np.flatnonzero(labels == component)
        if not any(int(i) in pins for i in indices):
            i = int(indices[np.argmin(np.min(distances[indices], axis=1))])
            pins[i] = int(np.argmin(distances[i]))
    indices = np.asarray(sorted(pins), dtype=np.int64)
    bc = np.zeros((len(indices), len(bones)))
    for row, i in enumerate(indices):
        bc[row, pins[int(i)]] = 1
    w = igl.bbw(v, f, indices, bc, max_iter=200)
    if w.shape != (len(v), len(bones)) or not np.isfinite(w).all() or np.min(w) < -1e-6 or np.max(w) > 1 + 1e-6:
        raise ValueError("BBW returned invalid weights")
    w = np.clip(w, 0, 1)
    sums = np.sum(w, axis=1)
    if np.any(sums <= 1e-10) or np.max(np.abs(w[indices] - bc)) > 1e-5:
        raise ValueError("BBW failed to satisfy boundary conditions")
    w /= sums[:, None]
    return {"backend": "libigl-bbw", "weights": w.tolist(),
            "pins": [{"vertexIndex": int(i), "boneIndex": int(pins[int(i)])} for i in indices]}


if __name__ == "__main__":
    try:
        with open(sys.argv[1], encoding="utf-8") as stream:
            result = solve(json.load(stream))
        with open(sys.argv[2], "w", encoding="utf-8") as stream:
            json.dump(result, stream, allow_nan=False)
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
