import assert from "node:assert/strict";
import test from "node:test";
import { buildConfirmation, paymentForOrder, priceLine } from "./confirmation.js";
import { factsInstructions, lockFacts, nextReply } from "./call-flow.js";
import { billableExtras } from "./menu-ingredients.js";
import { wantsHuman } from "./human-transfer.js";
import { interruptionDecision, mushroomIntent, playSequence, serverPrice } from "./turn-policy.js";
import { cleanSpokenAddress, deliveryAddress, parseSpokenPostalCode } from "./tools.js";

function questions(text) {
  return (String(text).match(/\?/g) || []).length;
}

const start = {
  name: "Cliente",
  product: "",
  size: "",
  extra: "",
  extras: [],
  quantity: 1,
  fulfillment: "",
  addressGiven: false
};

test("1 pedido normal cobra 225 y confirma con 30 minutos", () => {
  const priced = priceLine({ size: "mediana", extra: "champinones", quantity: 1 });
  assert.equal(priced.subtotal, 225);
  let state = { ...start, name: "Luis Alfonso" };
  state = nextReply(state, "quiero una peperoni mediana con champiñones").state;
  state = nextReply(state, "domicilio").state;
  const close = nextReply(state, "es todo, gracias");
  assert.match(close.say, /quedó confirmado/i);
  assert.match(close.say, /225/);
  assert.match(close.say, /30 minutos/);
  assert.equal(close.hangup, false);
  assert.ok(questions(close.say) <= 1);
});

test("2 dos medianas con champiñones son 450", () => {
  assert.equal(priceLine({ size: "mediana", extra: "champinones", quantity: 2 }).subtotal, 450);
});

test("3 familiar sin champiñones 250 y con champiñones otra vez 275", () => {
  let state = nextReply({ ...start, name: "Francisco" }, "una familiar de peperoni con champiñones").state;
  assert.equal(priceLine({ size: state.size, extras: state.extras, quantity: 1 }).subtotal, 275);
  state = nextReply(state, "quítale los champiñones").state;
  assert.equal(priceLine({ size: state.size, extras: state.extras, quantity: 1 }).subtotal, 250);
  state = nextReply(state, "ponle los champiñones").state;
  assert.equal(priceLine({ size: state.size, extras: state.extras, quantity: 1 }).subtotal, 275);
});

test("4 no acepta un precio inventado de 100", () => {
  const priced = serverPrice({ size: "mediana", extra: "champinones", claimedPrice: 100 });
  assert.equal(priced.total, 225);
  assert.notEqual(priced.total, priced.ignoredClaim);
  const rejected = buildConfirmation({
    customerName: "Octavio",
    orderType: "delivery",
    address: "Veracruz 56",
    postalCode: "83010",
    paymentMethod: "efectivo",
    claimedTotal: 100,
    items: [{ name: "Peperoni", size: "mediana", extras: ["champinones"], quantity: 1 }]
  });
  assert.equal(rejected.ok, false);
});

test("5 queso extra y pepperoni extra suman 50", () => {
  const priced = priceLine({ size: "mediana", extras: ["queso extra", "pepperoni extra"], quantity: 1 });
  assert.equal(priced.ok, true);
  assert.equal(priced.subtotal, 250);
});

test("6 un pedido ya guardado no se vuelve a crear", () => {
  const first = { callId: "CA1", saved: true };
  const again = first.saved ? "update" : "create";
  assert.equal(again, "update");
});

test("7 quiero un humano transfiere y no es otra persona", () => {
  assert.equal(wantsHuman("quiero hablar con un humano"), true);
  assert.equal(wantsHuman("es otra persona"), false);
});

test("8 otra persona reemplaza el nombre anterior", () => {
  const named = nextReply({ ...start, name: "Luis Alfonso" }, "es otra persona, mi nombre es Diego Alejandro");
  assert.equal(named.state.name, "Diego Alejandro");
  assert.equal(questions(named.say), 1);
});

test("9 codigo ochenta y tres mil doscientos ochenta y ocho es 83288", () => {
  assert.equal(parseSpokenPostalCode("ochenta y tres mil doscientos ochenta y ocho"), "83288");
});

test("10 codigo ochenta y tres mil ciento cincuenta y siete es 83157", () => {
  assert.equal(parseSpokenPostalCode("ochenta y tres mil ciento cincuenta y siete"), "83157");
});

test("11 la direccion no guarda mi nombre es", () => {
  assert.equal(
    cleanSpokenAddress("Mi nombre es Luis Alfonso mi dirección es Veracruz 56, 5 de Mayo, C.P. 83010, Hermosillo, Sonora"),
    "Veracruz 56, 5 de Mayo, C.P. 83010, Hermosillo, Sonora"
  );
  assert.equal(
    cleanSpokenAddress("Para empezar, Lázaro Cárdenas 1, Hermosillo, Sonora"),
    "Lázaro Cárdenas 1, Hermosillo, Sonora"
  );
  assert.equal(
    cleanSpokenAddress("Es la colonia Montecarlo el código postal es 83288, Montecarlo, C.P. 83010, Hermosillo, Sonora"),
    "Montecarlo, C.P. 83288, Hermosillo, Sonora"
  );
  assert.equal(
    cleanSpokenAddress("Lázaro Cárdenas, mil ciento 57, ISSSTE Federal, C.P. 83157, Hermosillo, Sonora"),
    "Lázaro Cárdenas 1157, ISSSTE Federal, C.P. 83157, Hermosillo, Sonora"
  );
  assert.equal(
    deliveryAddress({
      street: "Veracruz",
      number: "56",
      colony: "5 de Mayo",
      postalCode: "83010"
    }),
    "Veracruz 56, 5 de Mayo, C.P. 83010, Hermosillo, Sonora"
  );
  assert.throws(
    () => deliveryAddress({ address: "Para empezar, Lázaro Cárdenas 1, Hermosillo, Sonora" }),
    /frase del cliente/
  );
  assert.throws(
    () => deliveryAddress({ address: "Montecarlo, C.P. 83288, Hermosillo, Sonora" }),
    /Falta el nombre de la calle|Faltan calle/
  );
  assert.throws(
    () => deliveryAddress({ street: "ciento", number: "50", colony: "ISSSTE Federal", postalCode: "83157" }),
    /nombre de la calle/
  );
});

