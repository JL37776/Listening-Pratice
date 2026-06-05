export const STORAGE_KEY = "listening-practice-state-v3";
export const MODEL_READY_KEY = "kokoro-model-ready-v1";
export const DEFAULT_KOKORO_VOICE = "af_heart";
export const WORKER_TIMEOUT_MS = 90000;
export const DEFAULT_STATE = {
  activeFolderId: "daily",
  activeProjectId: "morning",
  activeSentenceId: "s1",
  repeatCount: 3,
  repeatScope: "sentence",
  repeatSpeedPattern: "1, 0.8, 0.5",
  rate: 0.9,
  engine: "kokoro",
  systemVoiceURI: "",
  kokoroVoice: DEFAULT_KOKORO_VOICE,
  kokoroDevice: "auto",
  kokoroDtype: "auto",
  folders: [
    {
      id: "daily",
      name: "Daily English",
      projects: [
        {
          id: "morning",
          name: "Morning Practice",
          sentences: [
            { id: "s1", text: "I want to improve my listening every day.", note: "Daily listening routine." },
            { id: "s2", text: "Could you speak a little more slowly?", note: "Useful question for real conversations." },
            { id: "s3", text: "I will review these sentences before going to bed.", note: "Review before bed." },
          ],
        },
      ],
    },
  ],
};
