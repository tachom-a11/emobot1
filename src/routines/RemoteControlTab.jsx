import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';

const RemoteControlTab = forwardRef(function RemoteControlTab(
  { ipc, status, addLog },
  ref
) {
  const cancelRef = useRef({ isCancelled: false });

  // 延时工具
  const delay = async (ms) => {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      cancelRef.current.cancel = () => clearTimeout(timer);
    });
  };

  // 日志
  const log = (text) => {
    if (addLog) addLog(text);
  };

  // 硬件配置
  const LEFT_LEG_1 = 1;
  const LEFT_LEG_2 = 2;
  const RIGHT_LEG_1 = 3;
  const RIGHT_LEG_2 = 4;
  const STAND = 0;
  const WALK_ANGLE = 25;       // 走路幅度（增大以提高准确性）
  const WALK_DELAY = 250;      // 走路速度（减慢以提高稳定性）

  // 停止当前动作
  const stopAction = () => {
    cancelRef.current.isCancelled = true;
  };

  // 重置站立姿势
  const resetStand = async () => {
    try {
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_2, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: STAND });
      await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_2, posDeg: STAND });
    } catch {}
  };

  // 前进
  const moveForward = async () => {
    if (!ipc || status !== 'Connected') {
      log('请先连接机器人');
      return;
    }

    stopAction();
    log('⬆️ 机器人前进');
    cancelRef.current.isCancelled = false;

    try {
      for (let i = 0; i < 3; i++) {
        if (cancelRef.current.isCancelled) break;
        
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: WALK_ANGLE });
        await delay(WALK_DELAY);
        
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: -WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: -WALK_ANGLE });
        await delay(WALK_DELAY);
      }
      await resetStand();
    } catch (e) {
      log(`前进失败: ${e?.message || String(e)}`);
    }
  };

  // 后退
  const moveBackward = async () => {
    if (!ipc || status !== 'Connected') {
      log('请先连接机器人');
      return;
    }

    stopAction();
    log('⬇️ 机器人后退');
    cancelRef.current.isCancelled = false;

    try {
      for (let i = 0; i < 3; i++) {
        if (cancelRef.current.isCancelled) break;
        
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: -WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: -WALK_ANGLE });
        await delay(WALK_DELAY);
        
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: WALK_ANGLE });
        await delay(WALK_DELAY);
      }
      await resetStand();
    } catch (e) {
      log(`后退失败: ${e?.message || String(e)}`);
    }
  };

  // 左走
  const moveLeft = async () => {
    if (!ipc || status !== 'Connected') {
      log('请先连接机器人');
      return;
    }

    stopAction();
    log('⬅️ 机器人左走');
    cancelRef.current.isCancelled = false;

    try {
      for (let i = 0; i < 3; i++) {
        if (cancelRef.current.isCancelled) break;
        
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: -WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: WALK_ANGLE });
        await delay(WALK_DELAY);
        
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: -WALK_ANGLE });
        await delay(WALK_DELAY);
      }
      await resetStand();
    } catch (e) {
      log(`左走失败: ${e?.message || String(e)}`);
    }
  };

  // 右走
  const moveRight = async () => {
    if (!ipc || status !== 'Connected') {
      log('请先连接机器人');
      return;
    }

    stopAction();
    log('➡️ 机器人右走');
    cancelRef.current.isCancelled = false;

    try {
      for (let i = 0; i < 3; i++) {
        if (cancelRef.current.isCancelled) break;
        
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: -WALK_ANGLE });
        await delay(WALK_DELAY);
        
        await ipc.invoke('jimu:setServoPos', { id: LEFT_LEG_1, posDeg: -WALK_ANGLE });
        await ipc.invoke('jimu:setServoPos', { id: RIGHT_LEG_1, posDeg: WALK_ANGLE });
        await delay(WALK_DELAY);
      }
      await resetStand();
    } catch (e) {
      log(`右走失败: ${e?.message || String(e)}`);
    }
  };

  // 停止
  const stop = async () => {
    stopAction();
    log('⏹️ 机器人停止');
    try {
      await resetStand();
    } catch {}
  };

  // 键盘事件处理
  useEffect(() => {
    const handleKeyDown = (event) => {
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          moveForward();
          break;
        case 'ArrowDown':
          event.preventDefault();
          moveBackward();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          moveLeft();
          break;
        case 'ArrowRight':
          event.preventDefault();
          moveRight();
          break;
        case 'Escape':
          event.preventDefault();
          stop();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [ipc, status]);

  // 暴露给父组件的方法
  useImperativeHandle(ref, () => ({
    stopIfRunning: stop,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* ============================== */}
        {/* 🎮 机器人遥控器 */}
        {/* ============================== */}
        <div style={{
          padding: '32px',
          borderRadius: 2,
          background: 'linear-gradient(180deg, rgba(10, 24, 39, 0.96), rgba(7, 18, 29, 0.94))',
          border: '1px solid rgba(120, 183, 255, 0.22)',
          boxShadow: '0 14px 32px rgba(0,0,0,0.28)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center'
        }}>
          <h3 style={{ margin: '0 0 28px 0', fontSize: 20, fontWeight: 700, color: '#e8f4ff', letterSpacing: '0.08em' }}>
            🎮 机器人遥控器
          </h3>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            position: 'relative'
          }}>
            {/* 前进 */}
            <button onClick={moveForward}
              style={{
                width: 100,
                height: 70,
                borderRadius: 2,
                background: 'linear-gradient(180deg, rgba(47, 134, 233, 0.95), rgba(17, 92, 168, 0.95))',
                color: '#fff',
                border: '1px solid rgba(120, 183, 255, 0.35)',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 10px 22px rgba(10, 40, 80, 0.34)'
              }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 10px 25px rgba(14,165,233,0.35)'}
              onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 6px 15px rgba(14,165,233,0.25)'}>
              ⬆️ 前进
            </button>

            {/* 左右 */}
            <div style={{ display: 'flex', gap: 16 }}>
              <button onClick={moveLeft}
                style={{
                  width: 100,
                  height: 70,
                  borderRadius: 2,
                  background: 'linear-gradient(90deg, rgba(38, 167, 220, 0.95), rgba(19, 95, 140, 0.95))',
                  color: '#fff',
                  border: '1px solid rgba(120, 183, 255, 0.35)',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 10px 22px rgba(10, 40, 80, 0.34)'
                }}
                onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
                onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 10px 25px rgba(34,211,238,0.35)'}
                onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 6px 15px rgba(34,211,238,0.25)'}>
                ⬅️ 左走
              </button>

              <button onClick={moveRight}
                style={{
                  width: 100,
                  height: 70,
                  borderRadius: 2,
                  background: 'linear-gradient(90deg, rgba(38, 167, 220, 0.95), rgba(19, 95, 140, 0.95))',
                  color: '#fff',
                  border: '1px solid rgba(120, 183, 255, 0.35)',
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 10px 22px rgba(10, 40, 80, 0.34)'
                }}
                onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
                onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 10px 25px rgba(34,211,238,0.35)'}
                onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 6px 15px rgba(34,211,238,0.25)'}>
                ➡️ 右走
              </button>
            </div>

            {/* 后退 */}
            <button onClick={moveBackward}
              style={{
                width: 100,
                height: 70,
                borderRadius: 2,
                background: 'linear-gradient(0deg, rgba(47, 134, 233, 0.95), rgba(17, 92, 168, 0.95))',
                color: '#fff',
                border: '1px solid rgba(120, 183, 255, 0.35)',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 10px 22px rgba(10, 40, 80, 0.34)'
              }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.93)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 10px 25px rgba(14,165,233,0.35)'}
              onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 6px 15px rgba(14,165,233,0.25)'}>
              ⬇️ 后退
            </button>
          </div>

          {/* 停止按钮 */}
          <div style={{ marginTop: 32, width: '100%', display: 'flex', justifyContent: 'center' }}>
            <button onClick={stop}
              style={{
                padding: '12px 32px',
                borderRadius: 2,
                background: 'linear-gradient(180deg, #ef4444, #b91c1c)',
                color: '#fff',
                border: '1px solid rgba(255, 108, 122, 0.35)',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 12px rgba(239,68,68,0.25)'
              }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
              onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 6px 20px rgba(239,68,68,0.4)'}
              onMouseLeave={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(239,68,68,0.25)'}>
              ⏹️ 停止
            </button>
          </div>
        </div>

        {/* 操作说明 */}
        <div style={{
          padding: '20px',
          borderRadius: 2,
          background: 'linear-gradient(180deg, rgba(12, 28, 43, 0.92), rgba(8, 18, 29, 0.9))',
          border: '1px solid rgba(120, 183, 255, 0.18)'
        }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 16, fontWeight: 600, color: '#d8ecff' }}>
            📝 操作说明
          </h4>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#8ba9c8' }}>
            <li>点击方向按钮控制机器人移动</li>
            <li>使用键盘方向键控制机器人：↑ 前进，↓ 后退，← 左走，→ 右走</li>
            <li>按 ESC 键停止当前动作</li>
            <li>每次操作会执行一组动作</li>
            <li>确保机器人有足够的活动空间</li>
            <li>操作前请确保已连接机器人</li>
          </ul>
        </div>
      </div>
    </div>
  );
});

export default RemoteControlTab;
