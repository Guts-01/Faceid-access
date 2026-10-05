"""OpenFace embedding and local 1:N matching for a visual demo.

The threshold is intentionally conservative but has NOT been calibrated for
this camera or population. Never connect the demo decision to a real lock.
"""
import json
import cv2
import numpy as np

_net = None


def _model(path):
    global _net
    if _net is None:
        _net = cv2.dnn.readNetFromTorch(path)
    return _net


def embed(jpeg_bytes, x, y, w, h, model_path):
    frame = cv2.imdecode(np.frombuffer(bytes(jpeg_bytes), dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError("Imagem inválida")
    height, width = frame.shape[:2]
    margin = int(min(w, h) * 0.12)
    left, top = max(0, x - margin), max(0, y - margin)
    right, bottom = min(width, x + w + margin), min(height, y + h + margin)
    if right - left < 70 or bottom - top < 70:
        raise ValueError("Rosto pequeno ou fora do quadro")
    face = frame[top:bottom, left:right]
    blob = cv2.dnn.blobFromImage(face, 1.0 / 255.0, (96, 96), (0, 0, 0), swapRB=True, crop=False)
    net = _model(model_path)
    net.setInput(blob)
    vector = net.forward().flatten().astype(float)
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm == 0:
        raise ValueError("Falha no modelo facial")
    return json.dumps((vector / norm).tolist(), separators=(",", ":"))


def match(embedding_json, templates_json):
    probe = np.asarray(json.loads(embedding_json), dtype=np.float32)
    templates = json.loads(templates_json)
    if probe.shape != (128,) or not templates:
        return ""
    scores = []
    for person_id, saved in templates.items():
        reference = np.asarray(saved, dtype=np.float32)
        if reference.shape == probe.shape:
            scores.append((float(np.linalg.norm(probe - reference)), person_id))
    if not scores:
        return ""
    scores.sort()
    best_distance, best_id = scores[0]
    second_distance = scores[1][0] if len(scores) > 1 else float("inf")
    # Demo threshold only. A deployment requires population-specific evaluation.
    if best_distance <= 0.55 and second_distance - best_distance >= 0.12:
        return best_id
    return ""
