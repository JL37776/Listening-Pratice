import { $, els } from "./src/dom.js";
import { MODEL_READY_KEY } from "./src/constants.js";
import { activeProject, activeSentence, state, uid } from "./src/state.js";
import { closeInstallDialog, populateKokoroVoices, render, setEngineStatus, setRenderCallbacks, showInstallDialog, updateInstallProgress } from "./src/render.js";
import { generateKokoroAudio, loadKokoro, resetKokoroWorker, runtimeKey } from "./src/kokoro-client.js";
import { playWavBuffer, stopAudio, unlockAudio } from "./src/audio-player.js";
import { populateSystemVoices, speakWithSystem, stopSystemSpeech } from "./src/system-speech.js";

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

async function playWithKokoro(text, onEnd) {
  await unlockAudio();
  const voice = state.kokoroVoice;
  const speed = Number(state.rate) || 1;
  const cacheKey = `${runtimeKey(state)}:${voice}:${speed}:${text}`;
  let audioBuffer = audioCache.get(cacheKey);

  if (!audioBuffer) {
    setEngineStatus("Generating audio...");
    const result = await generateKokoroAudio(state, text, { onProgress: handleKokoroProgress });
    populateKokoroVoices(result.voices);
    audioBuffer = result.audioBuffer;
    audioCache.set(cacheKey, audioBuffer);
    if (audioCache.size > 20) audioCache.delete(audioCache.keys().next().value);
  }

  await playWavBuffer(audioBuffer, {
    onStart: () => {
      isSpeaking = true;
      $("#playIcon").textContent = "Stop";
      setEngineStatus("Playing Kokoro");
    },
    onEnd: () => {
      isSpeaking = false;
      $("#playIcon").textContent = "Play";
      setEngineStatus("Kokoro Ready");
      onEnd?.();
    },
    onError: () => {
      isSpeaking = false;
      $("#playIcon").textContent = "Play";
      setEngineStatus("Audio playback failed");
    },
  });
}

function playWithSystem(text, onEnd) {
  speakWithSystem(text, {
    rate: state.rate,
    voiceURI: state.systemVoiceURI,
    onStart: () => {
      isSpeaking = true;
      $("#playIcon").textContent = "Stop";
      setEngineStatus("Playing system voice");
    },
    onEnd: () => {
      isSpeaking = false;
      $("#playIcon").textContent = "Play";
      setEngineStatus();
      onEnd?.();
    },
  });
}

async function speakText(text, onEnd) {
  try {
    if (state.engine === "system") {
      playWithSystem(text, onEnd);
      return;
    }
    await playWithKokoro(text, onEnd);
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
    const sentence = queue[index];
    state.activeSentenceId = sentence.id;
    render();
    index += 1;
    speakText(sentence.text, playNext);
  };
  playNext();
}

function buildPlaybackQueue(project, repeat) {
  const sentences = project.sentences;
  if (state.repeatScope === "project") {
    const startIndex = Math.max(0, sentences.findIndex((sentence) => sentence.id === state.activeSentenceId));
    const ordered = [...sentences.slice(startIndex), ...sentences.slice(0, startIndex)];
    return Array.from({ length: repeat }, () => ordered).flat();
  }

  const sentence = activeSentence();
  return sentence ? Array.from({ length: repeat }, () => sentence) : [];
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
  state.repeatScope = event.target.value === "project" ? "project" : "sentence";
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

render();

if (state.engine === "kokoro" && !localStorage.getItem(MODEL_READY_KEY)) {
  window.setTimeout(showInstallDialog, 350);
}
