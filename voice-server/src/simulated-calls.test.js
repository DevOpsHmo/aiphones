import assert from "node:assert/strict";
import test from "node:test";
import { correctHeard, heardFulfillment, inventedHeard, looksLikeQuestion, matchPizza, orderedTurn, speakPostal, spokenExistingOrder } from "./call-flow.js";
import { deliveryAddress, kitchenClosedMessage, matchDrinkProduct, postalFromColony } from "./tools.js";
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
  assert.equal(call.state.name, "");
  assert.match(call.said[0], /Su nombre es Ernesto/);
  assert.doesNotMatch(call.said[0], /calle/i);
  const yes = play(["sí"], call.state);
  assert.equal(yes.state.name, "Ernesto");
  assert.equal(yes.said[0], "¿Qué desea ordenar?");
});

test("simulacion 2 el precio de cualquier pizza son los tres tamaños", () => {
  const call = play(["Ernesto", "sí", "mexicana", "qué precio tiene"]);
  assert.match(call.said.at(-1), /200/);
  assert.match(call.said.at(-1), /220/);
  assert.match(call.said.at(-1), /250/);
});

test("simulacion 3 domicilio pide el codigo antes que la calle", () => {
  const call = play(["Octavio", "sí", "mexicana", "familiar", "no", "a domicilio"]);
  assert.equal(call.said.at(-1), "¿Cuál es el código postal?");
  assert.doesNotMatch(call.said.join(" "), /Privada|calle y número/i);
});

test("simulacion 4 una colonia que no corresponde no se guarda", () => {
  const call = play(["Octavio", "sí", "mexicana", "familiar", "no", "domicilio", "83157", "Montecarlo"]);
  assert.equal(call.state.colony, "");
  assert.match(call.said.at(-1), /no corresponde|otra vez la colonia/i);
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
    "sí",
    "peperoni",
    "mediana",
    "no",
    "domicilio",
    "ochenta y tres ciento cincuenta y siete",
    "Issste Federal",
    "Lázaro Cárdenas número 1",
    "sí",
    "no"
  ]);
  assert.equal(call.state.name, "Ricardo");
  assert.equal(call.state.postalCode, "83157");
  assert.match(call.said.at(-1), /alguna duda/);
  assert.match(call.said.at(-2), /bebida o soda/);
  const yes = play(["no"], call.state);
  assert.equal(yes.state.agreed, true);
  assert.match(yes.said.at(-1), /tu pedido quedó confirmado/);
  assert.match(yes.said.at(-1), /30 minutos/);
  assert.match(yes.said.at(-1), /Muchas gracias por llamar a Pizzería Hermosillo/);
});

test("simulacion 15 dos pizzas se confirman juntas y la calle queda sin puntos", () => {
  const call = play([
    "Ivan Valencia",
    "sí",
    "una pizza hawaiana",
    "familiar",
    "y una pizza de pepperoni mediana",
    "no",
    "a domicilio",
    "83280",
    "Colonia San Pablo.",
    "Pablitos . 13",
    "sí",
    "no"
  ]);
  assert.equal(call.state.items[0].product, "Hawaina");
  assert.equal(call.state.items[0].size, "familiar");
  assert.equal(call.state.product, "Peperoni");
  assert.equal(call.state.size, "mediana");
  assert.match(call.said.at(-1), /alguna duda/);
  assert.doesNotMatch(call.state.street, /\./);
  assert.doesNotMatch(call.state.colony, /colonia/i);
});

