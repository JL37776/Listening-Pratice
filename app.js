const STORAGE_KEY = "listening-practice-state-v2";

const defaultState = {
  activeFolderId: "daily",
  activeProjectId: "morning",
  activeSentenceId: "s1",
  repeatCount: 3,
  rate: 0.9,
  voiceURI: "",
  folders: [
    {
      id: "daily",
      name: "Daily English",
      projects: [
        {
          id: "morning",
          name: "Morning Practice",
          sentences: [
            {
              id: "s1",
              text: "I want to improve my listening every day.",
              note: "Daily listening routine.",
            },
            {
              id: "s2",
              text: "Could you speak a little more slowly?",
              note: "Useful question for real conversations.",
            },
            {
              id: "s3",
              text: "I will review these sentences before going to bed.",
              note: "Review before bed.",
            },
          ],
        },
      ],
    },
  ],
};

let state = loadState();
let voices = [];
let isSpeaking = false;
let editSentenceId = null;

const $ = (selector) => document.querySelector(selector);
const sentenceList = $("#sentenceList");
const libraryDialog = $("#libraryDialog");
const editDialog = $("#editDialog");

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function ensureState() {
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

function activeFolder() {
  return state.folders.find((folder) => folder.id === state.activeFolderId) || state.folders[0];
}

function activeProject() {
  const folder = activeFolder();
  return folder.projects.find((project) => project.id === state.activeProjectId) || folder.projects[0];
}

function activeSentence() {
  const project = activeProject();
  return project.sentences.find((sentence) => sentence.id === state.activeSentenceId) || project.sentences[0];
}

function render() {
  ensureState();
  $("#currentFolderName").textContent = activeFolder().name;
  $("#currentProjectName").textContent = activeProject().name;
  $("#repeatCount").value = state.repeatCount;
  $("#rateRange").value = state.rate;
  $("#rateLabel").textContent = `${Number(state.rate).toFixed(1)}x`;
  renderSentences();
  renderLibrary();
  renderNowPlaying();
  saveState();
}

function renderSentences() {
  const project = activeProject();
  sentenceList.innerHTML = "";

  if (!project.sentences.length) {
    const empty = document.createElement("article");
    empty.className = "sentence-row empty";
    empty.innerHTML = `
      <div>
        <p class="sentence-text">No sentences yet</p>
        <p class="sentence-note">Add your first sentence below.</p>
      </div>
    `;
    sentenceList.append(empty);
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
    row.querySelector(".sentence-copy").addEventListener("click", () => selectSentence(sentence.id));
    row.querySelector(".play-one").addEventListener("click", () => {
      selectSentence(sentence.id);
      speakCurrent();
    });
    row.querySelector(".edit-one").addEventListener("click", () => openEdit(sentence.id));
    sentenceList.append(row);
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
    block.querySelector('[data-action="rename-folder"]').addEventListener("click", () => renameFolder(folder.id));
    block.querySelector('[data-action="delete-folder"]').addEventListener("click", () => deleteFolder(folder.id));

    folder.projects.forEach((project) => {
      const row = document.createElement("div");
      row.className = `project-row${project.id === state.activeProjectId ? " active" : ""}`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "project-button";
      button.textContent = `${project.name} - ${project.sentences.length} sentences`;
      button.addEventListener("click", () => {
        state.activeFolderId = folder.id;
        state.activeProjectId = project.id;
        state.activeSentenceId = project.sentences[0]?.id || "";
        render();
        libraryDialog.close();
      });

      const actions = document.createElement("div");
      actions.className = "project-actions";
      actions.innerHTML = `
        <button type="button" aria-label="Rename project">Edit</button>
        <button type="button" aria-label="Delete project">Delete</button>
      `;
      actions.children[0].addEventListener("click", () => renameProject(folder.id, project.id));
      actions.children[1].addEventListener("click", () => deleteProject(folder.id, project.id));

      row.append(button, actions);
      block.append(row);
    });
    folderList.append(block);
  });
}

