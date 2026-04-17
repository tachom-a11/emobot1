import React, { forwardRef, useImperativeHandle, useRef, useEffect, useState } from 'react';

const RoutinesTab = forwardRef(function RoutinesTab(
  { ipc, status, addLog },
  ref
) {
  const cancelRef = useRef({ cancel: () => {} });
  const [lastEmotion, setLastEmotion] = useState('无');

  // 寤舵椂宸ュ叿
  const delay = async (ms) => {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      cancelRef.current.cancel = () => clearTimeout(timer);
    });
  };

  // 鏃ュ織
  const log = (text => {
    if (addLog) addLog(text);
  });

  // ====================
  // 纭欢閰嶇疆
  // ====================
  const LEFT_LEG_1 = 1;
  const LEFT_LEG_2 = 2;
  const RIGHT_LEG_1 = 3;
  const RIGHT_LEG_2 = 4;
  const EYE_SERVO = 5;
  const STAND = 0;
  const MOVE_ANGLE = 25;

  // 鐪肩潧鍙樼孩
  const setEyesRed = async () => {
    try {
      await ipc.invoke('jimu:setEyeColor', { eyesMask: 0x03, r: 255, g: 0, b: 0 });
    } catch {}
  };

  // 鐪肩潧鍙樿摑锛堥毦杩囷級
  const setEyesBlue = async () => {
    try {
      await ipc.invoke('jimu:setEyeColor', { eyesMask: 0x03, r: 0, g: 80, b: 180 });
    } catch {}
  };

  // 鐪肩潧寮卞厜锛堝钩闈欙級
  const setEyesGray = async () => {
    try {
      await ipc.invoke('jimu:setEyeColor', { eyesMask: 0x03, r: 70, g: 70, b: 70 });
    } catch {}
  };

  // 鐪肩潧鎭㈠
  const setEyesOriginal = async () => {
    try {
      await ipc.invoke('jimu:setEyeColor', { eyesMask: 0x03, r: 0, g: 0, b: 0 });
    } catch {}
  };

  // ====================
  // 1. 寮€蹇冨姩浣?  // ====================
  const runHappyAction = async () => {
    if (!ipc || status !== 'Connected') {
      log('请先连接机器人');
      return;
    }

    log('开始执行开心情绪动作');
    cancelRef.current.isCancelled = false;

    try {
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: EYE_SERVO, posDeg: 0 });
      await delay(500);

      for (let i = 0; i < 3; i++) {
        if (cancelRef.current.isCancelled) break;

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
      log('开心情绪动作完成');
    } catch (e) {
      log('错误：' + e.message);
    }
  };

  // ====================
  // 2. 闅捐繃鍔ㄤ綔锛坰ad锛?  // ====================
  const runSadAction = async () => {
    if (!ipc || status !== 'Connected') {
      log('请先连接机器人');
      return;
    }

    log('寮€濮嬶細闅捐繃鎯呯华鍔ㄤ綔');
    cancelRef.current.isCancelled = false;

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

      for (let i = 0; i < 3 ; i++) {
        if (cancelRef.current.isCancelled) break;
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
      log('难过情绪动作完成');
    } catch (e) {
      log('错误：' + e.message);
    }
  };

  // ====================
  // 3. 骞抽潤鍔ㄤ綔锛坣eutral锛?  // ====================
  const runNeutralAction = async () => {
    if (!ipc || status !== 'Connected') {
      log('请先连接机器人');
      return;
    }

    log('寮€濮嬶細骞抽潤鎯呯华鍔ㄤ綔');
    cancelRef.current.isCancelled = false;

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
        if (cancelRef.current.isCancelled) break;
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND + 6 });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND + 6 });
        await delay(900);
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
        await delay(900);
      }

      await setEyesOriginal();
      log('平静情绪动作完成');
    } catch (e) {
      log('错误：' + e.message);
    }
  };

  // 澶嶄綅绔欏Э
  const resetStand = async () => {
    try {
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });
    } catch {}
  };

  // ==========================
  // 鏍稿績锛氭儏缁疆璇?  // ==========================
  useEffect(() => {
    let timer;
    let lastTriggerEmotion = '';

    const getEmotion = async () => {
      try {
        const res = await fetch('http://127.0.0.1:5001/emotion');
        const data = await res.json();
        const emotion = data.emotion || '无';

        setLastEmotion(emotion);

        if (emotion !== lastTriggerEmotion) {
          lastTriggerEmotion = emotion;

          cancelRef.current.isCancelled = true;
          cancelRef.current.cancel();
          await delay(100);
          cancelRef.current = { cancel: () => {} };

          if (emotion === 'happy') {
            runHappyAction();
          } else if (emotion === 'sad') {
            runSadAction();
          } else if (emotion === 'neutral') {
            runNeutralAction();
          }
        }
      } catch (err) {}

      timer = setTimeout(getEmotion, 1000);
    };

    getEmotion();
    return () => clearTimeout(timer);
  }, [ipc, status]);

  // 鍋滄
  const stopAction = () => {
    cancelRef.current.isCancelled = true;
    cancelRef.current.cancel();
    resetStand();
    log('已停止当前动作');
  };

  useImperativeHandle(ref, () => ({
    stopIfRunning: stopAction,
    stopAllActions: stopAction,
  }));

 // 单帧画面状态
  const [frameUrl, setFrameUrl] = useState('');
  const [streamStatus, setStreamStatus] = useState('loading'); // loading, active, error
  // 鍒锋柊鐢婚潰
  const refreshFrame = () => {
    setFrameUrl('/current_frame.jpg?time=' + new Date().getTime());
  };

  // 瀹氭湡鍒锋柊鐢婚潰
  useEffect(() => {
    const refreshInterval = setInterval(() => {
      refreshFrame();
    }, 10000); // 10绉掑埛鏂颁竴娆?
    // 鍒濆鍔犺浇
    refreshFrame();

    return () => clearInterval(refreshInterval);
  }, []);

  // 监听画面加载状态
  const handleLoad = () => {
    setStreamStatus('active');
  };

  const handleError = () => {
    setStreamStatus('error');
  };

  // ==========================
  // 椤甸潰娓叉煋锛堢揣鍑戠増锛?  // ==========================
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            padding: 20,
            borderRadius: 2,
            background: 'linear-gradient(180deg, rgba(12, 28, 43, 0.92), rgba(8, 18, 29, 0.9))',
            border: '1px solid rgba(120, 183, 255, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#e8f4ff', letterSpacing: '0.08em' }}>
            情绪识别控制台
          </h3>

          <div
            style={{
              width: '100%',
              padding: '14px 16px',
              borderRadius: 2,
              background: status === 'Connected' ? 'rgba(12, 48, 36, 0.9)' : 'rgba(58, 16, 24, 0.9)',
              border: '1px solid ' + (status === 'Connected' ? 'rgba(93, 214, 196, 0.35)' : 'rgba(255, 108, 122, 0.35)'),
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <span style={{ fontSize: 14, color: '#d8ecff' }}>{status === 'Connected' ? '已连接' : '未连接'}</span>
            <div>
              <div style={{ fontWeight: 600, color: status === 'Connected' ? '#5dd6c4' : '#ff6c7a', fontSize: 14 }}>
                {status === 'Connected' ? '机器人已连接' : '机器人未连接'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#d8ecff', marginTop: 2 }}>
                当前识别情绪：{lastEmotion}
              </div>
            </div>
          </div>

          <div
            style={{
              width: '100%',
              maxWidth: '360px',
              minHeight: '220px',
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 2,
              border: '1px solid rgba(120, 183, 255, 0.22)',
              boxShadow: '0 14px 32px rgba(0,0,0,0.28)',
              background: 'linear-gradient(180deg, rgba(10, 24, 39, 0.96), rgba(7, 18, 29, 0.94))',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <img
              src={frameUrl}
              onLoad={handleLoad}
              onError={handleError}
              crossOrigin="anonymous"
              style={{ width: '100%', height: 'auto', display: streamStatus === 'active' ? 'block' : 'none' }}
            />

            {streamStatus !== 'active' && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  background: streamStatus === 'error' ? 'rgba(34, 11, 19, 0.86)' : 'rgba(7, 19, 31, 0.82)',
                  color: '#8ba9c8',
                  gap: 10,
                }}
              >
                <div>{streamStatus === 'error' ? '画面加载失败' : '正在加载摄像头画面...'}</div>
                {streamStatus === 'error' && (
                  <button
                    onClick={refreshFrame}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#2f86e9',
                      color: '#e8f4ff',
                      border: '1px solid rgba(120, 183, 255, 0.3)',
                      borderRadius: 2,
                      fontSize: 12,
                    }}
                  >
                    刷新画面
                  </button>
                )}
              </div>
            )}

            <div
              style={{
                position: 'absolute',
                left: 8,
                bottom: 8,
                backgroundColor: 'rgba(7,19,31,0.84)',
                color: '#d8ecff',
                padding: '2px 8px',
                borderRadius: 2,
                border: '1px solid rgba(120, 183, 255, 0.22)',
                fontSize: 11,
              }}
            >
              画面状态：{streamStatus === 'active' ? '正常' : streamStatus === 'loading' ? '加载中' : '失败'}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, width: '100%', maxWidth: '360px' }}>
            <button
              onClick={() => runHappyAction()}
              style={{ background: 'linear-gradient(135deg, #1e9f80, #116b56)', border: '1px solid rgba(93, 214, 196, 0.35)', color: '#fff', borderRadius: 2, minHeight: 46 }}
            >
              开心
            </button>
            <button
              onClick={() => runSadAction()}
              style={{ background: 'linear-gradient(135deg, #2f86e9, #115ca8)', border: '1px solid rgba(120, 183, 255, 0.35)', color: '#fff', borderRadius: 2, minHeight: 46 }}
            >
              难过
            </button>
            <button
              onClick={() => runNeutralAction()}
              style={{ background: 'linear-gradient(135deg, #4f647b, #314355)', border: '1px solid rgba(139, 169, 200, 0.35)', color: '#fff', borderRadius: 2, minHeight: 46 }}
            >
              平静
            </button>
            <button
              onClick={stopAction}
              style={{ background: 'linear-gradient(135deg, #ef4444, #b91c1c)', border: '1px solid rgba(255, 108, 122, 0.35)', color: '#fff', borderRadius: 2, minHeight: 46 }}
            >
              停止动作
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

export default RoutinesTab;
