let voices = [];

export function populateSystemVoices(select, currentVoiceURI = "") {
  voices = window.speechSynthesis?.getVoices?.() || [];
  select.innerHTML = `<option value="">System Default</option>`;
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} - ${voice.lang}`;
    select.append(option);
  });
  select.value = voices.some((voice) => voice.voiceURI === currentVoiceURI) ? currentVoiceURI : "";
}

export function speakWithSystem(text, { rate, voiceURI, onStart, onEnd }) {
  if (!("speechSynthesis" in window)) {
    throw new Error("This browser does not support system speech.");
  }
  window.speechSynthesis.cancel();
  const selectedVoice = voices.find((voice) => voice.voiceURI === voiceURI) || null;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = Number(rate);
  utterance.voice = selectedVoice;
  utterance.lang = selectedVoice?.lang || "en-US";
  utterance.onstart = onStart;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
}

export function stopSystemSpeech() {
  window.speechSynthesis?.cancel();
}
