"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "../../lib/supabase/client";
import { descriptionHasIngredient, foldIngredient, ingredientDescription, ingredientLabel } from "../../lib/menu-ingredients";
import { loadSessionBusiness } from "../../lib/session-business";

type ProductRow = {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  available: boolean;
};

type IngredientRow = {
  id: string;
  business_id: string;
  name: string;
  available: boolean;
  extra_price?: number | null;
};

function PriceStep({
  name,
  value,
  onChange,
  allowEmpty = false
}: {
  name: string;
  value: string;
  onChange: (next: string) => void;
  allowEmpty?: boolean;
}) {
  const [text, setText] = useState(value);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) {
      setText(allowEmpty && value === "" ? "" : String(Math.max(0, Number(value) || 0)));
    }
  }, [value, allowEmpty]);

  function commit(next: string) {
    if (allowEmpty && String(next).trim() === "") {
      setText("");
      onChange("");
      return;
    }
    const clean = String(Math.max(0, Math.floor(Number(next) || 0)));
    setText(clean);
    onChange(clean);
  }

  const shown = Math.max(0, Number(text) || 0);

  return (
    <div className="price-step">
      <button type="button" aria-label="Bajar precio" onClick={() => commit(String(Math.max(0, shown - 1)))}>
        −
      </button>
      <span className="price-step-amount">
        $
        <input
          id={name}
          name={name}
          aria-label="Precio"
          autoComplete="off"
          inputMode="numeric"
          value={text}
          onFocus={() => {
            editing.current = true;
          }}
          onChange={event => setText(event.target.value.replace(/\D/g, ""))}
          onBlur={() => {
            editing.current = false;
            commit(text);
          }}
        />
      </span>
      <button type="button" aria-label="Subir precio" onClick={() => commit(String(shown + 1))}>
        +
      </button>
    </div>
  );
}

function PencilButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="menu-edit" aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" />
        <path d="M13.5 6.5l3 3" />
      </svg>
    </button>
  );
}

function TrashButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="menu-delete" aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16" />
        <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
        <path d="M7.2 7.5 8 19.2A1.5 1.5 0 0 0 9.5 20.5h5a1.5 1.5 0 0 0 1.5-1.3l.8-11.7" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    </button>
  );
}