test("simulacion 12 familias es familiar y veracruz cincuenta y seis es calle", () => {
  const sized = play(["familias"], { name: "Oscar", product: "Mexicana" });
  assert.equal(sized.state.size, "familiar");
  assert.match(sized.said.at(-1), /agregar algo más/i);
  const street = play(["Veracruz cincuenta y seis", "sí"], {
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
  let transferred = false;
  for (let i = 0; i < 3; i += 1) {
    const turn = orderedTurn(state, "que");
    state = turn.state;
    last = turn.say;
    transferred = turn.transfer === true;
  }
  assert.match(last, /no le oí|mediana, grande o familiar/i);
  assert.equal(transferred, false);
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

test("simulacion 11 si se enoja sigue con el pedido", () => {
  const call = play(["ya te lo dije tres veces"], { name: "Ricardo", postalCode: "" });
  assert.doesNotMatch(call.said[0], /humano|comunico/i);
  assert.match(call.said[0], /ordenar|pizza|mediana/i);
});

test("simulacion 7 recoger no pide direccion", () => {
  const call = play(["Ana", "sí", "deluxe", "grande", "no", "recoger"]);
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
  assert.equal(sized.state.street, "Veracruz");
  assert.equal(sized.state.postalCode, "83010");
  assert.match(sized.say, /alguna duda/);
  const again = orderedTurn(sized.state, "no");
  assert.equal(again.save, true);
  assert.match(again.say, /tu pedido quedó confirmado/);
  assert.match(again.say, /30 minutos/);
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
  assert.match(info.say, /Qué desea ordenar|mediana, grande o familiar/);
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

test("simulacion 18 que trae lee la pizza y el extra no la cambia", () => {
  const info = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    descriptions: { Mexicana: "Jalapeños, chorizo, tocino, cebolla y frijoles." }
  }, "¿Qué trae?");
  assert.match(info.say, /chorizo/i);
  assert.notEqual(info.transfer, true);
  const order = orderedTurn({ name: "Ana" }, "una pizza mexicana con extra de pepperoni");
  assert.equal(order.state.product, "Mexicana");
  assert.ok((order.state.extras || []).some(name => /pepperoni|peperoni/i.test(name)));
  assert.match(order.say, /Mexicana con extra de pepperoni/i);
  assert.match(order.say, /mediana, grande o familiar/);
  const drink = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    drink: { kind: "coca" }
  }, "regular");
  assert.match(drink.say, /600 mililitros/);
  assert.notEqual(drink.transfer, true);
  const repeated = orderedTurn(drink.state, "regular");
  assert.notEqual(repeated.say, drink.say);
});

test("simulacion 20 beneficio es el precio, light no es ligera y sin direccion no cierra", () => {
  assert.equal(correctHeard("¿Qué beneficio tiene?"), "¿Qué precio tienen?");
  assert.equal(correctHeard("¡Noins!"), "Luis");
  assert.equal(correctHeard("Iztacalco Federal"), "ISSSTE Federal");
  assert.equal(postalFromColony("Iztacalco Federal").colony, "ISSSTE Federal");
  assert.equal(postalFromColony("Iztacalco Federal").postalCode, "83157");
  assert.equal(inventedHeard("Provechito."), true);
  assert.equal(inventedHeard("¿Cuánto cuesta la familiar?"), false);
  const heardLuis = orderedTurn({}, correctHeard("¡Noins!"));
  assert.equal(heardLuis.state.guess.value, "Luis");
  assert.equal(orderedTurn(heardLuis.state, "sí").state.name, "Luis");
  const price = orderedTurn({
    name: "Alfredo",
    product: "Lucco Boneless",
    prices: { mediana: 199, grande: 219, familiar: 249 }
  }, "¿Qué beneficio tiene?");
  assert.match(price.say, /199/);
  assert.match(price.say, /219/);
  assert.match(price.say, /249/);
  assert.match(price.say, /mediana, grande o familiar/);
  const light = orderedTurn({
    name: "Alfredo",
    product: "Lucco Boneless",
    size: "familiar",
    sauce: "buffalo",
    offeredMore: true,
    drink: { kind: "coca" }
  }, "ligera");
  assert.equal(light.say, "Coca-Cola Light, ¿600 mililitros o 2 litros?");
  const skipped = orderedTurn({
    name: "Alfredo",
    product: "Lucco Boneless",
    size: "familiar",
    sauce: "buffalo",
    offeredMore: true,
    drink: { kind: "regular" }
  }, "No sería todo");
  assert.match(skipped.say, /600 mililitros/);
  assert.notEqual(skipped.save, true);
  const early = orderedTurn({
    name: "Alfredo",
    product: "Lucco Boneless",
    size: "familiar",
    sauce: "buffalo",
    offeredMore: true,
    drinkOffered: true,
    drink: { kind: "regular", volume: "600" }
  }, "no, sería todo");
  assert.notEqual(early.save, true);
  assert.match(early.say, /domicilio o para recoger/);
  const placed = orderedTurn({
    name: "Alfredo",
    product: "Lucco Boneless",
    size: "familiar",
    sauce: "buffalo",
    offeredMore: true,
    drinkOffered: true,
    drink: { kind: "regular", volume: "600" },
    fulfillment: "delivery",
    postalCode: "83010",
    colony: "Modelo",
    street: "Veracruz",
    house: "56",
    closingAsked: true
  }, "no");
  assert.equal(placed.save, true);
  assert.match(placed.say, /Su orden es una pizza familiar de boneless con búfalo y una Coca-Cola regular de 600 mililitros/);
  assert.match(placed.say, /tu pedido quedó confirmado/);
  assert.match(placed.say, /30 minutos/);
  assert.match(placed.say, /Muchas gracias por llamar a Pizzería Hermosillo/);
});

test("simulacion 21 el habla de hermosillo usa las mismas frases", () => {
  assert.equal(heardFulfillment("pa'llevar"), "pickup");
  assert.equal(heardFulfillment("para llevar"), "pickup");
  assert.equal(heardFulfillment("pa'l jale"), "delivery");
  assert.equal(heardFulfillment("me lo manda pa'l jale"), "delivery");
  const price = orderedTurn({ name: "Ana", product: "Mexicana" }, "¿Cuánto sale?");
  assert.match(price.say, /Mediana/);
  assert.match(price.say, /grande/);
  const timing = orderedTurn({ name: "Ana", product: "Mexicana" }, "¿En cuánto?");
  assert.match(timing.say, /familiar/);
  const how = orderedTurn({ name: "Ana" }, "¿A cómo?");
  assert.match(how.say, /Mediana/);
  const menu = orderedTurn({ name: "Ana" }, "¿Qué manejan?");
  assert.match(menu.say, /Tenemos/);
  assert.match(menu.say, /Hawaina/);
  assert.equal(menu.state.product, "");
  const listed = orderedTurn({ name: "Ana" }, "¿Qué hay?");
  assert.match(listed.say, /Peperoni/);
  const info = orderedTurn({
    name: "Ana",
    descriptions: { Hawaina: "Jamón y piña." }
  }, "¿Qué trae la hawaiana?");
  assert.match(info.say, /Jamón y piña/);
  const carry = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    drinkOffered: true
  }, "pa'llevar");
  assert.equal(carry.state.fulfillment, "pickup");
  const work = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    drinkOffered: true
  }, "mándamelo pa'l jale");
  assert.equal(work.state.fulfillment, "delivery");
  assert.match(work.say, /código postal/);
  const unnamed = orderedTurn({}, "¿Qué hay?");
  assert.match(unnamed.say, /Tenemos/);
  assert.equal(unnamed.state.name, "");
});

