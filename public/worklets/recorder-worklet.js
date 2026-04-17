class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      this.buffer.push(new Float32Array(input[0]));

      // 每次都发送音频帧给主线程
      this.port.postMessage(input[0]);
    }

    return true;
  }
}

registerProcessor('recorder.worklet', RecorderProcessor);