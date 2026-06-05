import { DEFAULT_KOKORO_VOICE, MODEL_READY_KEY, WORKER_TIMEOUT_MS } from "./constants.js";

let worker = null;
let workerReadyKey = "";
let requestId = 0;
let activeRequest = null;
const WORKER_VERSION = "20260605-tts-debug-2";

export function getRuntimeOptions(state) {
  const requestedDevice = state.kokoroDevice || "auto";
  const device = requestedDevice === "auto" ? (isIOS() ? "wasm" : navigator.gpu ? "webgpu" : "wasm") : requestedDevice;
  const requestedDtype = state.kokoroDtype || "auto";
  const dtype = requestedDtype === "auto" ? (device === "webgpu" ? "fp32" : "q8") : requestedDtype;
  return { device, dtype };
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function runtimeKey(state) {
  const { device, dtype } = getRuntimeOptions(state);
  return `${device}:${dtype}`;
}

export function resetKokoroWorker() {
  if (worker) worker.terminate();
  worker = null;
  workerReadyKey = "";
  rejectActiveRequest(new Error("Worker reset"));
}

export function isKokoroReady(state) {
  return worker && workerReadyKey === runtimeKey(state);
}

export async function loadKokoro(state, callbacks = {}) {
  const key = runtimeKey(state);
  if (isKokoroReady(state)) return;
  const options = getRuntimeOptions(state);
  const result = await requestWorker(
    "load",
    { ...options, runtimeKey: key },
    callbacks,
    180000,
  );
  workerReadyKey = result.runtimeKey;
  localStorage.setItem(MODEL_READY_KEY, "1");
  return result;
}

export async function generateKokoroAudio(state, text, callbacks = {}, speed = Number(state.rate) || 1) {
  await loadKokoro(state, callbacks);
  const { device } = getRuntimeOptions(state);
  return requestWorker(
    "generate",
    {
      text,
      voice: state.kokoroVoice || DEFAULT_KOKORO_VOICE,
      speed,
    },
    callbacks,
    device === "webgpu" ? 180000 : WORKER_TIMEOUT_MS,
  );
}

function ensureWorker(callbacks) {
  if (worker) return;
  worker = new Worker(`./kokoro-worker.js?v=${WORKER_VERSION}`, { type: "module" });
  worker.onmessage = (event) => handleWorkerMessage(event, callbacks);
  worker.onerror = (event) => {
    console.error(event);
    rejectActiveRequest(new Error("Kokoro worker error"));
  };
}

function requestWorker(action, payload, callbacks, timeoutMs) {
  ensureWorker(callbacks);
  const id = ++requestId;
  rejectActiveRequest(new Error("Superseded by a newer request"));

  return new Promise((resolve, reject) => {
    callbacks?.onProgress?.({
      percent: action === "generate" ? 5 : 2,
      label: action === "generate" ? "Sending text to Kokoro worker..." : "Starting Kokoro worker...",
    });
    const timer = window.setTimeout(() => {
      if (activeRequest?.id !== id) return;
      activeRequest = null;
      resetKokoroWorker();
      reject(new Error(`${action} timed out`));
    }, timeoutMs);

    activeRequest = { id, resolve, reject, timer, callbacks };
    worker.postMessage({ id, action, payload });
  });
}

function handleWorkerMessage(event) {
  const { id, type, payload } = event.data || {};
  if (type === "progress") {
    activeRequest?.callbacks?.onProgress?.(payload);
    return;
  }
  if (type === "ready") {
    resolveActiveRequest(id, payload);
    return;
  }
  if (type === "audio") {
    resolveActiveRequest(id, payload);
    return;
  }
  if (type === "error") {
    rejectActiveRequest(new Error(payload?.message || "Kokoro failed"));
  }
}

function resolveActiveRequest(id, value) {
  if (!activeRequest || activeRequest.id !== id) return;
  window.clearTimeout(activeRequest.timer);
  activeRequest.resolve(value);
  activeRequest = null;
}

function rejectActiveRequest(error) {
  if (!activeRequest) return;
  window.clearTimeout(activeRequest.timer);
  activeRequest.reject(error);
  activeRequest = null;
}
