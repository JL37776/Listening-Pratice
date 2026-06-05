import { $, els } from "./src/dom.js";
import { MODEL_READY_KEY } from "./src/constants.js";
import { activeProject, activeSentence, state, uid } from "./src/state.js";
import { closeInstallDialog, populateKokoroVoices, render, setEngineStatus, setRenderCallbacks, showInstallDialog, updateInstallProgress } from "./src/render.js";
import { generateKokoroAudio, loadKokoro, resetKokoroWorker, runtimeKey } from "./src/kokoro-client.js";
import { playWavBuffer, stopAudio, unlockAudio } from "./src/audio-player.js";
import { populateSystemVoices, speakWithSystem, stopSystemSpeech } from "./src/system-speech.js";
import { setMediaPlaybackState, setupMediaSession, updateMediaSession } from "./src/media-session.js";

let isSpeaking = false;
let editSentenceId = null;
let playbackSession = 0;
const audioCache = new Map();

function stopPlayback() {
  playbackSession += 1;
  stopSystemSpeech();
  stopAudio();
  isSpeaking = false;
  $("#playIcon").textContent = "Play";
  setMediaPlaybackState("none");
  setEngineStatus();
}

async function installKokoro() {
  try {
    showInstallDialog();
    await unlockAudio();
    const result = await loadKokoro(state, { onProgress: handleKokoroProgress });
    populateKokoroVoices(result.voices);
    updateInstallProgress(100, "Kokoro is ready.");
    window.setTimeout(closeInstallDialog, 500);
  } catch (error) {
    console.error(error);
    updateInstallProgress(0, "Install failed. Please reload and try again.");
    setEngineStatus("Kokoro install failed");
  }
}

function handleKokoroProgress(progress) {
  updateInstallProgress(progress.percent, progress.label);
  setEngineStatus(progress.label);
}

async function prepareKokoroAudio(text, speed, showProgress = true) {
  await unlockAudio();
  const voice = state.kokoroVoice;
  const cacheKey = `${runtimeKey(state)}:${voice}:${speed}:${text}`;
  let audioPromise = audioCache.get(cacheKey);

  if (!audioPromise) {
    if (showProgress) setEngineStatus("Generating audio...");
    audioPromise = generateKokoroAudio(
      state,
      text,
      showProgress ? { onProgress: handleKokoroProgress } : {},
      speed,
    ).then((result) => {
      populateKokoroVoices(result.voices);
      return result.audioBuffer;
    }).catch((error) => {
      audioCache.delete(cacheKey);
      throw error;
    });
    audioCache.set(cacheKey, audioPromise);
    if (audioCache.size > 30) audioCache.delete(audioCache.keys().next().value);
  }

  return audioPromise;
}

function prefetchKokoroItem(item) {
  if (!item || state.engine !== "kokoro") return;
  prepareKokoroAudio(item.text, item.speed, false).catch((error) => {
    console.warn("Kokoro prefetch failed", error);
  });
}

async function playWithKokoro(item, { onStart, onEnd }) {
  const audioBuffer = await prepareKokoroAudio(item.text, item.speed, true);
  await playWavBuffer(audioBuffer, {
    onStart: () => {
      isSpeaking = true;
      $("#playIcon").textContent = "Stop";
      setMediaPlaybackState("playing");
      setEngineStatus(formatPlayingStatus("Kokoro", item));
      onStart?.();
    },
    onEnd: () => {
      isSpeaking = false;
      $("#playIcon").textContent = "Play";
      setMediaPlaybackState("none");
      setEngineStatus("Kokoro Ready");
      onEnd?.();
    },
    onError: () => {
      isSpeaking = false;
      $("#playIcon").textContent = "Play";
      setMediaPlaybackState("none");
      setEngineStatus("Audio playback failed");
    },
  });
}

function playWithSystem(item, { onStart, onEnd }) {
  speakWithSystem(item.text, {
    rate: item.speed,
    voiceURI: state.systemVoiceURI,
    onStart: () => {
      isSpeaking = true;
      $("#playIcon").textContent = "Stop";
      setMediaPlaybackState("playing");
      setEngineStatus(formatPlayingStatus("system voice", item));
      onStart?.();
    },
    onEnd: () => {
      isSpeaking = false;
      $("#playIcon").textContent = "Play";
      setMediaPlaybackState("none");
      setEngineStatus();
      onEnd?.();
    },
  });
}

