const STORAGE_KEY = "listening-practice-state-v1";

const defaultState = {
  activeFolderId: "daily",
  activeProjectId: "morning",
  activeSentenceId: "s1",
  mode: "single",
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
              done: false,
            },
            {
              id: "s2",
              text: "Could you speak a little more slowly?",
              note: "Useful question for real conversations.",
              done: false,
            },
            {
              id: "s3",
              text: "I will review these sentences before going to bed.",
              note: "Review before bed.",
              done: false,
            },
          ],
        },
      ],
    },
    {
      id: "ielts",
      name: "IELTS",
      projects: [
        {
          id: "part-two",
          name: "Part 2",
          sentences: [
            {
              id: "s4",
              text: "The speaker describes a memorable journey in detail.",
              note: "Listen for keywords and tense.",
              done: false,
            },
          ],
        },
      ],
    },
  ],
};

let state = loadState();
let voices = [];
let currentUtterance = null;
let isSpeaking = false;
let editSentenceId = null;
let progressTimer = null;

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

function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
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
  const folder = activeFolder();
  const project = activeProject();
  $("#currentFolderName").textContent = folder.name;
  $("#currentProjectName").textContent = project.name;
  $("#repeatCount").value = state.repeatCount;
  $("#rateRange").value = state.rate;
  $("#rateLabel").textContent = `${Number(state.rate).toFixed(1)}x`;
  $("#speechStatus").textContent = "System Voice";
  renderSentences();
  renderLibrary();
  renderNowPlaying();
  updateModeTabs();
}