test("simulacion 19 fuera de horario avisa que estan cerrados", () => {
  const noon = new Date("2026-09-30T19:00:00Z");
  const night = new Date("2026-10-01T06:00:00Z");
  assert.equal(kitchenClosedMessage({ openTime: "11:00", closeTime: "22:00", now: noon }), "");
  const closed = kitchenClosedMessage({ openTime: "11:00", closeTime: "22:00", now: night });
  assert.match(closed, /estamos cerrados/);
  assert.match(closed, /las once de la mañana/);
  assert.match(closed, /las diez de la noche/);
  assert.match(closed, /Que tengas buen día/);
  assert.equal(kitchenClosedMessage({ openTime: "", closeTime: "", now: night }), "");
});

test("simulacion 22 la promo de dos grandes pide cada sabor y no se traga la pregunta", () => {
  const asked = orderedTurn({ name: "Roberto" }, "¿Qué promociones tiene el día de hoy?");
  assert.match(asked.say, /dos familiares por 450/);
  assert.match(asked.say, /dos grandes por 400/);
  assert.equal(asked.state.product, "");
  const again = orderedTurn(asked.state, "¿Qué promociones tienes el día de hoy?");
  assert.match(again.say, /400/);
  const promo = orderedTurn(again.state, "Dos grandes, una promoción de dos grandes a domicilio.");
  assert.equal(promo.state.fulfillment, "delivery");
  assert.equal(promo.state.pairNeed, 2);
  assert.match(promo.say, /De qué sabor quiere la primera/);
  const first = orderedTurn(promo.state, "boneless");
  assert.match(first.say, /barbiquiú o búfalo/);
  const sauce = orderedTurn(first.state, "búfalo");
  assert.match(sauce.say, /segunda/);
  assert.equal(sauce.state.items[0].product, "Lucco Boneless");
  const second = orderedTurn(sauce.state, "una tejicana");
  assert.equal(second.state.product, "Mexicana");
  assert.match(second.say, /agregar algo más/i);
  const both = orderedTurn(promo.state, "Hacer una de boneless y una tejicana");
  assert.equal(both.state.pendingSecond, "Mexicana");
  assert.match(both.say, /barbiquiú o búfalo/);
  const echo = orderedTurn({ name: "Roberto", product: "Mexicana", size: "grande" }, "ISSSTE Federal, Modelo, Hermosillo, mediana, grande, familiar, Light, Coca-Cola, boneless, barbiquiú, búfalo, domicilio, colonia, precio");
  assert.equal(echo.state.product, "Mexicana");
  assert.equal(echo.state.size, "grande");
  assert.match(echo.say, /no le oí/);
  const stray = orderedTurn({ name: "Roberto", product: "Mexicana", size: "grande" }, "Modelo");
  assert.equal(stray.state.product, "Mexicana");
  assert.equal(stray.state.colony || "", "");
  const own = orderedTurn(second.state, "¿de qué son mis pizzas?");
  assert.match(own.say, /boneless/);
  assert.match(own.say, /Mexicana/);
  const more = orderedTurn({
    ...second.state,
    offeredMore: true,
    drinkOffered: true,
    fulfillment: "delivery",
    postalCode: "83010",
    colony: "ISSSTE Federal",
    street: "Lázaro Cárdenas",
    house: "1",
    closingAsked: true
  }, "No es todo.");
  assert.notEqual(more.save, true);
  assert.match(more.say, /agregar/);
  const done = orderedTurn(more.state, "Es todo, muchas gracias.");
  assert.equal(done.save, true);
  assert.match(done.say, /tu pedido quedó confirmado/);
  assert.match(done.say, /30 minutos/);
  assert.match(done.say, /Mexicana/);
});