async function speakItem(item, { onStart, onEnd }) {
  try {
    if (state.engine === "system") {
      playWithSystem(item, { onStart, onEnd });
      return;
    }
    await playWithKokoro(item, { onStart, onEnd });
  } catch (error) {
    console.error(error);
    stopPlayback();
    resetKokoroWorker();
    setEngineStatus(error.message.includes("timed out") ? "Generation timed out" : "Kokoro failed");
    alert("Kokoro generation got stuck. Please tap Play again; the worker has been reset.");
  }
}

async function speakCurrent() {
  if (isSpeaking) {
    stopPlayback();
    return;
  }
  const project = activeProject();
  if (!project.sentences.length) return;
  await unlockAudio();
  playbackSession += 1;
  const session = playbackSession;
  const repeat = Math.max(1, Number(state.repeatCount) || 1);
  const queue = buildPlaybackQueue(project, repeat);
  let index = 0;
  const playNext = () => {
    if (session !== playbackSession || index >= queue.length) return;
    const item = queue[index];
    const sentence = item.sentence;
    state.activeSentenceId = sentence.id;
    render();
    updateMediaSession({
      title: sentence.text,
      artist: activeProject().name,
      album: "Listening Practice",
    });
    index += 1;
    speakItem(item, {
      onStart: () => prefetchKokoroItem(queue[index]),
      onEnd: playNext,
    });
  };
  playNext();
}

function buildPlaybackQueue(project, repeat) {
  const sentences = project.sentences;
  if (state.repeatScope === "project") {
    const startIndex = Math.max(0, sentences.findIndex((sentence) => sentence.id === state.activeSentenceId));
    const ordered = [...sentences.slice(startIndex), ...sentences.slice(0, startIndex)];
    return Array.from({ length: repeat }, () => ordered)
      .flat()
      .flatMap((sentence) => makePlaybackItems(sentence, Number(state.rate) || 1));
  }

  if (state.repeatScope === "project-speed-pattern") {
    const startIndex = Math.max(0, sentences.findIndex((sentence) => sentence.id === state.activeSentenceId));
    const ordered = [...sentences.slice(startIndex), ...sentences.slice(0, startIndex)];
    const speeds = parseSpeedPattern();
    return ordered.flatMap((sentence) => speeds.flatMap((speed) => makePlaybackItems(sentence, speed)));
  }

  const sentence = activeSentence();
  return sentence
    ? Array.from({ length: repeat }, () => makePlaybackItems(sentence, Number(state.rate) || 1)).flat()
    : [];
}

function parseSpeedPattern() {
  const speeds = String(state.repeatSpeedPattern || "")
    .split(/[,\s]+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 0.4 && value <= 2);
  return speeds.length ? speeds : [1, 0.8, 0.5];
}

function getSpokenText(sentence) {
  const note = sentence.note?.trim() || "";
  if (note.startsWith("Answer:")) {
    return `${sentence.text}\n\n${note}`;
  }
  return sentence.text;
}

function makePlaybackItems(sentence, speed) {
  return splitSpokenText(getSpokenText(sentence)).map((text, partIndex, parts) => ({
    sentence,
    speed,
    text,
    partIndex,
    partCount: parts.length,
  }));
}

