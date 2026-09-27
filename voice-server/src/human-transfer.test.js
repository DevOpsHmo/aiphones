import assert from "node:assert/strict";
import test from "node:test";
import {
  wantsHuman,
  requestTransfer,
  markTransferred,
  transferState,
  transferTwiml,
  maskNumber
} from "./human-transfer.js";
import { priceLine } from "./confirmation.js";

const yes = [
  "Quiero hablar con un humano",
  "Quiero hablar con una persona",
  "Pásame con alguien",
  "Quiero hablar con el encargado",
  "Comunícame con un agente",
  "Necesito hablar con alguien",
  "Me puede atender alguien",
  "Quiero que me atienda una persona",
  "Espera, quiero hablar con un humano"
];

for (const phrase of yes) {
  test(`transfiere ${phrase}`, () => {
    assert.equal(wantsHuman(phrase), true);
  });
}

for (const phrase of ["¿Cuánto cuesta?", "Quiero una pizza", "¿Qué tamaños tienen?", "Espera", "Repíteme eso", "Estoy escuchando", "Gracias", "eh", "otra persona"]) {
  test(`no transfiere ${phrase}`, () => {
    assert.equal(wantsHuman(phrase), false);
  });
}

test("el numero lo pone el servidor y se ignora otro", () => {
  const number = "+526621383780";
  const twiml = transferTwiml(number, "https://example.com/twilio/transfer-result");
  assert.match(twiml, /<Dial /);
  assert.match(twiml, /<Number>\+526621383780<\/Number>/);
  assert.doesNotMatch(twiml, /Hangup/);
  assert.equal(maskNumber(number), "5266******780");
  assert.throws(() => transferTwiml("+52911"));
  assert.throws(() => transferTwiml("911"));
});

test("una sola transferencia aunque llegue dos veces", () => {
  const first = requestTransfer("CA-test-1");
  const second = requestTransfer("CA-test-1");
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  markTransferred("CA-test-1");
  assert.equal(transferState("CA-test-1"), "TRANSFERRED");
  assert.equal(requestTransfer("CA-test-1").accepted, false);
});

test("pedir humano no cobra ni confirma el pedido", () => {
  assert.equal(wantsHuman("Quiero hablar con un humano"), true);
  assert.equal(priceLine({ size: "mediana", extra: "champinones", quantity: 1 }).subtotal, 225);
});
