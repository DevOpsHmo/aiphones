import assert from "node:assert/strict";
import test from "node:test";
import { priceLine, buildConfirmation, reviseDraft, acceptSpoken } from "./confirmation.js";
import { menuIngredients } from "./menu-ingredients.js";
import { nextReply } from "./call-flow.js";
import { mushroomIntent } from "./turn-policy.js";

test("los extras salen de las pizzas del menu", () => {
  const names = menuIngredients();
  assert.ok(names.includes("pina"));
  assert.ok(names.includes("jamon"));
  assert.ok(names.includes("cereza"));
  assert.equal(priceLine({ size: "mediana", extras: ["trufa"], quantity: 1 }).ok, false);
});

for (const [size, base] of [["mediana", 200], ["grande", 220], ["familiar", 250]]) {
  test(`base ${size}`, () => {
    const line = priceLine({ size, quantity: 1 });
    assert.equal(line.base, base);
    assert.equal(line.extrasTotal, 0);
    assert.equal(line.subtotal, base);
  });
  test(`un extra ${size}`, () => {
    const line = priceLine({ size, extra: "champinones", quantity: 1 });
    assert.equal(line.subtotal, base + 25);
    assert.deepEqual(line.extras, [{ nombre: "champinones", precio: 25 }]);
  });
}

test("repetir el mismo extra no lo cobra dos veces", () => {
  const line = priceLine({
    size: "mediana",
    extras: ["champinones", "champinones"],
    quantity: 1
  });
  assert.equal(line.extrasTotal, 25);
  assert.equal(line.subtotal, 225);
});

test("quitar champinones regresa al precio del tamano", () => {
  let state = { name: "Ivan", product: "Peperoni", size: "mediana", extra: "", quantity: 1, fulfillment: "pickup" };
  state = nextReply(state, "con champiñones").state;
  assert.equal(priceLine(state).subtotal, 225);
  state = nextReply(state, "sin champiñones").state;
  assert.equal(state.extra, "");
  assert.equal(priceLine({ ...state, extra: "" }).subtotal, 200);
});

test("cambiar tamano recalcula el extra", () => {
  let state = { name: "Ivan", product: "Peperoni", size: "mediana", extra: "champinones", quantity: 1, fulfillment: "pickup" };
  assert.equal(priceLine(state).subtotal, 225);
  state = nextReply(state, "mejor grande").state;
  assert.equal(priceLine(state).subtotal, 245);
  state = nextReply(state, "mejor familiar").state;
  assert.equal(priceLine(state).subtotal, 275);
});

test("la cantidad multiplica base mas extra", () => {
  let state = { name: "Ivan", product: "Peperoni", size: "mediana", extra: "champinones", quantity: 1, fulfillment: "pickup" };
  state = nextReply(state, "quiero dos").state;
  assert.equal(state.quantity, 2);
  assert.equal(priceLine(state).subtotal, 450);
  state = nextReply(state, "quiero tres").state;
  assert.equal(priceLine(state).subtotal, 675);
});

for (const phrase of [
  "con champiñones",
  "con extra de champiñones",
  "ponle champiñones extra",
  "con champiñones de más",
  "agrégale champiñones",
  "ponle extra champiñones"
]) {
  test(`frase ${phrase}`, () => {
    assert.equal(mushroomIntent(phrase), "add");
  });
}

for (const phrase of ["sin champiñones", "quítale los champiñones", "mejor sin champiñones", "no quiero champiñones"]) {
  test(`quita ${phrase}`, () => {
    assert.equal(mushroomIntent(phrase), "remove");
  });
}

test("pina jamon y cereza se suman", () => {
  const line = priceLine({
    size: "mediana",
    extras: ["piña", "jamón", "cerezas"],
    quantity: 1
  });
  assert.equal(line.extrasTotal, 75);
  assert.equal(line.subtotal, 275);
});

test("queso del menu si se cobra", () => {
  const reply = nextReply(
    { name: "Ivan", product: "Peperoni", size: "mediana", extra: "", extras: [], quantity: 1, fulfillment: "pickup" },
    "con extra queso y champiñones"
  );
  assert.equal(priceLine({ size: "mediana", extras: reply.state.extras, quantity: 1 }).subtotal, 250);
});

test("cambiar champinones pide aclaracion", () => {
  const reply = nextReply(
    { name: "Ivan", product: "Peperoni", size: "mediana", extra: "champinones", quantity: 1, fulfillment: "pickup" },
    "cambia los champiñones"
  );
  assert.equal(reply.state.extra, "champinones");
  assert.match(reply.say, /Agrego/);
});

test("confirmacion vieja muere al cambiar el pedido", () => {
  const draft = {
    version: 1,
    customerName: "Ivan",
    orderType: "pickup",
    items: [{ size: "mediana", extra: "champinones", quantity: 1, unit: 225 }]
  };
  const first = buildConfirmation(draft);
  assert.match(first.spoken, /Total 225/);
  const revised = reviseDraft(draft, {
    items: [{ size: "grande", extra: "champinones", quantity: 1, unit: 245 }]
  });
  assert.equal(acceptSpoken(revised, first).ok, false);
  const next = buildConfirmation(revised);
  assert.equal(next.total, 245);
  assert.match(next.spoken, /Total 245/);
});

for (const claimed of [1, 5, 100, 150]) {
  test(`precio inventado ${claimed}`, () => {
    const line = priceLine({ size: "familiar", extra: "champinones", quantity: 1 });
    assert.equal(line.subtotal, 275);
    const lied = buildConfirmation({
      version: 1,
      customerName: "Ivan",
      orderType: "pickup",
      claimedTotal: claimed,
      items: [{ size: "familiar", extra: "champinones", quantity: 1, unit: line.unit }]
    });
    assert.equal(lied.ok, false);
  });
}

for (const bad of [0, -1, 51, 100, 999]) {
  test(`cantidad rechazada ${bad}`, () => {
    assert.equal(priceLine({ size: "grande", quantity: bad }).ok, false);
  });
}
