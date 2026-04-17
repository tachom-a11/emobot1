import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  useEffect
} from 'react';

const VoiceRecognitionTab = forwardRef(function VoiceRecognitionTab(
  { ipc, addLog },
  ref
) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('等待语音输入...');

  const audioCtxRef = useRef(null);
  const workletNodeRef = useRef(null);
  const streamRef = useRef(null);

  const audioBufferRef = useRef([]);
  const silenceRef = useRef(0);
  const silenceTimerRef = useRef(null);

  const log = (t) => addLog?.(t);

  // ===================== 硬件配置 =====================
  const LEFT_LEG_1 = 1;
  const LEFT_LEG_2 = 2;
  const RIGHT_LEG_1 = 3;
  const RIGHT_LEG_2 = 4;
  const EYE_SERVO = 5;

  const STAND = 0;
  const MOVE_ANGLE = 25;
  const DELAY_EMO = 180;

  const WALK_ANGLE = 25;
  const DELAY_WALK = 280;

  // ===================== 辅助函数 =====================
  const delay = (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    });

  const resetStand = async () => {
    try {
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });
    } catch {}
  };

  // 眼睛颜色控制
  const setEyesRed = async () => {
    try {
      await ipc.invoke('jimu:setEyeColor', { eyesMask: 0x03, r: 255, g: 0, b: 0 });
    } catch {}
  };

  // 眼睛变蓝（难过）
  const setEyesBlue = async () => {
    try {
      await ipc.invoke('jimu:setEyeColor', { eyesMask: 0x03, r: 0, g: 80, b: 180 });
    } catch {}
  };

  // 眼睛弱光（平静）
  const setEyesGray = async () => {
    try {
      await ipc.invoke('jimu:setEyeColor', { eyesMask: 0x03, r: 70, g: 70, b: 70 });
    } catch {}
  };

  // 眼睛恢复
  const setEyesOriginal = async () => {
    try {
      await ipc.invoke('jimu:setEyeColor', { eyesMask: 0x03, r: 0, g: 0, b: 0 });
    } catch {}
  };

  // ===================== 情绪动作 =====================
  const moveHappy = async () => {
    if (!ipc) {
      log('请先连接机器人');
      return;
    }

    log('开始：开心情绪动作');
    try {
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 0 });
      await delay(500);

      for (let i = 0; i < 3; i++) {
        await setEyesRed();
        await delay(50);

        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND + MOVE_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND + MOVE_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND + MOVE_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND + MOVE_ANGLE });
        await delay(500);

        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND - MOVE_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND - MOVE_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND - MOVE_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND - MOVE_ANGLE });
        await delay(500);

        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });

        await setEyesOriginal();
        await delay(80);

        await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 35 });
        await delay(200);
        await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 0 });
        await delay(100);
      }

      await setEyesOriginal();
      log('✅ 开心动作完成');
    } catch (e) {
      log('错误：' + e.message);
    }
  };

  const moveSad = async () => {
    if (!ipc) {
      log('请先连接机器人');
      return;
    }

    log('开始：难过情绪动作');
    try {
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 0 });
      await delay(300);

      await setEyesBlue();
      await delay(300);

      await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 25 });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND + 22 });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND + 22 });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND + 22 });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND + 22 });
      await delay(1400);

      for (let i = 0; i < 2 ; i++) {
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND + 32 });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND + 32 });
        await delay(700);
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND + 10 });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND + 32 });
        await delay(700);

        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND + 22 });
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND + 22 });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND + 22 });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND + 22 });
        await delay(600);
      }
      
      await delay(600);

      await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 0 });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });

      await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 0 });
      await setEyesOriginal();
      log('✅ 难过动作完成');
    } catch (e) {
      log('错误：' + e.message);
    }
  };

  const moveNeutral = async () => {
    if (!ipc) {
      log('请先连接机器人');
      return;
    }

    log('开始：平静情绪动作');
    try {
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 0 });
      await delay(300);

      await setEyesGray();
      await delay(400);

      for (let i = 0; i < 4; i++) {
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND + 6 });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND + 6 });
        await delay(900);
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
        await delay(900);
      }

      await setEyesOriginal();
      log('✅ 平静动作完成');
    } catch (e) {
      log('错误：' + e.message);
    }
  };

  // ===================== 行走动作 =====================
  const moveForward = async () => {
    log("⬆️ 执行：前进");
    try {
      for (let i = 0; i < 3; i++) {
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: WALK_ANGLE });
        await delay(DELAY_WALK);

        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: -WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: -WALK_ANGLE });
        await delay(DELAY_WALK);
      }
      await resetStand();
    } catch {}
  };

  const moveBackward = async () => {
    log("⬇️ 执行：后退");
    try {
      for (let i = 0; i < 3; i++) {
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: -WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: -WALK_ANGLE });
        await delay(DELAY_WALK);

        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: WALK_ANGLE });
        await delay(DELAY_WALK);
      }
      await resetStand();
    } catch {}
  };

  const moveLeft = async () => {
    log("⬅️ 执行：左转");
    try {
      for (let i = 0; i < 3; i++) {
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: -WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: WALK_ANGLE });
        await delay(DELAY_WALK);

        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: -WALK_ANGLE });
        await delay(DELAY_WALK);
      }
      await resetStand();
    } catch {}
  };

  const moveRight = async () => {
    log("➡️ 执行：右转");
    try {
      for (let i = 0; i < 3; i++) {
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: -WALK_ANGLE });
        await delay(DELAY_WALK);

        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: -WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: WALK_ANGLE });
        await delay(DELAY_WALK);
      }
      await resetStand();
    } catch {}
  };

  const stopRobot = async () => {
    log("⏹️ 执行：停止");
    await resetStand();
  };

  // ===================== PCM转换 =====================
  const floatToPCM16 = (input) => {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);

    for (let i = 0; i < input.length; i++) {
      let s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return buffer;
  };

  const toBase64 = (buffer) => {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  // ===================== VAD（静音检测） =====================
  const isSilent = (buffer) => {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += Math.abs(buffer[i]);
    }
    return sum / buffer.length < 0.01;
  };

  // ===================== 本地规则处理 =====================
  const handleLocalIntent = (text) => {
    // 本地规则优先（0延迟）
    if (text.includes("前进") || text.includes("向前")) {
      setTranscript("好的，前进");
      moveForward();
      return true;
    }
    if (text.includes("后退") || text.includes("向后")) {
      setTranscript("好的，后退");
      moveBackward();
      return true;
    }
    if (text.includes("左转") || text.includes("向左")) {
      setTranscript("好的，左转");
      moveLeft();
      return true;
    }
    if (text.includes("右转") || text.includes("向右")) {
      setTranscript("好的，右转");
      moveRight();
      return true;
    }
    if (text.includes("停止") || text.includes("停下") || text.includes("停")) {
      setTranscript("好的，停止");
      stopRobot();
      return true;
    }
    if (text.includes("开心") || text.includes("高兴") || text.includes("快乐")) {
      setTranscript("好的，我很开心");
      moveHappy();
      return true;
    }
    if (text.includes("难过") || text.includes("伤心") || text.includes("悲伤")) {
      setTranscript("好的，我有点难过");
      moveSad();
      return true;
    }
    if (text.includes("平静") || text.includes("淡定") || text.includes("正常")) {
      setTranscript("好的，我很平静");
      moveNeutral();
      return true;
    }
    return false;
  };

  // ===================== 发送百度 =====================
  const sendToASR = async (audioFloat32) => {
    const pcm = floatToPCM16(audioFloat32);
    const base64 = toBase64(pcm);

    try {
      const res = await ipc.invoke('baidu:asr', { base64 });

      if (res?.result?.length) {
        const text = res.result[0];
        log("🧠 识别：" + text);
        
        // 本地规则优先处理
        if (handleLocalIntent(text)) {
          return;
        }
        
        // 复杂语义 → LLM
        log("🤖 复杂语义，调用LLM");
        const llmResult = await ipc.invoke('llm:parse', text);
        
        const msg = llmResult?.choices?.[0]?.message?.content;
        
        if (!msg) return;
        
        let data;
        try {
          data = JSON.parse(msg);
        } catch (e) {
          console.log("LLM返回不是JSON:", msg);
          return;
        }
        
        setTranscript(data.reply);
        
        // 执行动作
        switch (data.action) {
          case "happy":
            moveHappy();
            break;
          case "sad":
            moveSad();
            break;
          case "neutral":
            moveNeutral();
            break;
          case "forward":
            moveForward();
            break;
          case "backward":
            moveBackward();
            break;
          case "left":
            moveLeft();
            break;
          case "right":
            moveRight();
            break;
          case "stop":
            stopRobot();
            break;
        }
      }
    } catch (e) {
      console.error("ASR失败", e);
    }
  };

  // ===================== 启动录音 =====================
  const startListen = async () => {
    if (isListening) return;

    setIsListening(true);
    setTranscript("🎙️ 监听中...");

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const audioCtx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = audioCtx;

    await audioCtx.audioWorklet.addModule('/worklets/recorder-worklet.js');

    const source = audioCtx.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(audioCtx, 'recorder.worklet');

    let isSpeaking = false;

    worklet.port.onmessage = (e) => {
      const data = e.data;

      // 计算音量
      const volume = Math.max(...data.map(v => Math.abs(v)));

      // 累积音频数据
      audioBufferRef.current.push(new Float32Array(data));

      // ===== 静音检测 =====
      if (volume > 0.02) {
        // 检测到说话
        isSpeaking = true;
        // 清除之前的静音计时器
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      } else {
        // 静音状态
        if (isSpeaking && !silenceTimerRef.current) {
          // 开始计时，1.2秒后认为一句话结束
          silenceTimerRef.current = setTimeout(async () => {
            if (!isSpeaking) return;

            isSpeaking = false;
            console.log("🧠 语音结束，开始识别");

            // 合并并发送完整音频
            if (audioBufferRef.current.length > 0) {
              const merged = new Float32Array(
                audioBufferRef.current.reduce((a, b) => a + b.length, 0)
              );

              let offset = 0;
              audioBufferRef.current.forEach((b) => {
                merged.set(b, offset);
                offset += b.length;
              });

              // 清空缓冲区
              audioBufferRef.current = [];

              // 发送到ASR
              await sendToASR(merged);
            }
          }, 1200);
        }
      }
    };

    source.connect(worklet);
    workletNodeRef.current = worklet;
    
    setTranscript('语音识别已启动，等待输入...');
    addLog?.('语音识别已启动');
  };

  // ===================== 停止 =====================
  const stopListen = () => {
    setIsListening(false);

    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current?.close();

    audioBufferRef.current = [];
    silenceRef.current = 0;

    // 清除可能存在的静音计时器
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    setTranscript('等待语音输入...');
    addLog?.('语音识别已停止');
  };

  useImperativeHandle(ref, () => ({
    stopIfRunning: stopListen,
  }));

  // ===================== UI =====================
  return (
    <div
      style={{
        padding: 20,
        background: 'linear-gradient(180deg, rgba(12, 28, 43, 0.92), rgba(8, 18, 29, 0.9))',
        border: '1px solid rgba(120, 183, 255, 0.18)',
        color: '#e8f4ff',
        display: 'grid',
        gap: 18,
      }}
    >
      <h3 style={{ margin: 0, color: '#e8f4ff', letterSpacing: '0.08em' }}>语音识别面板</h3>

     

      <button
        onClick={() => (isListening ? stopListen() : startListen())}
        style={{
          width: 180,
          height: 80,
          borderRadius: '2px',
          fontSize: 18,
          background: isListening ? 'linear-gradient(180deg, #ef4444, #b91c1c)' : 'linear-gradient(180deg, #2f86e9, #115ca8)',
          color: '#fff',
          border: isListening ? '1px solid rgba(255, 108, 122, 0.35)' : '1px solid rgba(120, 183, 255, 0.3)',
        }}
      >
        {isListening ? '停止识别' : '开始识别'}
      </button>

      <div style={{ display: 'grid', gap: 8 }}>
        <h4 style={{ margin: 0, color: '#d8ecff' }}>识别结果</h4>
        <div
          style={{
            minHeight: 64,
            padding: '12px 14px',
            border: '1px solid rgba(120, 183, 255, 0.18)',
            background: 'rgba(7, 19, 31, 0.84)',
            color: '#8ba9c8',
          }}
        >
          {transcript}
        </div>
      </div>
    </div>
  );
});

export default VoiceRecognitionTab;