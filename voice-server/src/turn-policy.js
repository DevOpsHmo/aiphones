export function foldTurn(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const CANCEL = /\b(cancela|cancelar|cancelalo|espera|esperate|parate|alto|callate|cuelga|ya no quiero)\b/;

export function interruptionDecision({ event, transcript }) {
  if (event !== "transcript") {
    return { clearPlayback: false, cancelResponse: false, reason: "vad" };
  }
  if (CANCEL.test(foldTurn(transcript))) {
    return { clearPlayback: true, cancelResponse: true, reason: "explicit" };
  }
  return { clearPlayback: false, cancelResponse: false, reason: "continue" };
}

export function mushroomIntent(utterance) {
  const text = foldTurn(utterance);
  if (/\bqueso\b/.test(text) && !/champi/.test(text)) {
    return "none";
  }
  if (!/champi/.test(text)) {
    return "none";
  }
  if (/\b(sin|quita|quitale|quiteme|no quiero|mejor sin)\b/.test(text)) {
    return "remove";
  }
  if (/\bcambia\b/.test(text)) {
    return "unclear";
  }
  return "add";
}

const QUANTITY_WORDS = { una: 1, uno: 1, dos: 2, tres: 3, cinco: 5, diez: 10 };

export function mentionedQuantity(utterance) {
  const text = foldTurn(utterance);
  for (const [word, amount] of Object.entries(QUANTITY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      return amount;
    }
  }
  const digits = text.match(/\b(\d+)\b/);
  if (!digits) {
    return 0;
  }
  const amount = Number(digits[1]);
  return amount >= 1 && amount <= 50 ? amount : 0;
}

export function createAudioState() {
  return {
    phase: "idle",
    playback: "silent",
    generation: 0,
    clears: 0,
    cancels: 0,
    ignoredDuplicate: 0
  };
}

export function reduceAudio(state, event) {
  const next = { ...state };
  if (event.type === "response.created") {
    if (next.phase === "speaking") {
      next.ignoredDuplicate += 1;
      return next;
    }
    next.phase = "speaking";
    next.playback = "playing";
    next.generation += 1;
    return next;
  }
  if (event.type === "audio.delta") {
    if (next.phase === "speaking") {
      next.playback = "playing";
    }
    return next;
  }
  if (event.type === "speech_started" || event.type === "noise" || event.type === "speech_stopped") {
    return next;
  }
  if (event.type === "transcript") {
    const decision = interruptionDecision({ event: "transcript", transcript: event.transcript || "" });
    if (decision.cancelResponse && next.phase === "speaking") {
      next.phase = "idle";
      next.playback = "cleared";
      next.clears += 1;
      next.cancels += 1;
    }
    return next;
  }
  if (event.type === "response.done") {
    if (next.playback !== "cleared") {
      next.phase = "idle";
      next.playback = "finished";
    }
    return next;
  }
  if (event.type === "disconnect") {
    next.phase = "idle";
    next.playback = "closed";
    return next;
  }
  if (event.type === "reconnect") {
    next.phase = "idle";
    next.playback = "silent";
    return next;
  }
  return next;
}

export function playSequence(events) {
  return events.reduce(reduceAudio, createAudioState());
}

export function serverPrice({ size, extra, claimedPrice }) {
  const base = { mediana: 200, grande: 220, familiar: 250 }[size];
  if (!base) {
    throw new Error("Tamaño inválido");
  }
  const total = extra === "champinones" ? base + 25 : base;
  return { base, total, ignoredClaim: claimedPrice ?? null };
}