function splitSpokenText(text) {
  const maxLength = 420;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return [normalized];

  const pieces = normalized
    .replace(/\b(Situation|Task|Action|Result|Reflection):/g, "\n$1:")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((piece) => piece.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";
  pieces.forEach((piece) => {
    const next = current ? `${current} ${piece}` : piece;
    if (next.length <= maxLength) {
      current = next;
      return;
    }
    if (current) chunks.push(current);
    current = piece;
  });
  if (current) chunks.push(current);
  return chunks.length ? chunks : [normalized];
}

function formatPlayingStatus(engineName, item) {
  const part = item.partCount > 1 ? ` part ${item.partIndex + 1}/${item.partCount}` : "";
  return `Playing ${engineName} ${item.speed}x${part}`;
}

function selectSentence(id) {
  state.activeSentenceId = id;
  render();
}

function playSentence(id) {
  selectSentence(id);
  speakCurrent();
}

function moveSentence(direction) {
  const project = activeProject();
  if (!project.sentences.length) return;
  const currentIndex = project.sentences.findIndex((sentence) => sentence.id === state.activeSentenceId);
  const nextIndex = (currentIndex + direction + project.sentences.length) % project.sentences.length;
  state.activeSentenceId = project.sentences[nextIndex].id;
  stopPlayback();
  render();
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen();
  } catch (error) {
    console.warn("Fullscreen is not available", error);
  }
}

function updateFullscreenButton() {
  $("#fullscreenButton").textContent = document.fullscreenElement ? "Exit" : "Full";
}

function addSentence(text) {
  const value = text.trim();
  if (!value) return;
  const sentence = { id: uid("sentence"), text: value, note: "" };
  activeProject().sentences.push(sentence);
  state.activeSentenceId = sentence.id;
  render();
}

function openEdit(id) {
  const sentence = activeProject().sentences.find((item) => item.id === id);
  if (!sentence) return;
  editSentenceId = id;
  $("#editText").value = sentence.text;
  $("#editNote").value = sentence.note || "";
  $("#deleteSentence").hidden = false;
  els.editDialog.showModal();
}

function openNewSentence() {
  editSentenceId = null;
  $("#editText").value = "";
  $("#editNote").value = "";
  $("#deleteSentence").hidden = true;
  els.editDialog.showModal();
}

function selectProject(folderId, projectId) {
  state.activeFolderId = folderId;
  state.activeProjectId = projectId;
  state.activeSentenceId = activeProject().sentences[0]?.id || "";
  render();
  els.libraryDialog.close();
}

function renameFolder(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  const name = prompt("Folder name", folder.name);
  if (!name?.trim()) return;
  folder.name = name.trim();
  render();
}

function deleteFolder(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  if (!confirm(`Delete folder "${folder.name}" and all projects inside it?`)) return;
  state.folders = state.folders.filter((item) => item.id !== folderId);
  if (state.activeFolderId === folderId) {
    state.activeFolderId = state.folders[0]?.id || "";
    state.activeProjectId = "";
    state.activeSentenceId = "";
  }
  render();
}

function renameProject(folderId, projectId) {
  const folder = state.folders.find((item) => item.id === folderId);
  const project = folder?.projects.find((item) => item.id === projectId);
  if (!project) return;
  const name = prompt("Project name", project.name);
  if (!name?.trim()) return;
  project.name = name.trim();
  render();
}

function deleteProject(folderId, projectId) {
  const folder = state.folders.find((item) => item.id === folderId);
  const project = folder?.projects.find((item) => item.id === projectId);
  if (!folder || !project) return;
  if (!confirm(`Delete project "${project.name}" and all sentences inside it?`)) return;
  folder.projects = folder.projects.filter((item) => item.id !== projectId);
  if (state.activeProjectId === projectId) {
    state.activeFolderId = folder.id;
    state.activeProjectId = folder.projects[0]?.id || "";
    state.activeSentenceId = "";
  }
  render();
}

setRenderCallbacks({
  selectSentence,
  playSentence,
  openEdit,
  selectProject,
  renameFolder,
  deleteFolder,
  renameProject,
  deleteProject,
});

$("#openLibrary").addEventListener("click", () => els.libraryDialog.showModal());
$("#projectPicker").addEventListener("click", () => els.libraryDialog.showModal());
$("#quickAdd").addEventListener("click", openNewSentence);
$("#addSentence").addEventListener("click", openNewSentence);
$("#playPause").addEventListener("click", speakCurrent);
$("#prevSentence").addEventListener("click", () => moveSentence(-1));
$("#nextSentence").addEventListener("click", () => moveSentence(1));
$("#fullscreenButton").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
$("#settingsButton").addEventListener("click", () => els.settingsDialog.showModal());
document.querySelectorAll(".install-trigger").forEach((button) => {
  button.addEventListener("click", installKokoro);
});
$("#skipInstall").addEventListener("click", closeInstallDialog);