function IngredientPicker({
  ingredients,
  picked,
  onChange
}: {
  ingredients: IngredientRow[];
  picked: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    function close(event: MouseEvent) {
      const node = document.getElementById("pizza-ingredients");
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  function toggle(name: string) {
    onChange(picked.includes(name) ? picked.filter(item => item !== name) : [...picked, name]);
  }

  return (
    <div className={`ingredient-picker${open ? " is-open" : ""}`} id="pizza-ingredients">
      <button type="button" className="ingredient-picker-trigger" onClick={() => setOpen(current => !current)}>
        {picked.length === 0 ? "Ingredientes" : picked.map(ingredientLabel).join(", ")}
      </button>
      {open && (
        <ul className="ingredient-picker-menu">
          {ingredients.filter(ingredient => ingredient.name !== "queso").map(ingredient => {
            const selected = picked.includes(ingredient.name);
            return (
              <li key={ingredient.id}>
                <button
                  type="button"
                  className={selected ? "is-picked" : ""}
                  onClick={() => toggle(ingredient.name)}
                >
                  <span />
                  {ingredientLabel(ingredient.name)}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const DRINK_SIZES = [
  "235 ml",
  "355 ml",
  "500 ml",
  "600 ml",
  "1 litro",
  "1.5 litros",
  "2 litros",
  "2.5 litros",
  "3 litros"
];

const PIZZA_SIZES = ["mediana", "grande", "familiar"] as const;

const WEEKDAYS = [
  ["lun", "Lunes"],
  ["mar", "Martes"],
  ["mie", "Miércoles"],
  ["jue", "Jueves"],
  ["vie", "Viernes"],
  ["sab", "Sábado"],
  ["dom", "Domingo"]
] as const;

function promoDayKeys(description: string) {
  const match = String(description || "").match(/\[\[dias:([a-z,]*)\]\]/);
  return match ? match[1].split(",").filter(Boolean) : [];
}

function withoutPromoDays(description: string) {
  return String(description || "").replace(/\s*\[\[dias:[a-z,]*\]\]\s*/g, " ").replace(/\s+/g, " ").trim();
}

function withPromoDays(description: string, days: string[]) {
  const clean = withoutPromoDays(description);
  const unique = WEEKDAYS.map(([key]) => key).filter(key => days.includes(key));
  if (!unique.length || unique.length === WEEKDAYS.length) {
    return clean;
  }
  return `${clean}${clean ? " " : ""}[[dias:${unique.join(",")}]]`;
}

function promoActiveToday(description: string) {
  const days = promoDayKeys(description);
  if (!days.length) {
    return true;
  }
  const short = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Hermosillo",
    weekday: "short"
  }).format(new Date());
  const today: Record<string, string> = {
    Sun: "dom",
    Mon: "lun",
    Tue: "mar",
    Wed: "mie",
    Thu: "jue",
    Fri: "vie",
    Sat: "sab"
  };
  return days.includes(today[short] || "");
}

function DayPicker({
  days,
  onChange
}: {
  days: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = days.length ? days : WEEKDAYS.map(([key]) => key);
  const label = selected.length === WEEKDAYS.length
    ? "Todos los días"
    : WEEKDAYS.filter(([key]) => selected.includes(key)).map(([, name]) => name).join(", ");

  useEffect(() => {
    if (!open) {
      return;
    }
    function close(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className={`ingredient-picker day-picker${open ? " is-open" : ""}`} ref={rootRef}>
      <button type="button" className="ingredient-picker-trigger" onClick={() => setOpen(current => !current)}>
        {label}
      </button>
      {open && (
        <ul className="ingredient-picker-menu">
          {WEEKDAYS.map(([key, name]) => {
            const picked = selected.includes(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={picked ? "is-picked" : ""}
                  onClick={() => {
                    const next = picked ? selected.filter(day => day !== key) : [...selected, key];
                    onChange(next.length ? next : [...selected]);
                  }}
                >
                  <span />
                  {name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MenuSelect({
  name,
  value,
  options,
  onChange
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find(option => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={`menu-select${open ? " is-open" : ""}`} ref={rootRef}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        className="menu-select-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(currentOpen => !currentOpen)}
      >
        {current?.label || "Elegir"}
      </button>
      {open && (
        <ul className="menu-select-menu" role="listbox">
          {options.map(option => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? "is-active" : ""}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Switch({
  on,
  label,
  onClick
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`menu-switch${on ? " is-on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
    >
      <span />
    </button>
  );
}

export default function MenuBoard({
  query,
  toastSlot
}: {
  query: string;
  toastSlot: HTMLElement | null;
}) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"Pizzas" | "Bebidas" | "Ingrediente" | "Promociones">("Pizzas");
  const [price, setPrice] = useState("30");
  const [picked, setPicked] = useState<string[]>([]);
  const [volume, setVolume] = useState(DRINK_SIZES[3]);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [promoKind, setPromoKind] = useState<"pizzas" | "combo">("pizzas");
  const [promoCount, setPromoCount] = useState("2");
  const [promoSize, setPromoSize] = useState<(typeof PIZZA_SIZES)[number]>("grande");
  const [comboDrink, setComboDrink] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [toast, setToast] = useState("");
  const [savingPrices, setSavingPrices] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "product"; item: ProductRow } | { kind: "ingredient"; item: IngredientRow } | null
  >(null);
  const [editing, setEditing] = useState<
    | { kind: "product"; id: string; name: string; description: string; price: string; pizza: boolean; promo: boolean; days: string[] }
    | { kind: "ingredient"; id: string; name: string; extraPrice: string }
    | null
  >(null);
  const [sizePrices, setSizePrices] = useState({
    mediana: "200",
    grande: "220",
    familiar: "250",
    extra: "25",
    promo_pair: "400"
  });

  const load = useCallback(async () => {
    const supabase = createClient();
    const business = await loadSessionBusiness(supabase);
    if (business?.id) {
      setBusinessId(business.id);
    }

    let productsQuery = supabase
      .from("products")
      .select("id,business_id,name,description,category,price,available")
      .order("category")
      .order("name");
    if (business?.id) {
      productsQuery = productsQuery.eq("business_id", business.id);
    }
    const { data: productRows, error: productError } = await productsQuery;
    if (productError) {
      setError(productError.message);
      return;
    }

    let ingredientsQuery = supabase
      .from("menu_ingredients")
      .select("id,business_id,name,available,extra_price")
      .order("name");
    if (business?.id) {
      ingredientsQuery = ingredientsQuery.eq("business_id", business.id);
    }
    let { data: ingredientRows, error: ingredientError } = await ingredientsQuery;
    if (ingredientError && /extra_price|PGRST204/i.test(ingredientError.message)) {
      let fallback = supabase
        .from("menu_ingredients")
        .select("id,business_id,name,available")
        .order("name");
      if (business?.id) {
        fallback = fallback.eq("business_id", business.id);
      }
      const retry = await fallback;
      ingredientRows = (retry.data || []).map(row => ({ ...row, extra_price: null }));
      ingredientError = retry.error;
    }
    if (ingredientError) {
      setError(
        /menu_ingredients|schema cache|PGRST205|42P01/i.test(ingredientError.message)
          ? "Falta la tabla de ingredientes. Pega supabase/migration_menu_ingredients.sql en Supabase."
          : ingredientError.message
      );
      setProducts((productRows || []) as ProductRow[]);
      return;
    }

    let settingsQuery = supabase
      .from("menu_settings")
      .select("mediana,grande,familiar,extra,promo_pair");
    if (business?.id) {
      settingsQuery = settingsQuery.eq("business_id", business.id);
    }
    const { data: settings } = await settingsQuery.maybeSingle();
    if (settings) {
      setSizePrices({
        mediana: String(settings.mediana),
        grande: String(settings.grande),
        familiar: String(settings.familiar),
        extra: String(settings.extra),
        promo_pair: String(settings.promo_pair)
      });
    }

    setError("");
    const rows = ((productRows || []) as ProductRow[]).map(product => {
      const pizza = product.category === "Pizzas" || /^pizza\b/i.test(product.name);
      if (!pizza) {
        return product;
      }
      const description = ingredientDescription(product.description || "");
      if (description === (product.description || "").trim()) {
        return product;
      }
      void supabase.from("products").update({ description }).eq("id", product.id);
      return { ...product, description };
    });
    setProducts(rows);
    setIngredients((ingredientRows || []) as IngredientRow[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

  function flashSaved() {
    setToast("Guardado");
    window.setTimeout(() => setToast(""), 1600);
  }

  function blockingIngredients(product: ProductRow) {
    if (!isPizza(product)) {
      return [];
    }
    return ingredients.filter(
      item => !item.available && descriptionHasIngredient(product.description || "", item.name)
    );
  }

  function productIsOffered(product: ProductRow) {
    if (product.category === "Promociones" && !promoActiveToday(product.description || "")) {
      return false;
    }
    return product.available && blockingIngredients(product).length === 0;
  }

  async function toggleProduct(product: ProductRow) {
    const missing = blockingIngredients(product);
    if (missing.length || (product.category === "Promociones" && !promoActiveToday(product.description || ""))) {
      return;
    }
    const supabase = createClient();
    const available = !product.available;
    setProducts(current =>
      current.map(item => (item.id === product.id ? { ...item, available } : item))
    );
    const { error: updateError } = await supabase
      .from("products")
      .update({ available })
      .eq("id", product.id);
    if (updateError) {
      setError(updateError.message);
      void load();
      return;
    }
    flashSaved();
  }

  async function toggleIngredient(ingredient: IngredientRow) {
    const supabase = createClient();
    const available = !ingredient.available;
    setIngredients(current =>
      current.map(item => (item.id === ingredient.id ? { ...item, available } : item))
    );
    const { error: updateError } = await supabase
      .from("menu_ingredients")
      .update({ available })
      .eq("id", ingredient.id);
    if (updateError) {
      setError(updateError.message);
      void load();
      return;
    }
    flashSaved();
  }

  async function addProduct(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId) {
      return;
    }
    if (category !== "Promociones" && !name.trim()) {
      return;
    }
    setSaving(true);
    const supabase = createClient();
    if (category === "Ingrediente") {
      const { error: insertError } = await supabase.from("menu_ingredients").insert({
        business_id: businessId,
        name: foldIngredient(name),
        available: true
      });
      setSaving(false);
      if (insertError) {
        setError(insertError.message);
        return;
      }
      setName("");
      flashSaved();
      void load();
      return;
    }
    const drinks = products.filter(item => item.category === "Bebidas");
    const drink = drinks.find(item => item.id === comboDrink) || drinks[0];
    let nextName = name.trim();
    let nextDescription = description.trim();
    if (category === "Pizzas") {
      if (!/^pizza\b/i.test(nextName)) {
        nextName = `Pizza ${nextName}`;
      }
      nextDescription = picked.map(ingredientLabel).join(", ");
    }
    if (category === "Bebidas") {
      nextDescription = volume;
    }
    const sizePlural = promoSize === "familiar" ? "familiares" : `${promoSize}s`;
    if (category === "Promociones" && promoKind === "pizzas") {
      nextName = `${promoCount} ${sizePlural}`;
      nextDescription = `${promoCount} pizzas ${sizePlural}`;
    }
    if (category === "Promociones" && promoKind === "combo") {
      if (!drink) {
        setSaving(false);
        setError("Agrega una bebida antes de armar el combo.");
        return;
      }
      const sizeLabel = promoSize.charAt(0).toUpperCase() + promoSize.slice(1);
      const drinkLabel = `${drink.name}${drink.description ? ` ${drink.description}` : ""}`;
      nextName = `${sizeLabel} y ${drinkLabel}`;
      nextDescription = `1 pizza ${promoSize} y ${drinkLabel}`;
    }
    const nextPrice = category === "Pizzas" ? 0 : Number(price);
    const { error: insertError } = await supabase.from("products").insert({
      business_id: businessId,
      name: nextName,
      description: nextDescription,
      category,
      price: nextPrice,
      available: true
    });
    setSaving(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    setDescription("");
    setPicked([]);
    flashSaved();
    void load();
  }

  async function deleteProduct(product: ProductRow) {
    const supabase = createClient();
    const flavor = isPizza(product) ? pizzaFlavor(product.name) : "";
    const targets = flavor
      ? products.filter(item => isPizza(item) && pizzaFlavor(item.name) === flavor)
      : [product];
    const removed: string[] = [];
    for (const item of targets) {
      const { data, error: deleteError } = await supabase
        .from("products")
        .delete()
        .eq("id", item.id)
        .select("id");
      if (deleteError) {
        setError(
          /foreign key|violates/i.test(deleteError.message)
            ? `${item.name} ya está en un pedido. Apágala en lugar de borrarla.`
            : /policy|42501/i.test(deleteError.message)
              ? "Falta el permiso de borrar. Pega supabase/migration_menu_delete.sql en Supabase."
              : deleteError.message
        );
        break;
      }
      if (!data?.length) {
        setError("Falta el permiso de borrar. Pega supabase/migration_menu_delete.sql en Supabase.");
        break;
      }
      removed.push(item.id);
    }
    if (removed.length) {
      setProducts(current => current.filter(item => !removed.includes(item.id)));
    }
  }

  async function deleteIngredient(ingredient: IngredientRow) {
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("menu_ingredients")
      .delete()
      .eq("id", ingredient.id);
    if (deleteError) {
      setError(
        /policy|42501/i.test(deleteError.message)
          ? "Falta el permiso de borrar. Pega supabase/migration_menu_delete.sql en Supabase."
          : deleteError.message
      );
      return;
    }
    setIngredients(current => current.filter(item => item.id !== ingredient.id));
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing || !editing.name.trim() || savingEdit) {
      return;
    }
    setSavingEdit(true);
    const supabase = createClient();
    if (editing.kind === "ingredient") {
      const nextName = foldIngredient(editing.name);
      const typed = editing.extraPrice.trim();
      const extraPrice = typed === "" ? null : Number(typed);
      const { error: updateError } = await supabase
        .from("menu_ingredients")
        .update({
          name: nextName,
          extra_price: extraPrice != null && Number.isFinite(extraPrice) ? extraPrice : null
        })
        .eq("id", editing.id);
      if (updateError) {
        setError(
          /extra_price|schema cache|PGRST204/i.test(updateError.message)
            ? "Falta el precio por ingrediente. Pega supabase/migration_ingredient_extra_price.sql en Supabase."
            : updateError.message
        );
        setSavingEdit(false);
        return;
      }
      setIngredients(current =>
        current.map(item => (
          item.id === editing.id
            ? { ...item, name: nextName, extra_price: extraPrice != null && Number.isFinite(extraPrice) ? extraPrice : null }
            : item
        ))
      );
      setSavingEdit(false);
      setEditing(null);
      flashSaved();
      return;
    }
    const nextPrice = Number(editing.price);
    const { error: updateError } = await supabase
      .from("products")
      .update({
        name: editing.name.trim(),
        description: editing.promo
          ? withPromoDays(editing.description, editing.days)
          : editing.description.trim(),
        ...(editing.pizza ? {} : { price: Number.isFinite(nextPrice) ? nextPrice : 0 })
      })
      .eq("id", editing.id);
    if (updateError) {
      setError(updateError.message);
      setSavingEdit(false);
      return;
    }
    setProducts(current =>
      current.map(item =>
        item.id === editing.id
          ? {
              ...item,
              name: editing.name.trim(),
              description: editing.promo
                ? withPromoDays(editing.description, editing.days)
                : editing.description.trim(),
              price: editing.pizza ? item.price : Number.isFinite(nextPrice) ? nextPrice : 0
            }
          : item
      )
    );
    setSavingEdit(false);
    setEditing(null);
    flashSaved();
  }

  function isPizza(product: ProductRow) {
    if (product.category === "Promociones") {
      return false;
    }
    return product.category === "Pizzas" || /^pizza\b/i.test(product.name);
  }

  function mentionsPizzaSize(name: string) {
    return /\b(?:medianas?|grandes?|familiares?|chicas?|individuales?|\d+\s*pulgadas|pulgadas)\b/i.test(name);
  }

  function pizzaFlavor(name: string) {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/peperoni/g, "pepperoni")
      .replace(/\b(?:medianas?|grandes?|familiares?|chicas?|individuales?|\d+\s*pulgadas|pulgadas|pizza|de)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function menuProducts() {
    const chosen = new Map<string, ProductRow>();
    const others: ProductRow[] = [];
    for (const product of products) {
      if (!isPizza(product)) {
        others.push(product);
        continue;
      }
      const key = pizzaFlavor(product.name);
      const current = chosen.get(key);
      if (!current) {
        chosen.set(key, product);
        continue;
      }
      const currentSized = mentionsPizzaSize(current.name);
      const nextSized = mentionsPizzaSize(product.name);
      if (currentSized && !nextSized) {
        chosen.set(key, product);
      } else if (currentSized === nextSized && product.name.length < current.name.length) {
        chosen.set(key, product);
      }
    }
    return [...others, ...chosen.values()];
  }

  async function savePrices(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId || savingPrices) {
      return;
    }
    setSavingPrices(true);
    window.dispatchEvent(new Event("kitchen-spin"));
    const supabase = createClient();
    const row = {
      business_id: businessId,
      mediana: Number(sizePrices.mediana),
      grande: Number(sizePrices.grande),
      familiar: Number(sizePrices.familiar),
      extra: Number(sizePrices.extra),
      promo_pair: Number(sizePrices.promo_pair)
    };
    const { error: saveError } = await supabase
      .from("menu_settings")
      .upsert(row, { onConflict: "business_id" });
    setError(
      saveError
        ? /menu_settings|schema cache|PGRST205|42P01/i.test(saveError.message)
          ? "Falta la tabla de precios. Pega supabase/migration_menu_prices.sql en Supabase."
          : saveError.message
        : ""
    );
    setSavingPrices(false);
    if (!saveError) {
      flashSaved();
    }
  }

  const listed = menuProducts();

  return (
    <div className="menu-board">
      {error && <p className="menu-error">{error}</p>}
      <div className="menu-top">
      <section className="menu-panel menu-prices-panel">
        <h2>Precios</h2>
        <form className="menu-form menu-prices" onSubmit={savePrices}>
          {([
            ["mediana", "Mediana"],
            ["grande", "Grande"],
            ["familiar", "Familiar"],
            ["extra", "Extra"]
          ] as const).map(([key, label]) => (
            <div className="price-field" key={key}>
              <span>{label}</span>
              <PriceStep
                name={`price-${key}`}
                value={sizePrices[key]}
                onChange={next => setSizePrices(current => ({ ...current, [key]: next }))}
              />
            </div>
          ))}
          <button type="submit" className={`menu-save${savingPrices ? " is-busy" : ""}`} disabled={savingPrices}>
            <span className="menu-save-label">Guardar precios</span>
            {savingPrices && <span className="menu-save-spin" aria-hidden="true" />}
          </button>
        </form>
      </section>
      <section className="menu-panel">
        <h2>Agregar</h2>
        <form className="menu-form" onSubmit={addProduct}>
          <MenuSelect
            name="product-category"
            value={category}
            onChange={next => setCategory(next as typeof category)}
            options={[
              { value: "Pizzas", label: "Pizza" },
              { value: "Bebidas", label: "Bebida" },
              { value: "Ingrediente", label: "Ingrediente" },
              { value: "Promociones", label: "Promoción" }
            ]}
          />
          {category !== "Promociones" && (
            <input
              name="product-name"
              placeholder="Nombre"
              value={name}
              onChange={event => setName(event.target.value)}
              required
            />
          )}
          {category === "Pizzas" && (
            <IngredientPicker ingredients={ingredients} picked={picked} onChange={setPicked} />
          )}
          {category === "Bebidas" && (
            <>
              <MenuSelect
                name="drink-volume"
                value={volume}
                onChange={setVolume}
                options={DRINK_SIZES.map(size => ({ value: size, label: size }))}
              />
              <PriceStep name="product-price" value={price} onChange={setPrice} />
            </>
          )}
          {category === "Promociones" && (
            <>
              <MenuSelect
                name="promo-kind"
                value={promoKind}
                onChange={next => setPromoKind(next as "pizzas" | "combo")}
                options={[
                  { value: "pizzas", label: "Varias pizzas" },
                  { value: "combo", label: "Pizza y bebida" }
                ]}
              />
              {promoKind === "pizzas" ? (
                <div className="menu-split">
                  <MenuSelect
                    name="promo-count"
                    value={promoCount}
                    onChange={setPromoCount}
                    options={[
                      { value: "2", label: "2" },
                      { value: "3", label: "3" },
                      { value: "4", label: "4" }
                    ]}
                  />
                  <MenuSelect
                    name="promo-size"
                    value={promoSize}
                    onChange={next => setPromoSize(next as (typeof PIZZA_SIZES)[number])}
                    options={PIZZA_SIZES.map(size => ({
                      value: size,
                      label: size.charAt(0).toUpperCase() + size.slice(1)
                    }))}
                  />
                </div>
              ) : (
                <MenuSelect
                  name="promo-size"
                  value={promoSize}
                  onChange={next => setPromoSize(next as (typeof PIZZA_SIZES)[number])}
                  options={PIZZA_SIZES.map(size => ({
                    value: size,
                    label: size.charAt(0).toUpperCase() + size.slice(1)
                  }))}
                />
              )}
              {promoKind === "combo" && (
                <MenuSelect
                  name="promo-drink"
                  value={comboDrink}
                  onChange={setComboDrink}
                  options={products
                    .filter(item => item.category === "Bebidas")
                    .map(item => ({
                      value: item.id,
                      label: `${item.name}${item.description ? ` ${item.description}` : ""}`
                    }))}
                />
              )}
              <PriceStep name="product-price" value={price} onChange={setPrice} />
            </>
          )}
          <button type="submit" className={`menu-save${saving ? " is-busy" : ""}`} disabled={saving || !businessId}>
            <span className="menu-save-label">Agregar</span>
            {saving && <span className="menu-save-spin" aria-hidden="true" />}
          </button>
        </form>
      </section>
      </div>
      {([
        ["Pizzas", listed.filter(item => isPizza(item))],
        ["Bebidas", listed.filter(item => item.category === "Bebidas")],
        ["Promociones", listed.filter(item => item.category === "Promociones")]
      ] as const).map(([title, rows]) => {
        const needle = query.trim().toLowerCase();
        const visible = rows.filter(item => item.name.toLowerCase().includes(needle));
        if (needle && visible.length === 0) {
          return null;
        }
        return (
          <section key={title}>
            <h2>{title === "Promociones" ? "Promociones" : title}</h2>
            {title === "Promociones" && rows.length === 0 ? (
              <p className="menu-empty">Todavía no hay promociones.</p>
            ) : (
              <ul className="menu-list menu-products">
                {visible.map(product => (
                  <li
                    key={product.id}
                    className={productIsOffered(product) ? "" : "is-off"}
                    onClick={() =>
                      setEditing({
                        kind: "product",
                        id: product.id,
                        name: product.name,
                        description: withoutPromoDays(product.description || ""),
                        price: String(product.price),
                        pizza: isPizza(product),
                        promo: product.category === "Promociones",
                        days: promoDayKeys(product.description || "")
                      })
                    }
                  >
                    <div className="menu-card-name">
                      <strong>
                        {isPizza(product)
                          ? product.name
                              .replace(
                                /\b(?:medianas?|grandes?|familiares?|chicas?|individuales?|\d+\s*pulgadas|pulgadas)\b/gi,
                                " "
                              )
                              .replace(/\s+/g, " ")
                              .trim()
                          : product.name}
                      </strong>
                      {title === "Promociones" && <span className="menu-promo">Promo</span>}
                    </div>
                    {!isPizza(product) && (
                      <span className="menu-card-price">${Number(product.price)}</span>
                    )}
                    <div className="menu-row-actions" onClick={event => event.stopPropagation()}>
                      <Switch
                        on={productIsOffered(product)}
                        label={productIsOffered(product) ? `Apagar ${product.name}` : `Prender ${product.name}`}
                        onClick={() => toggleProduct(product)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {ingredients.some(ingredient =>
        ingredientLabel(ingredient.name).toLowerCase().includes(query.trim().toLowerCase())
      ) && (
      <section>
        <h2>Ingredientes</h2>
        <ul className="menu-list menu-ingredients">
          {ingredients.filter(ingredient =>
            ingredientLabel(ingredient.name).toLowerCase().includes(query.trim().toLowerCase())
          ).map(ingredient => (
            <li key={ingredient.id} className={ingredient.available ? "" : "is-off"}>
              <strong>{ingredientLabel(ingredient.name)}</strong>
              <div className="menu-row-actions">
              <PencilButton
                label={`Editar ${ingredientLabel(ingredient.name)}`}
                onClick={() =>
                  setEditing({
                    kind: "ingredient",
                    id: ingredient.id,
                    name: ingredientLabel(ingredient.name),
                    extraPrice: ingredient.extra_price == null ? "" : String(ingredient.extra_price)
                  })
                }
              />
              <TrashButton
                label={`Eliminar ${ingredientLabel(ingredient.name)}`}
                onClick={() => setPendingDelete({ kind: "ingredient", item: ingredient })}
              />
              <Switch
                on={ingredient.available}
                label={
                  ingredient.available
                    ? `Apagar ${ingredientLabel(ingredient.name)}`
                    : `Prender ${ingredientLabel(ingredient.name)}`
                }
                onClick={() => toggleIngredient(ingredient)}
              />
              </div>
            </li>
          ))}
        </ul>
      </section>
      )}
      {toast &&
        toastSlot &&
        createPortal(
          <p className="app-toast app-toast--success">{toast}</p>,
          toastSlot
        )}
      {editing && portalRoot && createPortal(
        <div className="notice-overlay" onClick={() => setEditing(null)}>
          <form
            className="notice-dialog menu-form"
            role="dialog"
            aria-label="Editar"
            onSubmit={saveEdit}
            onClick={event => event.stopPropagation()}
          >
            <h2>Editar</h2>
            <input
              name="edit-name"
              value={editing.name}
              onChange={event => setEditing({ ...editing, name: event.target.value })}
              required
            />
            {editing.kind === "ingredient" && (
              <label>
                Extra, vacío usa el general (${sizePrices.extra})
                <PriceStep
                  name="ingredient-extra-price"
                  allowEmpty
                  value={editing.extraPrice}
                  onChange={next => setEditing(current => (current && current.kind === "ingredient" ? { ...current, extraPrice: next } : current))}
                />
              </label>
            )}
            {editing.kind === "product" && (
              <textarea
                name="edit-description"
                placeholder="Descripción"
                rows={5}
                value={editing.description}
                onChange={event => setEditing({ ...editing, description: event.target.value })}
              />
            )}
            {editing.kind === "product" && !editing.pizza && (
              <PriceStep
                name="edit-price"
                value={editing.price}
                onChange={next => setEditing(current => (current && current.kind === "product" ? { ...current, price: next } : current))}
              />
            )}
            {editing.kind === "product" && editing.promo && (
              <DayPicker
                days={editing.days}
                onChange={days => setEditing(current => (current && current.kind === "product" ? { ...current, days } : current))}
              />
            )}
            <div className="notice-actions">
              {editing.kind === "product" && (
                <button
                  type="button"
                  className="notice-btn notice-btn-danger"
                  onClick={() => {
                    const product = products.find(item => item.id === editing.id);
                    if (product) {
                      setPendingDelete({ kind: "product", item: product });
                    }
                  }}
                >
                  Eliminar
                </button>
              )}
              <button type="button" className="notice-btn notice-btn-cancel" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button
                type="submit"
                className={`notice-btn notice-btn-save menu-save${savingEdit ? " is-busy" : ""}`}
                disabled={savingEdit}
              >
                <span className="menu-save-label">Guardar</span>
                {savingEdit && <span className="menu-save-spin" aria-hidden="true" />}
              </button>
            </div>
          </form>
        </div>,
        portalRoot
      )}
      {pendingDelete && portalRoot && createPortal(
        <div className="notice-overlay" onClick={() => setPendingDelete(null)}>
          <div
            className="notice-dialog"
            role="dialog"
            aria-label="Confirmar eliminación"
            onClick={event => event.stopPropagation()}
          >
            <h2>Eliminar</h2>
            <p>
              ¿Seguro que quieres eliminar{" "}
              {pendingDelete.kind === "product"
                ? pendingDelete.item.name
                : ingredientLabel(pendingDelete.item.name)}
              ?
            </p>
            <div className="notice-actions">
              <button type="button" className="notice-btn notice-btn-cancel" onClick={() => setPendingDelete(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="notice-btn notice-btn-danger"
                onClick={() => {
                  const pending = pendingDelete;
                  setPendingDelete(null);
                  setEditing(null);
                  if (pending.kind === "product") {
                    void deleteProduct(pending.item);
                  } else {
                    void deleteIngredient(pending.item);
                  }
                }}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>,
        portalRoot
      )}
    </div>
  );
}
