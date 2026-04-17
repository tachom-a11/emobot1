import time
import cv2
import numpy as np
import threading
import requests  # 新增

# ======================
# 去掉这行！
# from emotion_api import result_queue
# ======================

from .config import build_arg_parser, config_from_args
from .detector import FaceDetector
from .emotion import EmotionRecognizer
from .logging_utils import setup_logger
from .micro_expression import ema, micro_expression_level, micro_expression_score
from .model_store import ensure_face_model
from .renderer import Renderer
from .schema import EmotionResult, FaceInference
from .tracker import FaceTracker

INFER_EVERY_N = 3

def main():
    args = build_arg_parser().parse_args()
    cfg = config_from_args(args)
    log = setup_logger()
    ensure_face_model(cfg.model_path, log)

    detector = FaceDetector(cfg, logger=log)
    recognizer = EmotionRecognizer()
    tracker = FaceTracker(cfg.max_track_distance)
    renderer = Renderer(cfg)

    cap = cv2.VideoCapture(cfg.camera_id, cv2.CAP_DSHOW)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    prev_gray = None
    t_prev = time.time()
    n = 0
    mu_hist = {}
    emo_cache = {}

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        n += 1
        frame = cv2.flip(frame, 1)
        cur_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        boxes = detector.detect(frame)
        tracks = tracker.assign(boxes)
        alive = tracker.alive_ids

        results = []
        frame_results = []

        for fid, box in tracks:
            bgr_patch = frame[box.y1:box.y2, box.x1:box.x2]
            gray_patch = cur_gray[box.y1:box.y2, box.x1:box.x2]
            prev_patch = prev_gray[box.y1:box.y2, box.x1:box.x2] if prev_gray is not None else None

            if n % INFER_EVERY_N == 0 or fid not in emo_cache:
                r = recognizer.predict(bgr_patch, track_id=fid)
                emo_cache[fid] = (r.label, r.score)

            lbl, sc = emo_cache[fid]
            raw = micro_expression_score(gray_patch, prev_patch)
            smth = ema(raw, mu_hist.get(fid), cfg.micro_ema_alpha)
            mu_hist[fid] = smth
            mic_level = micro_expression_level(smth)

            inf = FaceInference(
                track_id=fid, box=box,
                emotion=EmotionResult(label=lbl, score=sc),
                micro_score=smth, micro_level=mic_level,
            )
            results.append(inf)
            frame_results.append((lbl, mic_level))

        # ======================
        # 【关键】推送给 API
        # ======================
        if frame_results:
            emo, mic = frame_results[0]
            try:
                requests.post(
                    "http://127.0.0.1:5001/push",
                    json={"emotion": emo, "micro": mic},
                    timeout=1
                )
            except:
                pass

        now = time.time()
        fps = 1.0 / max(now - t_prev, 1e-9)
        t_prev = now
        renderer.draw(frame, results, fps)
        cv2.imshow(cfg.window_name, frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

        prev_gray = cur_gray

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main()