$("#engineSelect").addEventListener("change", (event) => {
  stopPlayback();
  state.engine = event.target.value;
  render();
});

$("#sentenceForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#sentenceInput");
  addSentence(input.value);
  input.value = "";
});

$("#repeatCount").addEventListener("change", (event) => {
  state.repeatCount = Math.min(9, Math.max(1, Number(event.target.value) || 1));
  render();
});

$("#repeatScope").addEventListener("change", (event) => {
  stopPlayback();
  state.repeatScope = ["sentence", "project", "project-speed-pattern"].includes(event.target.value)
    ? event.target.value
    : "sentence";
  render();
});

$("#speedPattern").addEventListener("change", (event) => {
  stopPlayback();
  state.repeatSpeedPattern = event.target.value.trim() || "1, 0.8, 0.5";
  render();
});

$("#rateRange").addEventListener("input", (event) => {
  state.rate = Number(event.target.value);
  $("#rateLabel").textContent = `${state.rate.toFixed(1)}x`;
  stopPlayback();
  render();
});

$("#systemVoiceSelect").addEventListener("change", (event) => {
  state.systemVoiceURI = event.target.value;
  render();
});

$("#kokoroVoiceSelect").addEventListener("change", (event) => {
  stopPlayback();
  state.kokoroVoice = event.target.value;
  render();
});

$("#kokoroDeviceSelect").addEventListener("change", (event) => {
  stopPlayback();
  state.kokoroDevice = event.target.value;
  resetKokoroWorker();
  audioCache.clear();
  render();
});

$("#kokoroDtypeSelect").addEventListener("change", (event) => {
  stopPlayback();
  state.kokoroDtype = event.target.value;
  resetKokoroWorker();
  audioCache.clear();
  render();
});

$("#createFolder").addEventListener("click", () => {
  const name = prompt("Folder name");
  if (!name?.trim()) return;
  const folder = { id: uid("folder"), name: name.trim(), projects: [] };
  state.folders.push(folder);
  state.activeFolderId = folder.id;
  state.activeProjectId = "";
  state.activeSentenceId = "";
  render();
});

$("#createProject").addEventListener("click", () => {
  const name = prompt("Project name");
  if (!name?.trim()) return;
  const project = { id: uid("project"), name: name.trim(), sentences: [] };
  const folder = state.folders.find((item) => item.id === state.activeFolderId);
  folder.projects.push(project);
  state.activeProjectId = project.id;
  state.activeSentenceId = "";
  render();
});

$("#editForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("#editText").value.trim();
  if (!text) return;
  const note = $("#editNote").value.trim();
  const project = activeProject();
  if (editSentenceId) {
    const sentence = project.sentences.find((item) => item.id === editSentenceId);
    if (sentence) {
      sentence.text = text;
      sentence.note = note;
      state.activeSentenceId = sentence.id;
    }
  } else {
    const sentence = { id: uid("sentence"), text, note };
    project.sentences.push(sentence);
    state.activeSentenceId = sentence.id;
  }
  render();
  els.editDialog.close();
});

$("#deleteSentence").addEventListener("click", () => {
  if (!editSentenceId) return;
  const project = activeProject();
  project.sentences = project.sentences.filter((sentence) => sentence.id !== editSentenceId);
  state.activeSentenceId = project.sentences[0]?.id || "";
  render();
  els.editDialog.close();
});

if ("speechSynthesis" in window) {
  populateSystemVoices($("#systemVoiceSelect"), state.systemVoiceURI);
  window.speechSynthesis.onvoiceschanged = () => populateSystemVoices($("#systemVoiceSelect"), state.systemVoiceURI);
}

setupMediaSession({
  play: speakCurrent,
  stop: stopPlayback,
  next: () => moveSentence(1),
  previous: () => moveSentence(-1),
});

render();

if (state.engine === "kokoro" && !localStorage.getItem(MODEL_READY_KEY)) {
  window.setTimeout(showInstallDialog, 350);
}
