export function setupMediaSession({ play, stop, next, previous }) {
  if (!("mediaSession" in navigator)) return;
  setActionHandler("play", play);
  setActionHandler("pause", stop);
  setActionHandler("stop", stop);
  setActionHandler("nexttrack", next);
  setActionHandler("previoustrack", previous);
}

function setActionHandler(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Some browsers expose Media Session but not every action.
  }
}

export function updateMediaSession({ title, artist, album }) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: title || "Listening Practice",
    artist: artist || "Kokoro TTS",
    album: album || "Listening Practice",
  });
}

export function setMediaPlaybackState(state) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = state;
}
