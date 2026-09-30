import assert from "node:assert/strict";
import test from "node:test";
import { correctHeard, heardFulfillment, matchPizza, orderedTurn, speakPostal } from "./call-flow.js";
import { deliveryAddress, postalFromColony } from "./tools.js";
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
    "Lázaro Cárdenas número 1",
    "no"
  ]);
  assert.equal(call.state.name, "Ricardo");
  assert.equal(call.state.postalCode, "83157");
  assert.match(call.said.at(-1), /Está de acuerdo/);
  assert.match(call.said.at(-2), /bebida o soda/);
  const yes = play(["sí"], call.state);
  assert.equal(yes.state.agreed, true);
  assert.match(yes.said.at(-1), /confirmado con éxito/);
  assert.match(yes.said.at(-1), /30 minutos/);
  assert.match(yes.said.at(-1), /Hasta pronto/);
});

test("simulacion 15 dos pizzas se confirman juntas y la calle queda sin puntos", () => {
  const call = play([
    "Ivan Valencia",
    "una pizza hawaiana",
    "familiar",
    "y una pizza de pepperoni mediana",
    "no",
    "a domicilio",
    "83280",
    "Colonia San Pablo.",
    "Pablitos . 13",
    "no"
  ]);
  assert.equal(call.state.items[0].product, "Hawaina");
  assert.equal(call.state.items[0].size, "familiar");
  assert.equal(call.state.product, "Peperoni");
  assert.equal(call.state.size, "mediana");
  assert.match(call.said.at(-1), /familiar de Hawaina/);
  assert.match(call.said.at(-1), /mediana de Peperoni/);
  assert.doesNotMatch(call.state.street, /\./);
  assert.doesNotMatch(call.state.colony, /colonia/i);
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
  assert.doesNotMatch(street.state.street, /cincuenta/i);
  assert.equal(street.state.house, "56");
  assert.equal(
    deliveryAddress({ street: "Veracruz cincuenta y seis", number: "56", colony: "Cinco de mayo", postalCode: "83010" }),
    "Veracruz 56, Cinco de mayo, C.P. 83010, Hermosillo, Sonora"
  );
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

test("simulacion 14 la coca se pregunta y domicilio mal oido cuenta", () => {
  const drink = play(["Sí, una Coca-Cola"], {
    name: "Iván Valencia",
    product: "Mexicana",
    size: "familiar",
    offeredMore: true
  });
  assert.equal(drink.said.at(-1), "Coca-Cola, ¿regular o Light?");
  const volume = play(["regular"], drink.state);
  assert.match(volume.said.at(-1), /600 mililitros/);
  const finished = play(["2 litros"], volume.state);
  assert.equal(heardFulfillment("Adomitridio"), "delivery");
  assert.equal(heardFulfillment("Aromofilia"), "delivery");
  const place = play(["Adomitridio"], finished.state);
  assert.equal(place.state.fulfillment, "delivery");
  assert.equal(place.said.at(-1), "¿Cuál es el código postal?");
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

test("simulacion 15 boneless mal oido, soda que no se repite y cancelar solo la bebida", () => {
  for (const said of ["una pizza de baules", "una pizza de doble", "Bajo", "una pizza de borde", "una pieza de baúl"]) {
    assert.equal(matchPizza(said), "Lucco Boneless");
  }
  assert.equal(correctHeard("Sí, una pizza de baules."), "Sí, una pizza de boneless");
  assert.equal(speakPostal("83010"), "ochenta y tres cero diez");
  const ready = {
    name: "Diego Alejandro",
    product: "Hawaina",
    size: "familiar",
    items: [{ product: "Lucco Boneless", size: "familiar", sauce: "bbq" }],
    offeredMore: true,
    fulfillment: "delivery",
    postalCode: "83010",
    colony: "Cinco de mayo",
    street: "Veracruz",
    house: "56",
    drinkOffered: true,
    drink: { kind: "regular" }
  };
  const sized = orderedTurn(ready, "Dos litros");
  assert.equal(sized.state.drink.volume, "2 litros");
  assert.match(sized.say, /ochenta y tres cero diez/);
  assert.match(sized.say, /Veracruz 56/);
  assert.match(sized.say, /Coca-Cola regular de 2 litros/);
  const again = orderedTurn(sized.state, "Sí");
  assert.equal(again.save, true);
  const stuck = orderedTurn(ready, "cancelala");
  assert.match(stuck.say, /todo el pedido o solo la bebida/);
  assert.equal(stuck.cancel, undefined);
  const dropped = orderedTurn(stuck.state, "solo la bebida");
  assert.match(dropped.say, /quité la bebida/);
  const whole = orderedTurn(stuck.state, "cancela todo el pedido");
  assert.equal(whole.cancel, true);
  assert.match(whole.say, /Hasta pronto/);
});

test("simulacion 16 bufalo se entiende, los ingredientes se leen y el precio sale del menu", () => {
  const first = orderedTurn({ name: "Oscar" }, "Una pizza de boneless búfalo tamaño familiar.");
  assert.equal(first.state.product, "Lucco Boneless");
  assert.equal(first.state.size, "familiar");
  assert.equal(first.state.sauce, "buffalo");
  assert.match(first.say, /agregar algo más/i);
  assert.doesNotMatch(first.say, /bbq|buffalo/i);
  const plain = orderedTurn({ name: "Oscar", product: "Lucco Boneless", size: "familiar" }, "Búfalo.");
  assert.equal(plain.state.sauce, "buffalo");
  assert.notEqual(plain.transfer, true);
  const info = orderedTurn({
    name: "Esteban",
    descriptions: { Sinaloense: "Chilorio, champiñones, cebolla y pimiento verde." }
  }, "¿Me puedes decir qué trae la pizza sinaloense?");
  assert.match(info.say, /Chilorio/);
  assert.doesNotMatch(info.say, /mediana/);
  const again = orderedTurn(info.state, "Sí, pero quiero saber los ingredientes de esa pizza.");
  assert.match(again.say, /Chilorio/);
  assert.notEqual(again.transfer, true);
  const price = orderedTurn({
    name: "Esteban",
    product: "Sinaloense",
    prices: { mediana: 180, grande: 210, familiar: 240 }
  }, "¿Cuánto cuestan?");
  assert.match(price.say, /180/);
  assert.match(price.say, /210/);
  assert.match(price.say, /240/);
  assert.doesNotMatch(price.say, /\b200\b/);
});

test("simulacion 17 sin codigo postal la colonia modelo completa el codigo", () => {
  const ready = {
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    fulfillment: "delivery"
  };
  const unknown = orderedTurn(ready, "no me se el codigo postal");
  assert.equal(unknown.say, "No te preocupes, dime qué colonia es");
  assert.equal(unknown.state.postalCode, "");
  const short = orderedTurn(ready, "no me lo se");
  assert.equal(short.say, "No te preocupes, dime qué colonia es");
  const colony = orderedTurn(unknown.state, "colonia modelo");
  assert.equal(colony.state.colony, "Modelo");
  assert.equal(colony.state.postalCode, "83190");
  assert.match(colony.say, /ochenta y tres ciento noventa/);
  assert.match(colony.say, /calle y el número/);
  assert.equal(postalFromColony("cinco de mayo").postalCode, "83010");
  assert.equal(postalFromColony("issste").postalCode, "83157");
  const several = orderedTurn(unknown.state, "Montecarlo");
  assert.match(several.say, /Hay más de una/);
  assert.equal(several.state.postalCode, "");
});

test("simulacion 10 la hawaiana apagada no se vende", () => {
  const call = play(["Luis", "una pizza hawaiana"], { unavailable: ["Hawaina"] });
  assert.match(call.said.at(-1), /no está disponible/);
});