test("simulacion 23 preguntas frecuentes no se tragan el pedido", () => {
  const price = orderedTurn({ name: "Ana", prices: { mediana: 180, grande: 210, familiar: 240 } }, "¿Cuánto cuesta la grande?");
  assert.equal(price.say, "La grande cuesta 210. ¿Qué desea ordenar?");
  assert.equal(price.state.product, "");
  const sizes = orderedTurn({ name: "Ana" }, "¿Cuántas rebanadas trae la familiar?");
  assert.match(sizes.say, /mediana, grande y familiar/);
  const time = orderedTurn({ name: "Ana", product: "Mexicana", size: "grande" }, "¿Cuánto tarda el domicilio?");
  assert.match(time.say, /30 minutos/);
  assert.equal(time.state.product, "Mexicana");
  const ship = orderedTurn({ name: "Ana" }, "¿Cuánto cobran de envío?");
  assert.match(ship.say, /no tiene costo extra/);
  const pay = orderedTurn({ name: "Ana" }, "¿Aceptan tarjeta?");
  assert.match(pay.say, /efectivo/);
  const hours = orderedTurn({ name: "Ana", openTime: "11:00", closeTime: "22:00" }, "¿A qué hora cierran?");
  assert.match(hours.say, /diez de la noche/);
  const promo = orderedTurn({ name: "Ana" }, "¿Hay 2x1?");
  assert.match(promo.say, /no tenemos dos por uno/);
  assert.match(promo.say, /dos grandes por 400/);
  const half = orderedTurn({ name: "Ana" }, "¿Puedo pedir mitad y mitad?");
  assert.match(half.say, /mitad y mitad/);
  assert.match(half.say, /dos sabores/);
  assert.doesNotMatch(half.say, /No armamos/);
  const drinks = orderedTurn({ name: "Ana" }, "¿Tienen Pepsi?");
  assert.match(drinks.say, /no lo manejamos/i);
  const menu = orderedTurn({ name: "Ana" }, "¿Qué pizzas tienen?");
  assert.match(menu.say, /Hawaina/);
  assert.equal(menu.state.product, "");
  const order = orderedTurn(price.state, "Quiero una grande de pepperoni");
  assert.equal(order.state.product, "Peperoni");
  assert.equal(order.state.size, "grande");
});

