let activeAudio = null;
let activeAudioUrl = "";
let audioContext = null;

export async function unlockAudio() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") await audioContext.resume();
  } catch {
    audioContext = null;
  }
}

export async function playWavBuffer(audioBuffer, { onStart, onEnd, onError }) {
  stopAudio();
  activeAudioUrl = URL.createObjectURL(new Blob([audioBuffer], { type: "audio/wav" }));
  activeAudio = new Audio(activeAudioUrl);
  activeAudio.onplay = onStart;
  activeAudio.onended = () => {
    stopAudio();
    onEnd?.();
  };
  activeAudio.onerror = () => {
    stopAudio();
    onError?.();
  };
  await activeAudio.play();
}

export function stopAudio() {
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
  }
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudio = null;
  activeAudioUrl = "";
}
