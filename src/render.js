import { DEFAULT_KOKORO_VOICE, MODEL_READY_KEY } from "./constants.js";
import { $, els } from "./dom.js";
import { activeFolder, activeProject, activeSentence, ensureState, saveState, state } from "./state.js";

let callbacks = {};

export function setRenderCallbacks(nextCallbacks) {
  callbacks = nextCallbacks;
}

export function render() {
  ensureState();
  $("#currentFolderName").textContent = activeFolder().name;
  $("#currentProjectName").textContent = activeProject().name;
  $("#repeatCount").value = state.repeatCount;
  $("#repeatScope").value = state.repeatScope;
  $("#rateRange").value = state.rate;
  $("#rateLabel").textContent = `${Number(state.rate).toFixed(1)}x`;
  $("#engineSelect").value = state.engine;
  $("#kokoroVoiceSelect").value = state.kokoroVoice || DEFAULT_KOKORO_VOICE;
  $("#kokoroDeviceSelect").value = state.kokoroDevice;
  $("#kokoroDtypeSelect").value = state.kokoroDtype;
  $("#systemVoiceRow").hidden = state.engine !== "system";
  setEngineStatus();
  renderSentences();
  renderLibrary();
  renderNowPlaying();
  saveState();
}

export function setEngineStatus(message = "") {
  if (message) {
    $("#engineStatus").textContent = message;
    return;
  }
  if (state.engine === "system") {
    $("#engineStatus").textContent = "System Speech";
    return;
  }
  $("#engineStatus").textContent = localStorage.getItem(MODEL_READY_KEY) ? "Kokoro Ready" : "Kokoro TTS";
}

export function updateInstallProgress(percent, label) {
  const safePercent = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  $("#installProgressFill").style.width = `${safePercent}%`;
  $("#installProgressText").textContent = `${Math.round(safePercent)}%`;
  $("#installStatus").textContent = label || "Preparing model...";
}

export function showInstallDialog() {
  updateInstallProgress(0, "Kokoro needs to download and initialize once.");
  if (!els.installDialog.open) els.installDialog.showModal();
}

export function closeInstallDialog() {
  if (els.installDialog.open) els.installDialog.close();
}

export function populateKokoroVoices(voiceEntries) {
  if (!voiceEntries?.length) return;
  const select = $("#kokoroVoiceSelect");
  const current = state.kokoroVoice || DEFAULT_KOKORO_VOICE;
  select.innerHTML = "";
  voiceEntries.forEach(([id, voice]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = `${voice.name || id} - ${voice.language || "English"} ${voice.gender || ""}`.trim();
    select.append(option);
  });
  select.value = select.querySelector(`option[value="${current}"]`) ? current : DEFAULT_KOKORO_VOICE;
  state.kokoroVoice = select.value;
  saveState();
}

function renderSentences() {
  const project = activeProject();
  els.sentenceList.innerHTML = "";

  if (!project.sentences.length) {
    const empty = document.createElement("article");
    empty.className = "sentence-row empty";
    empty.innerHTML = `
      <div>
        <p class="sentence-text">No sentences yet</p>
        <p class="sentence-note">Add your first sentence below.</p>
      </div>
    `;
    els.sentenceList.append(empty);
    return;
  }

  project.sentences.forEach((sentence) => {
    const row = document.createElement("article");
    row.className = `sentence-row${sentence.id === state.activeSentenceId ? " selected" : ""}`;
    row.innerHTML = `
      <button class="sentence-copy" type="button">
        <p class="sentence-text"></p>
        <p class="sentence-note"></p>
      </button>
      <div class="row-actions">
        <button class="mini-button play-one" type="button" aria-label="Play sentence">Play</button>
        <button class="mini-button edit-one" type="button" aria-label="Edit sentence">Edit</button>
      </div>
    `;
    row.querySelector(".sentence-text").textContent = sentence.text;
    row.querySelector(".sentence-note").textContent = sentence.note || "No note";
    row.querySelector(".sentence-copy").addEventListener("click", () => callbacks.selectSentence?.(sentence.id));
    row.querySelector(".play-one").addEventListener("click", () => callbacks.playSentence?.(sentence.id));
    row.querySelector(".edit-one").addEventListener("click", () => callbacks.openEdit?.(sentence.id));
    els.sentenceList.append(row);
  });
}

function renderLibrary() {
  const folderList = $("#folderList");
  folderList.innerHTML = "";

  state.folders.forEach((folder) => {
    const block = document.createElement("section");
    block.className = "folder-block";
    block.innerHTML = `
      <div class="folder-title-row">
        <p class="folder-title">${folder.name}</p>
        <div class="library-mini-actions">
          <button type="button" data-action="rename-folder">Rename</button>
          <button type="button" data-action="delete-folder">Delete</button>
        </div>
      </div>
    `;
    block.querySelector('[data-action="rename-folder"]').addEventListener("click", () => callbacks.renameFolder?.(folder.id));
    block.querySelector('[data-action="delete-folder"]').addEventListener("click", () => callbacks.deleteFolder?.(folder.id));

    folder.projects.forEach((project) => {
      const row = document.createElement("div");
      row.className = `project-row${project.id === state.activeProjectId ? " active" : ""}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "project-button";
      button.textContent = `${project.name} - ${project.sentences.length} sentences`;
      button.addEventListener("click", () => callbacks.selectProject?.(folder.id, project.id));

      const actions = document.createElement("div");
      actions.className = "project-actions";
      actions.innerHTML = `
        <button type="button" aria-label="Rename project">Edit</button>
        <button type="button" aria-label="Delete project">Delete</button>
      `;
      actions.children[0].addEventListener("click", () => callbacks.renameProject?.(folder.id, project.id));
      actions.children[1].addEventListener("click", () => callbacks.deleteProject?.(folder.id, project.id));
      row.append(button, actions);
      block.append(row);
    });
    folderList.append(block);
  });
}

function renderNowPlaying() {
  const sentence = activeSentence();
  $("#nowTitle").textContent = sentence ? sentence.text : "Ready";
  $("#nowSubtitle").textContent = sentence ? sentence.note || "Press play to practice." : "Add a sentence to start.";
}
