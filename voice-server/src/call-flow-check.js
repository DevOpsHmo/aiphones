import { nextReply, MENU_PIZZAS } from "./call-flow.js";
import { parseSpokenPostalCode, checkAddressTool, priceWithMushrooms, readPostalCode, lineQuote, streetNumber } from "./tools.js";

const failures = [];

function expect(label, condition) {
  if (!condition) {
    failures.push(label);
  }
}

const firstNames = ["Ivan", "Ana", "Luis", "Diana", "Rosa", "Mario", "Elena", "Pablo", "Sofia", "Hector"];
const sizes = ["mediana", "grande", "familiar"];
const prices = { mediana: "200", grande: "220", familiar: "250" };

for (let index = 0; index < 100; index += 1) {
  const name = firstNames[index % firstNames.length];
  const size = sizes[index % sizes.length];
  const pizza = MENU_PIZZAS[index % MENU_PIZZAS.length];
  let state = {
    name: "Luis Silva",
    product: "",
    size: "",
    fulfillment: "",
    addressGiven: false,
    savedAddress: "Veracruz 56, 5 de Mayo, C.P. 83157",
    offeredSaved: false
  };

  if (index % 5 === 0) {
    const renamed = nextReply(state, `No soy Luis, soy ${name}`);
    expect(`${index} nombre`, renamed.state.name === name && renamed.hangup === false && /apellido/i.test(renamed.say));
    expect(`${index} no reinicia`, /pedido|peperoni|sigo/i.test(renamed.say) || renamed.state.product === state.product);
    state = renamed.state;
  }

  if (index % 5 === 1) {
    const menu = nextReply(state, "¿Qué sabores tienen?");
    expect(`${index} lista`, MENU_PIZZAS.every(item => menu.say.includes(item)));
    const missing = nextReply({ ...state, size: "mediana" }, "Peperoni y champiñones");
    expect(`${index} champiñones`, /subiría de 200 a 225/i.test(missing.say) && missing.state.extra === "champinones");
    const familiar = nextReply({ ...state, size: "familiar" }, "familiar de peperoni con champiñones");
    expect(`${index} familiar extra`, /subiría de 250 a 275/i.test(familiar.say));
  }

  const sized = nextReply(state, `Una pizza ${size} de ${pizza}`);
  expect(`${index} un tamaño`, sized.state.size === size);
  expect(`${index} no mezcla`, !(size === "familiar" && /grande|220/.test(sized.say) && /familiar/.test(sized.say) === false));
  if (size === "familiar") {
    expect(`${index} familiar solo`, !/\bgrande\b/.test(sized.say));
  }
  state = sized.state;

  const delivery = nextReply(state, "Domicilio");
  expect(`${index} domicilio`, delivery.state.fulfillment === "delivery");
  const again = nextReply(delivery.state, "Domicilio");
  expect(`${index} una vez`, !/domicilio o recoger/i.test(again.say));

  if (index % 4 === 0) {
    const dictated = nextReply({ ...delivery.state, addressGiven: false }, "colonia San Pablo calle Los Pablitos");
    expect(`${index} no ofrece guardada`, !/veracruz/i.test(dictated.say));
  }

  const summary = nextReply(state, "Repíteme el resumen");
  expect(`${index} resumen`, summary.hangup === false && summary.say.includes(state.name));

  const postal = parseSpokenPostalCode(
    index % 2 === 0
      ? "ochenta y tres ciento cincuenta y siete"
      : "ochenta y tres cero diez"
  );
  expect(`${index} cp`, postal === (index % 2 === 0 ? "83157" : "83010"));
}

const colony = await checkAddressTool({
  postalCode: "83010",
  street: "Veracruz 56",
  colony: "Cinco de Mayo"
});
expect("colonia", colony.colony === "5 de Mayo" && colony.colony_match === true);
expect("precio mediana", priceWithMushrooms("mediana").total === 225);
expect("precio grande", priceWithMushrooms("grande").total === 245);
expect("precio familiar", priceWithMushrooms("familiar").total === 275);

const postalCases = [
  ["ochenta y tres cero diez", "83010"],
  ["ocho tres cero uno cero", "83010"],
  ["ochenta y tres mil diez", "83010"],
  ["83 010", "83010"],
  ["83-010", "83010"],
  ["83010", "83010"],
  ["ochenta y tres ciento cincuenta y siete", "83157"],
  ["ocho tres uno cinco siete", "83157"],
  ["ochenta y tres mil ciento cincuenta y siete", "83157"],
  ["83157", "83157"]
];
for (const [said, expected] of postalCases) {
  expect(`cp ${said}`, parseSpokenPostalCode(said) === expected);
}

const ambiguous = readPostalCode("83157 ochenta y tres cero diez");
expect("cp ambiguo", ambiguous.code === "" && ambiguous.options.length > 1 && ambiguous.options.every(cp => /^\d{5}$/.test(cp)));

expect("doble cantidad", lineQuote({ size: "mediana", quantity: 2 }).total === 400);
expect("extra no cambia base", lineQuote({ size: "mediana", extra: "cebolla", quantity: 1 }).unit === 200);
expect("champi suma 25", lineQuote({ size: "grande", extra: "champinones", quantity: 1 }).total === 245);
for (const bad of [0, -1, 51, 1.5]) {
  let rejected = false;
  try {
    lineQuote({ size: "familiar", quantity: bad });
  } catch {
    rejected = true;
  }
  expect(`cantidad ${bad}`, rejected);
}

for (const said of ["Veracruz 56", "Veracruz #56", "Veracruz numero 56", "Veracruz cincuenta y seis", "calle Veracruz numero cincuenta y seis"]) {
  expect(`numero ${said}`, streetNumber(said) === "56");
}

if (failures.length) {
  console.error(failures.slice(0, 20).join("\n"));
  console.error(`${failures.length} casos fallaron`);
  process.exit(1);
}

console.log("100 casos coherentes");
console.log(prices.familiar);
