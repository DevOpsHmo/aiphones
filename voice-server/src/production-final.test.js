import assert from "node:assert/strict";
import test from "node:test";
import { playSequence } from "./turn-policy.js";
import { buildConfirmation, reviseDraft, acceptSpoken, priceLine } from "./confirmation.js";
import { withCallLock } from "./call-lock.js";

const noise = ["speech_started", "noise", "speech_stopped", "speech_started"];

test("ruido durante la respuesta no corta", () => {
  const end = playSequence([
    { type: "response.created" },
    { type: "audio.delta" },
    ...noise.map(type => ({ type })),
    { type: "audio.delta" },
    { type: "response.done" }
  ]);
  assert.equal(end.clears, 0);
  assert.equal(end.cancels, 0);
  assert.equal(end.playback, "finished");
});

test("cancelacion explicita si corta el audio", () => {
  const end = playSequence([
    { type: "response.created" },
    { type: "audio.delta" },
    { type: "transcript", transcript: "espera, cancela" },
    { type: "response.done" }
  ]);
  assert.equal(end.cancels, 1);
  assert.equal(end.playback, "cleared");
});

test("eventos fuera de orden no borran audio quieto", () => {
  const end = playSequence([
    { type: "response.done" },
    { type: "speech_started" },
    { type: "speech_stopped" },
    { type: "response.created" },
    { type: "audio.delta" }
  ]);
  assert.equal(end.clears, 0);
  assert.equal(end.playback, "playing");
});

test("una segunda respuesta no pisa la que suena", () => {
  const end = playSequence([
    { type: "response.created" },
    { type: "audio.delta" },
    { type: "response.created" },
    { type: "response.done" }
  ]);
  assert.equal(end.ignoredDuplicate, 1);
  assert.equal(end.generation, 1);
  assert.equal(end.playback, "finished");
});

test("disconnect y reconnect no dejan la respuesta cortada por ruido", () => {
  const end = playSequence([
    { type: "response.created" },
    { type: "disconnect" },
    { type: "reconnect" },
    { type: "speech_started" }
  ]);
  assert.equal(end.clears, 0);
  assert.equal(end.playback, "silent");
});

const sizes = ["mediana", "grande", "familiar"];
const bases = { mediana: 200, grande: 220, familiar: 250 };

for (let index = 0; index < 100; index += 1) {
  const size = sizes[index % 3];
  const extra = index % 2 === 0 ? "champinones" : "";
  const quantity = (index % 3) + 1;
  test(`confirmacion ${index}`, () => {
    const line = priceLine({ size, extra, quantity });
    const draft = {
      version: 1,
      customerName: "Ivan",
      orderType: "delivery",
      address: "Los Pablitos 13, San Pablo",
      postalCode: "83010",
      items: [{ size, extra, quantity, unit: line.unit }]
    };
    const spoken = buildConfirmation(draft);
    assert.equal(spoken.ok, true);
    assert.equal(spoken.total, bases[size] * quantity + (extra ? 25 * quantity : 0));
    assert.match(spoken.spoken, new RegExp(`Total ${spoken.total}`));
    assert.match(spoken.spoken, /83010/);
    const lied = buildConfirmation({ ...draft, claimedTotal: 1 });
    assert.equal(lied.ok, false);
    const wrongSize = buildConfirmation({
      ...draft,
      items: [{ size: "mediana", extra, quantity, unit: line.unit }]
    });
    if (size !== "mediana") {
      assert.equal(wrongSize.ok, false);
    }
  });
}

test("un cambio invalida la confirmacion anterior", () => {
  const draft = {
    version: 1,
    customerName: "Ivan",
    orderType: "pickup",
    items: [{ size: "mediana", extra: "champinones", quantity: 1, unit: 225 }]
  };
  const first = buildConfirmation(draft);
  assert.equal(first.total, 225);
  const revised = reviseDraft(draft, {
    items: [{ size: "mediana", extra: "", quantity: 1, unit: 200 }]
  });
  const stale = acceptSpoken(revised, first);
  assert.equal(stale.ok, false);
  const next = buildConfirmation(revised);
  assert.equal(next.total, 200);
  assert.equal(acceptSpoken(revised, next).ok, true);
});

test("dos create simultaneos del mismo call dejan un solo pedido", async () => {
  const saved = new Map();
  async function save(callId) {
    return withCallLock(callId, async () => {
      await new Promise(resolve => setTimeout(resolve, 15));
      if (saved.has(callId)) {
        return { already_saved: true, id: saved.get(callId) };
      }
      const id = `order-${saved.size + 1}`;
      saved.set(callId, id);
      return { already_saved: false, id };
    });
  }
  const [a, b] = await Promise.all([save("call-x"), save("call-x")]);
  const ids = new Set([a.id, b.id]);
  assert.equal(ids.size, 1);
  assert.equal([a, b].filter(item => item.already_saved).length, 1);
  const [c, d] = await Promise.all([save("call-y"), save("call-z")]);
  assert.notEqual(c.id, d.id);
  assert.equal(saved.size, 3);
});

test("precio y extra invalidos no confirman", () => {
  assert.equal(priceLine({ size: "mediana", extra: "trufa", quantity: 1 }).ok, false);
  assert.equal(priceLine({ size: "mediana", extra: "", quantity: 0 }).ok, false);
  assert.equal(priceLine({ size: "enorme", extra: "", quantity: 1 }).ok, false);
  assert.equal(buildConfirmation({
    customerName: "Ivan",
    orderType: "delivery",
    address: "",
    postalCode: "83010",
    items: [{ size: "grande", extra: "", quantity: 1, unit: 220 }]
  }).ok, false);
});