test("simulacion 24 mediana no es promo y devolver es boneless", () => {
  const mediana = orderedTurn({ name: "Luis" }, "Quiero una promoción de dos pizzas medianas.");
  assert.match(mediana.say, /No hay promoción de dos pizzas medianas/);
  assert.match(mediana.say, /dos grandes por 400/);
  assert.equal(mediana.state.pairNeed, undefined);
  const familiar = orderedTurn({ name: "Luis" }, "Quiero promoción de dos pizzas familiares.");
  assert.match(familiar.say, /dos pizzas familiares por 450/);
  assert.doesNotMatch(familiar.say, /familiars/);
  assert.match(familiar.say, /primera/);
  const flavor = orderedTurn(familiar.state, "Devolver");
  assert.equal(flavor.state.product, "Lucco Boneless");
  assert.match(flavor.say, /barbiquiú o búfalo/);
  const again = orderedTurn(familiar.state, "Bueno");
  assert.match(again.say, /no le oí/);
  assert.match(again.say, /sabor/);
});

test("simulacion 25 alfonso no guarda seria todo como colonia y todo cierra", () => {
  const redonda = orderedTurn({ name: "Alfonso" }, "Una pizza redonda.");
  assert.match(redonda.say, /Tenemos mexicana, peperoni y deluxe/);
  assert.doesNotMatch(redonda.say, /No manejamos/);
  assert.equal(redonda.state.product, "");
  const ready = {
    name: "Alfonso",
    product: "Lucco Boneless",
    size: "familiar",
    sauce: "buffalo",
    offeredMore: true,
    drinkOffered: true,
    drink: { kind: "regular", volume: "2 litros" },
    fulfillment: "delivery",
    postalCode: "83157"
  };
  const colony = orderedTurn(ready, "Sería todo.");
  assert.equal(colony.state.colony || "", "");
  assert.match(colony.say, /colonia cuál es/);
  assert.notEqual(colony.save, true);
  const placed = {
    ...ready,
    colony: "ISSSTE Federal",
    street: "Lázaro Cárdenas",
    house: "1",
    closingAsked: true
  };
  const hola = orderedTurn(placed, "Hola, todo.");
  assert.equal(hola.save, true);
  assert.equal(hola.state.product, "Lucco Boneless");
  assert.equal(hola.state.colony, "ISSSTE Federal");
  assert.equal(hola.state.street, "Lázaro Cárdenas");
  assert.match(hola.say, /Su orden es/);
  assert.match(hola.say, /tu pedido quedó confirmado/);
  assert.match(hola.say, /30 minutos/);
  const yes = orderedTurn(placed, "Sí, es todo.");
  assert.equal(yes.save, true);
  const thanks = orderedTurn({ ...placed, closingAsked: false }, "Sí, muchas gracias.");
  assert.equal(thanks.save, true);
  assert.match(thanks.say, /Muchas gracias por llamar a Pizzería Hermosillo/);
});

test("simulacion 26 una duda se contesta y hola no es pregunta", () => {
  const chilo = orderedTurn({ name: "Alfonso", product: "Mexicana" }, "¿Está chilo?");
  assert.equal(chilo.answered, true);
  assert.match(chilo.say, /peperoni, hawaiana y mexicana/);
  assert.equal(chilo.state.product, "Mexicana");
  assert.equal(looksLikeQuestion("¿Hola?"), false);
  assert.equal(looksLikeQuestion("¿Tienen mesas afuera?"), true);
});