function renderNowPlaying() {
  const sentence = activeSentence();
  $("#nowTitle").textContent = sentence ? sentence.text : "Ready";
  $("#nowSubtitle").textContent = sentence ? sentence.note || "Press play to use system speech." : "Add a sentence to start.";
}

function selectSentence(id) {
  state.activeSentenceId = id;
  render();
}

function selectedVoice() {
  return voices.find((voice) => voice.voiceURI === state.voiceURI) || null;
}

function speakText(text, onEnd) {
  if (!("speechSynthesis" in window)) {
    alert("This browser does not support system speech. Please open it in iPhone Safari.");
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = Number(state.rate);
  utterance.voice = selectedVoice();
  utterance.lang = selectedVoice()?.lang || "en-US";
  utterance.onstart = () => {
    isSpeaking = true;
    $("#playIcon").textContent = "Stop";
  };
  utterance.onend = () => {
    isSpeaking = false;
    $("#playIcon").textContent = "Play";
    if (onEnd) onEnd();
  };
  utterance.onerror = utterance.onend;
  window.speechSynthesis.speak(utterance);
}

function speakCurrent() {
  if (isSpeaking) {
    window.speechSynthesis.cancel();
    isSpeaking = false;
    $("#playIcon").textContent = "Play";
    return;
  }

  const sentence = activeSentence();
  if (!sentence) return;

  const repeat = Math.max(1, Number(state.repeatCount) || 1);
  let count = 0;
  const playNextRepeat = () => {
    count += 1;
    if (count <= repeat) speakText(sentence.text, playNextRepeat);
  };
  playNextRepeat();
}

function moveSentence(direction) {
  const project = activeProject();
  if (!project.sentences.length) return;
  const currentIndex = project.sentences.findIndex((sentence) => sentence.id === state.activeSentenceId);
  const nextIndex = (currentIndex + direction + project.sentences.length) % project.sentences.length;
  state.activeSentenceId = project.sentences[nextIndex].id;
  window.speechSynthesis?.cancel();
  isSpeaking = false;
  $("#playIcon").textContent = "Play";
  render();
}

function addSentence(text) {
  const value = text.trim();
  if (!value) return;
  const project = activeProject();
  const sentence = { id: uid("sentence"), text: value, note: "" };
  project.sentences.push(sentence);
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
  editDialog.showModal();
}

function openNewSentence() {
  editSentenceId = null;
  $("#editText").value = "";
  $("#editNote").value = "";
  $("#deleteSentence").hidden = true;
  editDialog.showModal();
}

function populateVoices() {
  voices = window.speechSynthesis?.getVoices?.() || [];
  const select = $("#voiceSelect");
  const current = select.value || state.voiceURI;
  select.innerHTML = `<option value="">System Default</option>`;
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} - ${voice.lang}`;
    select.append(option);
  });
  select.value = voices.some((voice) => voice.voiceURI === current) ? current : "";
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

$("#openLibrary").addEventListener("click", () => libraryDialog.showModal());
$("#projectPicker").addEventListener("click", () => libraryDialog.showModal());
$("#quickAdd").addEventListener("click", openNewSentence);
$("#addSentence").addEventListener("click", openNewSentence);
$("#playPause").addEventListener("click", speakCurrent);
$("#prevSentence").addEventListener("click", () => moveSentence(-1));
$("#nextSentence").addEventListener("click", () => moveSentence(1));

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

$("#rateRange").addEventListener("input", (event) => {
  state.rate = Number(event.target.value);
  $("#rateLabel").textContent = `${state.rate.toFixed(1)}x`;
  saveState();
});

$("#voiceSelect").addEventListener("change", (event) => {
  state.voiceURI = event.target.value;
  saveState();
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
  activeFolder().projects.push(project);
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
  editDialog.close();
});

$("#deleteSentence").addEventListener("click", () => {
  if (!editSentenceId) return;
  const project = activeProject();
  project.sentences = project.sentences.filter((sentence) => sentence.id !== editSentenceId);
  state.activeSentenceId = project.sentences[0]?.id || "";
  render();
  editDialog.close();
});

if ("speechSynthesis" in window) {
  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
}

render();
