import { KokoroTTS, env } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts = null;
let runtimeKey = "";

function configureRuntime() {
  try {
    env.useBrowserCache = true;
    env.useWasmCache = true;
    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.proxy = false;
      env.backends.onnx.wasm.numThreads = 1;
    }
  } catch {
    // Some CDN builds expose a smaller env surface. Kokoro still works without these flags.
  }
}

function progressToPayload(progress) {
  if (!progress) return { percent: 5, label: "Loading Kokoro..." };
  if (progress.status === "progress" && Number.isFinite(progress.progress)) {
    return {
      percent: progress.progress,
      label: `Downloading ${progress.file || "model"}`,
    };
  }
  if (progress.status === "ready") return { percent: 100, label: "Kokoro Ready" };
  if (progress.file) return { percent: 15, label: `Loading ${progress.file}` };
  return { percent: 10, label: "Loading Kokoro..." };
}

async function loadModel(id, payload) {
  const key = payload.runtimeKey;
  if (tts && runtimeKey === key) {
    postMessage({ id, type: "ready", payload: readyPayload() });
    return;
  }

  configureRuntime();
  tts = await KokoroTTS.from_pretrained(MODEL_ID, {
    device: payload.device,
    dtype: payload.dtype,
    progress_callback: (progress) => {
      postMessage({ id, type: "progress", payload: progressToPayload(progress) });
    },
  });
  runtimeKey = key;
  postMessage({ id, type: "ready", payload: readyPayload() });
}

function readyPayload() {
  return {
    runtimeKey,
    voices: Object.entries(tts.voices || {}),
  };
}

async function generateAudio(id, payload) {
  if (!tts) throw new Error("Kokoro model is not loaded");
  postMessage({ id, type: "progress", payload: { percent: 10, label: "Worker received generate request..." } });
  postMessage({ id, type: "progress", payload: { percent: 20, label: "Running Kokoro inference..." } });
  const audio = await tts.generate(payload.text, {
    voice: payload.voice,
    speed: payload.speed,
  });
  postMessage({ id, type: "progress", payload: { percent: 80, label: "Inference finished. Encoding WAV..." } });
  const audioBuffer = audio.toWav();
  postMessage({ id, type: "progress", payload: { percent: 98, label: "WAV ready. Starting playback..." } });
  postMessage({ id, type: "audio", payload: { audioBuffer } }, [audioBuffer]);
}

self.onmessage = async (event) => {
  const { id, action, payload } = event.data || {};
  try {
    if (action === "load") {
      await loadModel(id, payload);
      return;
    }
    if (action === "generate") {
      await generateAudio(id, payload);
      return;
    }
    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    postMessage({
      id,
      type: "error",
      payload: { message: error?.message || "Kokoro worker failed" },
    });
  }
};
