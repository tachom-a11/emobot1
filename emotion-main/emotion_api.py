from flask import Flask, jsonify, request, Response
from flask_cors import CORS  # 跨域核心！
import threading
import time
import json
from collections import deque, Counter
from queue import Queue

app = Flask(__name__)
CORS(app, supports_credentials=True)  # 全局开启跨域！！！

result_queue = deque()
queue_lock = threading.Lock()

sse_clients = []

# ==========================
# 接收情绪
# ==========================
@app.route('/push', methods=['POST'])
def push_result():
    data = request.get_json()
    emo = data.get("emotion")
    mic = data.get("micro")
    ts = time.time()

    with queue_lock:
        result_queue.append((ts, emo, mic))
        while result_queue and ts - result_queue[0][0] > 20:
            result_queue.popleft()
    
    return jsonify({"status": "ok"})

# ==========================
# SSE 推送（支持跨域 + 稳定）
# ==========================
@app.route('/events')
def sse_events():
    def event_stream():
        client_queue = Queue()
        sse_clients.append(client_queue)

        # 刚连接就推一次当前状态
        current = get_most_frequent_result()
        client_queue.put(current)

        try:
            while True:
                data = client_queue.get()
                yield f"data: {json.dumps(data)}\n\n"
        except:
            sse_clients.remove(client_queue)
    
    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*"
        }
    )

# ==========================
# 定时推送（不管变不变都推，保证前端收到）
# ==========================
def sse_push_task():
    while True:
        try:
            res = get_most_frequent_result()
            for client in sse_clients:
                client.put(res)
            time.sleep(1)
        except:
            time.sleep(1)

# ==========================
# 统计情绪
# ==========================
def get_most_frequent_result():
    if not result_queue:
        return {"emotion": "无", "micro_expression": None}
    
    with queue_lock:
        emotions = [item[1] for item in result_queue]
        micro_exps = [item[2] for item in result_queue]

    most_emotion = Counter(emotions).most_common(1)[0][0] if emotions else "无"
    most_micro = Counter(micro_exps).most_common(1)[0][0] if micro_exps else None
    return {"emotion": most_emotion, "micro_expression": most_micro}

# ==========================
# GET 接口
# ==========================
@app.route('/emotion', methods=['GET'])
def get_emotion():
    return jsonify(get_most_frequent_result())

# ==========================
# 启动
# ==========================
if __name__ == '__main__':
    threading.Thread(target=sse_push_task, daemon=True).start()
    app.run(host='0.0.0.0', port=5001, debug=True)