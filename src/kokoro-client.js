import { DEFAULT_KOKORO_VOICE, MODEL_READY_KEY, WORKER_TIMEOUT_MS } from "./constants.js";

let worker = null;
let workerReadyKey = "";
let requestId = 0;
let activeRequest = null;

export function getRuntimeOptions(state) {
  const requestedDevice = state.kokoroDevice || "auto";
  const device = requestedDevice === "auto" ? (navigator.gpu ? "webgpu" : "wasm") : requestedDevice;
  const requestedDtype = state.kokoroDtype || "auto";
  const dtype = requestedDtype === "auto" ? (device === "webgpu" ? "fp32" : "q8") : requestedDtype;
  return { device, dtype };
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

export async function generateKokoroAudio(state, text, callbacks = {}) {
  await loadKokoro(state, callbacks);
  return requestWorker(
    "generate",
    {
      text,
      voice: state.kokoroVoice || DEFAULT_KOKORO_VOICE,
      speed: Number(state.rate) || 1,
    },
    callbacks,
    WORKER_TIMEOUT_MS,
  );
}

function ensureWorker(callbacks) {
  if (worker) return;
  worker = new Worker("./kokoro-worker.js", { type: "module" });
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
