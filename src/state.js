import { DEFAULT_KOKORO_VOICE, DEFAULT_STATE, STORAGE_KEY } from "./constants.js";

export let state = loadState();

export function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : structuredClone(DEFAULT_STATE);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ensureState() {
  state.engine ||= "kokoro";
  state.systemVoiceURI ||= "";
  state.kokoroVoice ||= DEFAULT_KOKORO_VOICE;
  state.kokoroDevice ||= "auto";
  state.kokoroDtype ||= "auto";
  state.repeatCount = Math.min(9, Math.max(1, Number(state.repeatCount) || 3));
  state.rate = Math.min(1.5, Math.max(0.5, Number(state.rate) || 0.9));

  if (!Array.isArray(state.folders) || !state.folders.length) {
    state.folders = [{ id: uid("folder"), name: "My Folder", projects: [] }];
  }
  state.folders.forEach((folder) => {
    if (!Array.isArray(folder.projects)) folder.projects = [];
  });
  if (!state.folders.some((folder) => folder.id === state.activeFolderId)) {
    state.activeFolderId = state.folders[0].id;
  }

  const folder = activeFolder();
  if (!folder.projects.length) {
    folder.projects.push({ id: uid("project"), name: "General Practice", sentences: [] });
  }
  if (!folder.projects.some((project) => project.id === state.activeProjectId)) {
    state.activeProjectId = folder.projects[0].id;
  }

  const project = activeProject();
  if (!project.sentences.some((sentence) => sentence.id === state.activeSentenceId)) {
    state.activeSentenceId = project.sentences[0]?.id || "";
  }
}

export function activeFolder() {
  return state.folders.find((folder) => folder.id === state.activeFolderId) || state.folders[0];
}

export function activeProject() {
  const folder = activeFolder();
  return folder.projects.find((project) => project.id === state.activeProjectId) || folder.projects[0];
}

export function activeSentence() {
  const project = activeProject();
  return project.sentences.find((sentence) => sentence.id === state.activeSentenceId) || project.sentences[0];
}