test("simulacion 27 una pregunta desconocida no se guarda como nombre ni colonia", () => {
  const named = orderedTurn({}, "¿Tienen mesas afuera?");
  assert.equal(named.state.name || "", "");
  assert.match(named.say, /nombre/);
  const colony = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    fulfillment: "delivery",
    postalCode: "83157"
  }, "¿Tienen mesas afuera?");
  assert.equal(colony.state.colony || "", "");
  assert.match(colony.say, /colonia/);
  assert.notEqual(colony.save, true);
});

test("simulacion 28 lo mal oido se confirma antes de anotarlo", () => {
  const pizza = orderedTurn({ name: "Ana" }, "voungles");
  assert.equal(pizza.state.product || "", "");
  assert.match(pizza.say, /¿Acaso se refiere a la pizza boneless\?/);
  const yes = orderedTurn(pizza.state, "Sí");
  assert.equal(yes.state.product, "Lucco Boneless");
  assert.match(yes.say, /mediana, grande o familiar/);
  const rejected = orderedTurn(pizza.state, "No");
  assert.equal(rejected.state.product || "", "");
  assert.match(rejected.say, /Qué desea ordenar/);
  const noise = orderedTurn({ name: "Ana" }, "xyzxyzxyz");
  assert.doesNotMatch(noise.say, /Acaso se refiere/);
  assert.match(noise.say, /Qué desea ordenar/);
  const size = orderedTurn({ name: "Ana", product: "Mexicana" }, "famiar");
  assert.equal(size.state.size || "", "");
  assert.match(size.say, /¿Acaso se refiere a familiar\?/);
  const colony = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    fulfillment: "delivery",
    postalCode: "83190"
  }, "modalo");
  assert.equal(colony.state.colony || "", "");
  assert.match(colony.say, /¿Acaso se refiere a la colonia Modelo\?/);
  const postal = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    fulfillment: "delivery"
  }, "ochenta y tres ciento cincuenta y site");
  assert.equal(postal.state.postalCode || "", "");
  assert.match(postal.say, /¿Acaso se refiere al código ochenta y tres ciento cincuenta y siete\?/);
  const accepted = orderedTurn(postal.state, "Sí");
  assert.equal(accepted.state.postalCode, "83157");
  const wrongCode = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    fulfillment: "delivery"
  }, "83999");
  assert.equal(wrongCode.state.postalCode || "", "");
  assert.match(wrongCode.say, /número por número/);
  const saidColony = orderedTurn({
    name: "Ana",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    fulfillment: "delivery"
  }, "modalo");
  assert.equal(saidColony.state.colony || "", "");
  assert.match(saidColony.say, /¿Acaso se refiere a la colonia Modelo\?/);
});

test("simulacion 29 la promo se pide sin decir que no esta y mexicana no transfiere", () => {
  const ask = orderedTurn({ name: "Carlos" }, "¿Qué promociones tienes el día de hoy?");
  assert.equal(ask.answered, true);
  assert.match(ask.say, /familiares por 450/);
  const promo = orderedTurn(ask.state, "Deme la promoción de dos familiares.");
  assert.equal(promo.answered, true);
  assert.equal(promo.state.pairNeed, 2);
  assert.match(promo.say, /dos pizzas familiares por 450/);
  assert.match(promo.say, /sabor quiere la primera/);
  assert.notEqual(promo.transfer, true);
  const again = orderedTurn(promo.state, "Sí, pues dame la promoción de esas de dos pizzas familiares");
  assert.equal(again.answered, true);
  assert.match(again.say, /sabor quiere la primera/);
  assert.doesNotMatch(again.say, /no le oí/);
  assert.notEqual(again.transfer, true);
  assert.equal(correctHeard("Necesitamos."), "Mexicana");
  const flavor = orderedTurn(again.state, "Necesitamos.");
  assert.equal(flavor.state.items[0].product, "Mexicana");
  assert.equal(flavor.state.items[0].size, "familiar");
  assert.match(flavor.say, /segunda/);
  assert.notEqual(flavor.transfer, true);
});

