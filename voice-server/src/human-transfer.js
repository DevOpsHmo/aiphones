const states = new Map();

export function wantsHuman(value) {
  const text = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/comunico con alguien de la pizzeria/.test(text)) {
    return false;
  }
  if (/\botra persona\b/.test(text) && !/\b(humano|encargad|agente|pasame|comunica)\b/.test(text)) {
    return false;
  }
  if (/\b(maquina|robot)\b/.test(text) && /\b(persona|humano|alguien)\b/.test(text)) {
    return true;
  }
  return /\b(puedo|quiero)\s+hablar\s+con\s+un\s+humano\b/.test(text);
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

export function transferTwiml(number, actionUrl, callerId) {
  const safe = String(number || "");
  if (!/^\+\d{10,15}$/.test(safe)) {
    throw new Error("Número de transferencia inválido");
  }
  const action = actionUrl
    ? ` action="${actionUrl}" method="POST"`
    : "";
  const from = /^\+\d{10,15}$/.test(String(callerId || "")) && callerId !== safe
    ? ` callerId="${callerId}"`
    : "";
  return `<Response><Say language="es-MX">Claro, lo comunico con alguien de la pizzería.</Say><Dial timeout="30"${from}${action}><Number>${safe}</Number></Dial></Response>`;
}
