const states = new Map();

export function wantsHuman(value) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\botra persona\b/.test(text) && !/\b(humano|encargad|agente|pasame|comunica)\b/.test(text)) {
    return false;
  }
  const role = /\b(humano|encargad\w*|agente|persona|alguien)\b/;
  const ask = /\b(hablar con|pasame|comunica\w*|atienda|atender|necesito hablar)\b/;
  return role.test(text) && ask.test(text);
}

export function requestTransfer(callSid) {
  const current = states.get(callSid);
  if (current === "TRANSFERRING" || current === "TRANSFERRED") {
    return { accepted: false, state: current };
  }
  states.set(callSid, "TRANSFERRING");
  return { accepted: true, state: "TRANSFERRING" };
}

export function markTransferred(callSid) {
  states.set(callSid, "TRANSFERRED");
  return "TRANSFERRED";
}

export function markTransferFailed(callSid) {
  states.set(callSid, "FAILED");
  return "FAILED";
}

export function transferState(callSid) {
  return states.get(callSid) || "IDLE";
}

export function maskNumber(number) {
  const digits = String(number || "").replace(/\D/g, "");
  if (digits.length < 6) {
    return "oculto";
  }
  return `${digits.slice(0, 4)}******${digits.slice(-3)}`;
}

export function transferTwiml(number, actionUrl) {
  const safe = String(number || "");
  if (!/^\+\d{10,15}$/.test(safe)) {
    throw new Error("Número de transferencia inválido");
  }
  const action = actionUrl
    ? ` action="${actionUrl}" method="POST"`
    : "";
  return `<Response><Dial timeout="30"${action}><Number>${safe}</Number></Dial></Response>`;
}