function renderSentences() {
  const project = activeProject();
  sentenceList.innerHTML = "";

  if (!project.sentences.length) {
    const empty = document.createElement("article");
    empty.className = "sentence-row";
    empty.innerHTML = `
      <span class="drag">＋</span>
      <div>
        <p class="sentence-text">No sentences yet</p>
        <p class="sentence-note">Add your first sentence from the input below.</p>
      </div>
      <div class="row-actions"></div>
    `;
    sentenceList.append(empty);
    return;
  }

  project.sentences.forEach((sentence) => {
    const row = document.createElement("article");
    row.className = `sentence-row${sentence.id === state.activeSentenceId ? " selected" : ""}`;
    row.innerHTML = `
      <span class="drag">⋮⋮</span>
      <button class="sentence-copy" type="button">
        <p class="sentence-text"></p>
        <p class="sentence-note"></p>
      </button>
      <div class="row-actions">
        <button class="mini-button play-one" type="button" aria-label="播放">▶</button>
        <button class="mini-button edit-one" type="button" aria-label="编辑">✎</button>
        <button class="mini-button done" type="button" aria-label="完成">${sentence.done ? "✓" : "○"}</button>
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
    row.querySelector(".done").addEventListener("click", () => toggleDone(sentence.id));
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
        <p class="folder-title">▦ ${folder.name}</p>
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
      button.textContent = `${project.name} · ${project.sentences.length} sentences`;
      button.addEventListener("click", () => {
        state.activeFolderId = folder.id;
        state.activeProjectId = project.id;
        state.activeSentenceId = project.sentences[0]?.id || "";
        saveState();
        render();
        libraryDialog.close();
      });

      const actions = document.createElement("div");
      actions.className = "project-actions";
      actions.innerHTML = `
        <button type="button" aria-label="Rename project">✎</button>
        <button type="button" aria-label="Delete project">×</button>
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
  $("#nowSubtitle").textContent = sentence ? sentence.note || "Press play to use system speech" : "Add a sentence to start practicing";
}

function updateModeTabs() {
  document.querySelectorAll(".mode-tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
}

function selectSentence(id) {
  state.activeSentenceId = id;
  saveState();
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
    currentUtterance = utterance;
    $("#playIcon").textContent = "Ⅱ";
    startProgress();
  };
  utterance.onend = () => {
    isSpeaking = false;
    currentUtterance = null;
    $("#playIcon").textContent = "▶";
    stopProgress(true);
    if (onEnd) onEnd();
  };
  utterance.onerror = utterance.onend;
  window.speechSynthesis.speak(utterance);
}

function speakCurrent() {
  if (isSpeaking) {
    window.speechSynthesis.cancel();
    return;
  }

  const sentence = activeSentence();
  if (!sentence) return;

  const repeat = Math.max(1, Number(state.repeatCount) || 1);
  let count = 0;
  const playNextRepeat = () => {
    count += 1;
    if (count <= repeat) {
      speakText(sentence.text, playNextRepeat);
    } else if (state.mode === "continuous") {
      moveSentence(1, true);
      speakCurrent();
    }
  };
  playNextRepeat();
}

function startProgress() {
  stopProgress(false);
  const started = Date.now();
  progressTimer = window.setInterval(() => {
    const progress = Math.min(92, ((Date.now() - started) / 3500) * 100);
    $("#progressFill").style.width = `${progress}%`;
  }, 120);
}

function stopProgress(complete) {
  if (progressTimer) window.clearInterval(progressTimer);
  progressTimer = null;
  $("#progressFill").style.width = complete ? "100%" : "0%";
  if (complete) {
    window.setTimeout(() => {
      if (!isSpeaking) $("#progressFill").style.width = "0%";
    }, 500);
  }
}

function moveSentence(direction, silent = false) {
  const project = activeProject();
  if (!project.sentences.length) return;
  const currentIndex = project.sentences.findIndex((sentence) => sentence.id === state.activeSentenceId);
  const nextIndex = (currentIndex + direction + project.sentences.length) % project.sentences.length;
  state.activeSentenceId = project.sentences[nextIndex].id;
  saveState();
  render();
  if (!silent) window.speechSynthesis?.cancel();
}

function addSentence(text) {
  const value = text.trim();
  if (!value) return;
  const project = activeProject();
  const sentence = { id: uid("sentence"), text: value, note: "", done: false };
  project.sentences.push(sentence);
  state.activeSentenceId = sentence.id;
  saveState();
  render();
}

function openEdit(id) {
  const project = activeProject();
  const sentence = project.sentences.find((item) => item.id === id);
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

function toggleDone(id) {
  const sentence = activeProject().sentences.find((item) => item.id === id);
  if (!sentence) return;
  sentence.done = !sentence.done;
  saveState();
  render();
}

function populateVoices() {
  voices = window.speechSynthesis?.getVoices?.() || [];
  const select = $("#voiceSelect");
  const current = select.value || state.voiceURI;
  select.innerHTML = `<option value="">System Default</option>`;
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} · ${voice.lang}`;
    select.append(option);
  });
  select.value = voices.some((voice) => voice.voiceURI === current) ? current : "";
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

$("#pasteSentence").addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    $("#sentenceInput").value = text;
  } catch {
    $("#sentenceInput").focus();
  }
});

$("#repeatCount").addEventListener("change", (event) => {
  state.repeatCount = Math.min(9, Math.max(1, Number(event.target.value) || 1));
  saveState();
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

document.querySelectorAll(".mode-tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    saveState();
    updateModeTabs();
  });
});

$("#createFolder").addEventListener("click", () => {
  const name = prompt("Folder name");
  if (!name?.trim()) return;
  const folder = { id: uid("folder"), name: name.trim(), projects: [] };
  state.folders.push(folder);
  state.activeFolderId = folder.id;
  state.activeProjectId = "";
  state.activeSentenceId = "";
  saveState();
  render();
});

$("#createProject").addEventListener("click", () => {
  const folder = activeFolder();
  const name = prompt("Project name");
  if (!name?.trim()) return;
  const project = { id: uid("project"), name: name.trim(), sentences: [] };
  folder.projects.push(project);
  state.activeProjectId = project.id;
  state.activeSentenceId = "";
  saveState();
  render();
});

function renameFolder(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  const name = prompt("Folder name", folder.name);
  if (!name?.trim()) return;
  folder.name = name.trim();
  saveState();
  render();
}

function deleteFolder(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  const message = `Delete folder "${folder.name}" and all projects inside it?`;
  if (!confirm(message)) return;
  state.folders = state.folders.filter((item) => item.id !== folderId);
  if (state.activeFolderId === folderId) {
    state.activeFolderId = state.folders[0]?.id || "";
    state.activeProjectId = "";
    state.activeSentenceId = "";
  }
  saveState();
  render();
}

function renameProject(folderId, projectId) {
  const folder = state.folders.find((item) => item.id === folderId);
  const project = folder?.projects.find((item) => item.id === projectId);
  if (!project) return;
  const name = prompt("Project name", project.name);
  if (!name?.trim()) return;
  project.name = name.trim();
  saveState();
  render();
}

function deleteProject(folderId, projectId) {
  const folder = state.folders.find((item) => item.id === folderId);
  const project = folder?.projects.find((item) => item.id === projectId);
  if (!folder || !project) return;
  const message = `Delete project "${project.name}" and all sentences inside it?`;
  if (!confirm(message)) return;
  folder.projects = folder.projects.filter((item) => item.id !== projectId);
  if (state.activeProjectId === projectId) {
    state.activeFolderId = folder.id;
    state.activeProjectId = folder.projects[0]?.id || "";
    state.activeSentenceId = "";
  }
  saveState();
  render();
}

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
    const sentence = { id: uid("sentence"), text, note, done: false };
    project.sentences.push(sentence);
    state.activeSentenceId = sentence.id;
  }
  saveState();
  render();
  editDialog.close();
});

$("#deleteSentence").addEventListener("click", () => {
  if (!editSentenceId) return;
  const project = activeProject();
  project.sentences = project.sentences.filter((sentence) => sentence.id !== editSentenceId);
  state.activeSentenceId = project.sentences[0]?.id || "";
  saveState();
  render();
  editDialog.close();
});

$("#projectsTab").addEventListener("click", () => libraryDialog.showModal());
$("#recordsTab").addEventListener("click", () => alert("Practice records are saved in this browser. A stats page can be added later."));
$("#settingsTab").addEventListener("click", () => alert("This app uses iOS/Safari system speech. Manage voices in your iPhone settings."));

if ("speechSynthesis" in window) {
  populateVoices();
  window.speechSynthesis.onvoiceschanged = populateVoices;
} else {
  $("#speechStatus").textContent = "Speech Unavailable";
}

render();