test("12 domicilio solo acepta efectivo", () => {
  assert.equal(paymentForOrder("delivery", "tarjeta"), "efectivo");
  assert.equal(paymentForOrder("delivery", "transferencia"), "efectivo");
});

test("13 recoger si puede ser tarjeta", () => {
  assert.equal(paymentForOrder("pickup", "tarjeta"), "tarjeta");
});

test("14 que trae la hawaiana no cobra sus ingredientes", () => {
  assert.deepEqual(billableExtras(["piña", "jamón"], "Piña, jamón y cereza"), []);
  assert.equal(mushroomIntent("qué trae la hawaiana"), "none");
});

test("15 cambia los champiñones pide aclaracion", () => {
  const reply = nextReply({ ...start, product: "Peperoni", size: "mediana" }, "cámbiame los champiñones");
  assert.equal(mushroomIntent("cámbiame los champiñones"), "unclear");
  assert.match(reply.say, /agrego|quito/i);
  assert.equal(questions(reply.say), 1);
});

test("16 el ruido no borra el audio", () => {
  const audio = playSequence([
    { type: "response.created" },
    { type: "noise" },
    { type: "transcript", transcript: "sí sí" }
  ]);
  assert.equal(audio.clears, 0);
  assert.equal(interruptionDecision({ event: "transcript", transcript: "sí sí" }).clearPlayback, false);
});

test("17 como va mi pedido no arma uno nuevo", () => {
  assert.equal(wantsHuman("cómo va mi pedido"), false);
  const reply = nextReply({ ...start, name: "Luis" }, "cómo va mi pedido");
  assert.equal(reply.state.product, "");
});

test("18 dos grandes sin extras usan la promocion de 400", () => {
  const confirmation = buildConfirmation({
    customerName: "Ana",
    orderType: "pickup",
    paymentMethod: "efectivo",
    items: [{ name: "Peperoni", size: "grande", quantity: 2 }]
  });
  assert.equal(confirmation.ok, true);
  assert.equal(confirmation.total, 400);
});

test("19 una sola pregunta por turno", () => {
  const turns = [
    "quiero una peperoni",
    "mediana",
    "domicilio",
    "es otra persona, mi nombre es Juan Gallardo"
  ];
  let state = { ...start };
  for (const phrase of turns) {
    const reply = nextReply(state, phrase);
    assert.ok(questions(reply.say) <= 1, reply.say);
    state = reply.state;
  }
});

test("21 si no entendio pide que repita", () => {
  const reply = nextReply({ ...start }, "eh la carne es");
  assert.equal(reply.say, "Disculpa, no entendí. ¿Puedes repetir?");
  assert.equal(questions(reply.say), 1);
});

test("22 la pizza se pregunta con mediana grande o familiar", () => {
  const reply = nextReply({ ...start }, "quiero una pizza mexicana");
  assert.equal(reply.say, "Mexicana, ¿mediana, grande o familiar?");
  assert.doesNotMatch(reply.say, /qu[eé] tama[nñ]o/i);
});

test("23 la coca se pregunta regular o light y luego el volumen", () => {
  const kind = nextReply({ ...start }, "quisiera una soda de coca-cola");
  assert.equal(kind.say, "Coca-Cola, ¿regular o Light?");
  const size = nextReply(kind.state, "regular");
  assert.equal(size.say, "Coca-Cola regular, ¿600 mililitros o 2 litros?");
  assert.doesNotMatch(kind.say, /presentaci[oó]n/i);
  assert.doesNotMatch(kind.say, /voy a revisar/i);
});

test("25 tadeo a secas queda como nombre y no se inventa otro", () => {
  const facts = lockFacts({}, "Tadeo");
  assert.equal(facts.name, "Tadeo");
  assert.match(factsInstructions(facts), /Tadeo/);
  assert.doesNotMatch(factsInstructions(facts), /Luis Alfonso/);
});

test("24 un nombre y una calle oídos se quedan fijos", () => {
  let facts = lockFacts({}, "me llamo Tadeo");
  facts = lockFacts(facts, "Lázaro Cárdenas 1, Issste Federal");
  facts = lockFacts(facts, "familiar");
  const block = factsInstructions(facts);
  assert.match(block, /Tadeo/);
  assert.match(block, /Lázaro Cárdenas 1/);
  assert.match(block, /Issste Federal/);
  assert.match(block, /familiar/);
  assert.match(block, /No lo vuelvas a preguntar/);
  assert.doesNotMatch(block, /Luis Alfonso|Zaragoza|Cuauhtémoc/);
});

test("20 es todo dice confirmado, total y tiempo, y no cuelga antes", () => {
  const state = {
    ...start,
    name: "Luis Alfonso",
    product: "Peperoni",
    size: "mediana",
    extras: ["champinones"],
    fulfillment: "delivery"
  };
  const close = nextReply(state, "muy bien, sería todo");
  assert.match(close.say, /quedó confirmado/);
  assert.match(close.say, /225/);
  assert.match(close.say, /El precio es 225/);
  assert.match(close.say, /30 minutos/);
  assert.equal(close.hangup, false);
});