test("simulacion 30 luisa pide el pedido y mande repite la pregunta", () => {
  const named = orderedTurn({}, "Luisa.");
  assert.equal(named.state.name, "");
  assert.match(named.say, /Su nombre es Luisa/);
  const accepted = orderedTurn(named.state, "sí");
  assert.equal(accepted.state.name, "Luisa");
  assert.equal(accepted.say, "¿Qué desea ordenar?");
  const again = orderedTurn(accepted.state, "¿Mande?");
  assert.equal(again.answered, true);
  assert.equal(again.say, "¿Qué desea ordenar?");
  assert.equal(again.state.name, "Luisa");
  assert.notEqual(again.transfer, true);
});

test("simulacion 31 la mitad no borra la primera pizza ni la calle es una pizza", () => {
  let turn = orderedTurn({ name: "Oscar" }, "Dame una promoción de dos grandes.");
  assert.match(turn.say, /primera/);
  turn = orderedTurn(turn.state, "Mexicana");
  assert.equal(turn.state.items[0].product, "Mexicana");
  assert.equal(turn.state.items[0].size, "grande");
  turn = orderedTurn(turn.state, "Mitad hawaiana y mitad pepperoni.");
  assert.equal(turn.state.items[0].product, "Mexicana");
  assert.equal(turn.state.half, "mitad Hawaina y mitad Peperoni");
  assert.match(turn.say, /bebida/);
  const street = orderedTurn({
    name: "Oscar",
    product: "Hawaina",
    half: "mitad Hawaina y mitad Peperoni",
    size: "grande",
    items: [{ product: "Mexicana", size: "grande", sauce: "", extras: [] }],
    offeredMore: true,
    drink: { kind: "regular", volume: "2 litros" },
    fulfillment: "delivery",
    postalCode: "83157",
    colony: "ISSSTE Federal"
  }, "Para la pizza número uno");
  assert.equal(street.state.street || "", "");
  assert.match(street.say, /calle y el número/);
  const postal = orderedTurn({
    name: "Oscar",
    product: "Mexicana",
    size: "grande",
    offeredMore: true,
    fulfillment: "delivery"
  }, "Ocho veintitrés ciento cincuenta y siete");
  assert.match(postal.say, /número por número/);
  assert.equal(postal.state.postalCode || "", "");
});

test("simulacion 32 la mitad se anota y el numero se oye completo", () => {
  const named = orderedTurn({}, "Hola, ¿de Divo?");
  assert.equal(named.state.name || "", "");
  assert.equal(named.answered, true);
  assert.match(named.say, /nombre/);
  assert.doesNotMatch(named.say, /no está en el menú/);
  const half = orderedTurn({
    name: "Francisco",
    product: "Mexicana",
    size: "familiar",
    offeredMore: true
  }, "Hey, ¿puedes hacer la pizza mitad mexicana y mitad pepperoni, por favor?");
  assert.equal(half.answered, true);
  assert.equal(half.state.half, "mitad Mexicana y mitad Peperoni");
  assert.equal(half.state.product, "Mexicana");
  assert.match(half.say, /Anoté una pizza familiar mitad Mexicana y mitad Peperoni/);
  assert.match(half.say, /bebida/);
  assert.doesNotMatch(half.say, /no está en el menú|No armamos|domicilio/);
  const street = orderedTurn({
    name: "Francisco",
    product: "Mexicana",
    half: "mitad Mexicana y mitad Peperoni",
    size: "familiar",
    offeredMore: true,
    drinkOffered: true,
    fulfillment: "delivery",
    postalCode: "83157",
    colony: "ISSSTE Federal"
  }, "Calle Benito Juárez número dos cinco nueve.");
  assert.equal(street.state.street || "", "");
  assert.equal(street.state.guess || null, null);
  assert.match(street.say, /no está en ISSSTE Federal/);
  assert.match(street.say, /ciento cuarenta/);
  const again = orderedTurn(street.state, "Calle Benito Juárez número dos cinco nueve.");
  assert.equal(again.state.guess.extra, "259");
  assert.equal(again.state.guess.value, "Benito Juárez");
  assert.match(again.say, /doscientos cincuenta y nueve/);
  assert.match(again.say, /código ochenta y tres ciento cincuenta y siete/);
  const yes = orderedTurn(again.state, "Sí.");
  assert.equal(yes.state.house, "259");
  assert.equal(yes.state.street, "Benito Juárez");
  const slow = orderedTurn(named.state, "Hello, good evening?");
  assert.match(slow.say, /despacio/);
});

