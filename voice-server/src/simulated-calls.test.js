import assert from "node:assert/strict";
import test from "node:test";
import { orderedTurn } from "./call-flow.js";
import { deliveryAddress } from "./tools.js";
import { interruptionDecision } from "./turn-policy.js";

function play(lines, start = {}) {
  let state = { ...start };
  const said = [];
  for (const line of lines) {
    const turn = orderedTurn(state, line);
    state = turn.state;
    said.push(turn.say);
    assert.equal(turn.hangup, false);
    assert.doesNotMatch(turn.say, /opci[oó]n [abc1]/i);
    assert.doesNotMatch(turn.say, /d[eé]jame/i);
  }
  return { state, said };
}

test("simulacion 1 el nombre no pide la calle", () => {
  const call = play(["Ernesto"]);
  assert.equal(call.state.name, "Ernesto");
  assert.equal(call.said[0], "¿Qué desea ordenar?");
  assert.doesNotMatch(call.said[0], /calle/i);
});

test("simulacion 2 el precio de cualquier pizza son los tres tamaños", () => {
  const call = play(["Ernesto", "mexicana", "qué precio tiene"]);
  assert.match(call.said.at(-1), /200/);
  assert.match(call.said.at(-1), /220/);
  assert.match(call.said.at(-1), /250/);
});

test("simulacion 3 domicilio pide el codigo antes que la calle", () => {
  const call = play(["Octavio", "mexicana", "familiar", "no", "a domicilio"]);
  assert.equal(call.said.at(-1), "¿Cuál es el código postal?");
  assert.doesNotMatch(call.said.join(" "), /Privada|calle y número/i);
});

test("simulacion 4 montecarlo se queda como colonia", () => {
  const call = play(["Octavio", "mexicana", "familiar", "no", "domicilio", "83157", "Montecarlo"]);
  assert.equal(call.state.colony, "Montecarlo");
  assert.doesNotMatch(call.said.join(" "), /vocabulario/i);
});

test("simulacion 5 ciento 50 no es una calle", () => {
  assert.throws(
    () => deliveryAddress({ street: "ciento", number: "50", colony: "ISSSTE Federal", postalCode: "83157" }),
    /nombre de la calle/
  );
});

test("simulacion 6 el cierre pide un si antes de confirmar", () => {
  const call = play([
    "Ricardo.",
    "peperoni",
    "mediana",
    "no",
    "domicilio",
    "ochenta y tres ciento cincuenta y siete",
    "Issste Federal",
    "Lázaro Cárdenas número 1"
  ]);
  assert.equal(call.state.name, "Ricardo");
  assert.equal(call.state.postalCode, "83157");
  assert.match(call.said.at(-1), /Está de acuerdo/);
  const yes = play(["sí"], call.state);
  assert.equal(yes.state.agreed, true);
  assert.match(yes.said.at(-1), /confirmado con éxito/);
  assert.match(yes.said.at(-1), /30 minutos/);
});

test("simulacion 12 familias es familiar y veracruz cincuenta y seis es calle", () => {
  const sized = play(["familias"], { name: "Oscar", product: "Mexicana" });
  assert.equal(sized.state.size, "familiar");
  assert.match(sized.said.at(-1), /agregar algo más/i);
  const street = play(["Veracruz cincuenta y seis"], {
    name: "Oscar",
    product: "Mexicana",
    size: "familiar",
    offeredMore: true,
    fulfillment: "delivery",
    postalCode: "83010",
    colony: "Cinco de Mayo"
  });
  assert.match(street.state.street, /Veracruz/i);
  assert.equal(street.state.house, "56");
});

test("simulacion 13 sawayana es hawaiana y no repite para siempre", () => {
  const heard = play(["Ola Pista Sawayana"], { name: "Oscar" });
  assert.equal(heard.state.product, "Hawaina");
  let state = { name: "Oscar", product: "Mexicana" };
  let last = "";
  for (let i = 0; i < 3; i += 1) {
    const turn = orderedTurn(state, "que");
    state = turn.state;
    last = turn.say;
  }
  assert.equal(last, "Disculpe, lo transferiré con un humano.");
});

test("simulacion 11 si se enoja transfiere a un humano", () => {
  const call = play(["ya te lo dije tres veces"], { name: "Ricardo", postalCode: "" });
  assert.equal(call.said[0], "Disculpe, lo transferiré con un humano.");
});

test("simulacion 7 recoger no pide direccion", () => {
  const call = play(["Ana", "deluxe", "grande", "no", "recoger"]);
  assert.match(call.said.at(-1), /recoger/);
  assert.doesNotMatch(call.said.at(-1), /código postal/);
});

test("simulacion 8 si el cliente habla mientras ella habla se calla", () => {
  const decision = interruptionDecision({ event: "speech_started", assistantSpeaking: true });
  assert.equal(decision.cancelResponse, true);
  assert.equal(decision.clearPlayback, true);
});

test("simulacion 9 agregar una pizza no borra la anterior", () => {
  const call = play(["quisiera agregar otra pizza en el mismo pedido"], { name: "Ernesto", product: "mexicana" });
  assert.match(call.said[0], /se quedan/);
});

test("simulacion 10 la hawaiana apagada no se vende", () => {
  const call = play(["Luis", "una pizza hawaiana"], { unavailable: ["Hawaina"] });
  assert.match(call.said.at(-1), /no está disponible/);
});
