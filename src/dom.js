export const $ = (selector) => document.querySelector(selector);

export const els = {
  sentenceList: $("#sentenceList"),
  libraryDialog: $("#libraryDialog"),
  editDialog: $("#editDialog"),
  settingsDialog: $("#settingsDialog"),
  installDialog: $("#installDialog"),
};

export function setText(selector, text) {
  const element = $(selector);
  if (element) element.textContent = text;
}