test("simulacion 33 es correcto guarda la calle y la coca light no es de 2 litros", () => {
  const ingredients = orderedTurn({ name: "Roberto" }, "Disculpa, ¿me puedes decir qué trae la pizza?");
  assert.match(ingredients.say, /ingredientes/);
  assert.doesNotMatch(ingredients.say, /Qué desea ordenar/);
  const firma = orderedTurn(ingredients.state, "La firma.");
  assert.match(firma.say, /No tengo esa pizza/);
  assert.match(firma.say, /ingredientes/);
  const original = orderedTurn({ name: "Roberto" }, "¿Qué ingredientes tiene la original?");
  assert.match(original.say, /No tengo la pizza original/);
  const priced = orderedTurn({
    name: "Roberto",
    product: "Mexicana",
    half: "mitad Mexicana y mitad Sinaloense"
  }, "¿Qué precios tienen?");
  assert.match(priced.say, /Mitad Mexicana y mitad Sinaloense/);
  assert.doesNotMatch(priced.say, /^Mediana 200, grande 220 y familiar 250\. Mexicana,/);
  const street = orderedTurn({
    name: "Roberto",
    product: "Mexicana",
    half: "mitad Mexicana y mitad Sinaloense",
    size: "familiar",
    offeredMore: true,
    drink: { kind: "Light", volume: "600" },
    drinkOffered: true,
    fulfillment: "delivery",
    postalCode: "83010",
    colony: "5 de Mayo"
  }, "Veracruz cincuenta y ocho");
  assert.match(street.say, /cincuenta y ocho/);
  const yes = orderedTurn(street.state, "Es correcto.");
  assert.equal(yes.state.street, "Veracruz");
  assert.equal(yes.state.house, "58");
  const products = [
    { id: "a", name: "Coca-Cola 2 litros" },
    { id: "b", name: "Coca-Cola Light 600 ml" },
    { id: "c", name: "Coca-Cola 600 ml" }
  ];
  assert.equal(matchDrinkProduct(products, { kind: "Light", volume: "600" }).id, "b");
  assert.equal(matchDrinkProduct(products, { kind: "regular", volume: "600" }).id, "c");
  assert.equal(matchDrinkProduct(products, { kind: "regular", volume: "2 litros" }).id, "a");
});

test("simulacion 34 el estatus confirma el pedido y dice en camino", () => {
  const buenos = orderedTurn({}, "Buenos");
  assert.equal(buenos.state.name || "", "");
  assert.match(buenos.say, /nombre/);
  const asked = orderedTurn({}, "Hola, mi nombre es Roberto, hice un pedido hace poco y quisiera saber si le falta mucho.");
  assert.equal(asked.status, true);
  assert.equal(asked.state.name, "Roberto");
  const again = orderedTurn({ name: "Roberto" }, "Ya había hecho un pedido, pero quiero saber si le falta mucho.");
  assert.equal(again.status, true);
  assert.equal(spokenExistingOrder([{
    name: "Pizza mitad Mexicana y mitad Sinaloense",
    quantity: 1,
    notes: "familiar"
  }]), "una pizza familiar mitad Mexicana y mitad Sinaloense");
  const yes = orderedTurn({
    name: "Roberto",
    statusAsk: true,
    pendingStatus: "delivering"
  }, "Sí,");
  assert.match(yes.say, /en camino/);
  assert.match(yes.say, /10 minutos/);
  assert.equal(yes.state.statusAsk, false);
});

test("simulacion 10 la hawaiana apagada no se vende", () => {
  const call = play(["Luis", "sí", "una pizza hawaiana"], { unavailable: ["Hawaina"] });
  assert.match(call.said.at(-1), /no está disponible/);
});
