"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { foldIngredient, ingredientLabel, ingredientsFromText } from "../../lib/menu-ingredients";

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
};

function PriceStep({
  value,
  onChange
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const amount = Math.max(0, Number(value) || 0);
  return (
    <div className="price-step">
      <button type="button" aria-label="Bajar precio" onClick={() => onChange(String(Math.max(0, amount - 1)))}>
        −
      </button>
      <span>${amount}</span>
      <button type="button" aria-label="Subir precio" onClick={() => onChange(String(amount + 1))}>
        +
      </button>
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

export default function MenuBoard() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"Pizzas" | "Bebidas" | "Ingrediente" | "Promociones">("Pizzas");
  const [price, setPrice] = useState("30");
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [sizePrices, setSizePrices] = useState({
    mediana: "200",
    grande: "220",
    familiar: "250",
    extra: "25",
    promo_pair: "400"
  });

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: business } = await supabase
      .from("businesses")
      .select("id")
      .limit(1)
      .maybeSingle();
    if (business?.id) {
      setBusinessId(business.id);
    }

    const { data: productRows, error: productError } = await supabase
      .from("products")
      .select("id,business_id,name,description,category,price,available")
      .order("category")
      .order("name");
    if (productError) {
      setError(productError.message);
      return;
    }

    const { data: ingredientRows, error: ingredientError } = await supabase
      .from("menu_ingredients")
      .select("id,business_id,name,available")
      .order("name");
    if (ingredientError) {
      setError(
        /menu_ingredients|schema cache|PGRST205|42P01/i.test(ingredientError.message)
          ? "Falta la tabla de ingredientes. Pega supabase/migration_menu_ingredients.sql en Supabase."
          : ingredientError.message
      );
      setProducts((productRows || []) as ProductRow[]);
      return;
    }

    const { data: settings } = await supabase
      .from("menu_settings")
      .select("mediana,grande,familiar,extra,promo_pair")
      .limit(1)
      .maybeSingle();
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
    setProducts((productRows || []) as ProductRow[]);
    setIngredients((ingredientRows || []) as IngredientRow[]);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const off = new Set(
    ingredients.filter(item => !item.available).map(item => item.name)
  );

  async function toggleProduct(product: ProductRow) {
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
    }
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
    }
  }

  async function addProduct(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId || !name.trim()) {
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
      void load();
      return;
    }
    const pizzaDescription = picked.map(ingredientLabel).join(", ");
    const nextDescription = category === "Pizzas" ? pizzaDescription : description.trim();
    const nextPrice = category === "Pizzas" ? 0 : Number(price);
    const { error: insertError } = await supabase.from("products").insert({
      business_id: businessId,
      name: name.trim(),
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
    void load();
  }

  async function deleteProduct(product: ProductRow) {
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("products").delete().eq("id", product.id);
    if (deleteError) {
      setError(
        /foreign key|violates/i.test(deleteError.message)
          ? `${product.name} ya está en un pedido. Apágala en lugar de borrarla.`
          : /policy|42501/i.test(deleteError.message)
            ? "Falta el permiso de borrar. Pega supabase/migration_menu_delete.sql en Supabase."
            : deleteError.message
      );
      return;
    }
    setProducts(current => current.filter(item => item.id !== product.id));
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

  function isPizza(product: ProductRow) {
    return product.category === "Pizzas" || /^pizza\b/i.test(product.name);
  }

  async function savePrices(event: React.FormEvent) {
    event.preventDefault();
    if (!businessId) {
      return;
    }
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
  }

  async function saveProductPrice(product: ProductRow, nextPrice: string) {
    const amount = Number(nextPrice);
    if (!Number.isFinite(amount) || amount < 0) {
      return;
    }
    setProducts(current =>
      current.map(item => (item.id === product.id ? { ...item, price: amount } : item))
    );
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("products")
      .update({ price: amount })
      .eq("id", product.id);
    if (updateError) {
      setError(updateError.message);
    }
  }

  return (
    <div className="menu-board">
      {error && <p className="menu-error">{error}</p>}
      <div className="menu-top">
      <section>
        <h2>Precios</h2>
        <form className="menu-form menu-prices" onSubmit={savePrices}>
          {([
            ["mediana", "Mediana"],
            ["grande", "Grande"],
            ["familiar", "Familiar"],
            ["extra", "Extra"],
            ["promo_pair", "Dos grandes"]
          ] as const).map(([key, label]) => (
            <label key={key}>
              {label}
              <PriceStep
                value={sizePrices[key]}
                onChange={next => setSizePrices(current => ({ ...current, [key]: next }))}
              />
            </label>
          ))}
          <button type="submit">Guardar precios</button>
        </form>
      </section>
      <section>
        <h2>Agregar</h2>
        <form className="menu-form" onSubmit={addProduct}>
          <input
            name="product-name"
            placeholder="Nombre"
            value={name}
            onChange={event => setName(event.target.value)}
            required
          />
          <select
            name="product-category"
            value={category}
            onChange={event => setCategory(event.target.value as typeof category)}
          >
            <option value="Pizzas">Pizza</option>
            <option value="Bebidas">Bebida</option>
            <option value="Ingrediente">Ingrediente</option>
            <option value="Promociones">Promoción</option>
          </select>
          {category === "Pizzas" && (
            <select
              name="pizza-ingredients"
              multiple
              value={picked}
              onChange={event =>
                setPicked(Array.from(event.target.selectedOptions, option => option.value))
              }
            >
              {ingredients.map(ingredient => (
                <option key={ingredient.id} value={ingredient.name}>
                  {ingredientLabel(ingredient.name)}
                </option>
              ))}
            </select>
          )}
          {(category === "Bebidas" || category === "Promociones") && (
            <>
              <input
                name="product-description"
                placeholder="Descripción"
                value={description}
                onChange={event => setDescription(event.target.value)}
              />
              <PriceStep value={price} onChange={setPrice} />
            </>
          )}
          <button type="submit" disabled={saving || !businessId}>
            Agregar
          </button>
        </form>
      </section>
      </div>
      <section>
        <h2>Productos</h2>
        <ul className="menu-list menu-products">
          {products.map(product => {
            const missing = ingredientsFromText(product.description || "").filter(item =>
              off.has(item)
            );
            const sellable = product.available && missing.length === 0;
            return (
              <li key={product.id} className={sellable ? "" : "is-off"}>
                <div>
                  <strong>{product.name}</strong>
                  <p>{product.category || "Producto"}</p>
                  {product.description && <p>{product.description}</p>}
                  {missing.length > 0 && (
                    <p className="menu-blocked">
                      No se puede pedir: falta {missing.map(ingredientLabel).join(", ")}.
                    </p>
                  )}
                  {!isPizza(product) && (
                    <PriceStep
                      value={String(product.price)}
                      onChange={next => saveProductPrice(product, next)}
                    />
                  )}
                </div>
                <div className="menu-row-actions">
                <button
                  type="button"
                  className="menu-delete"
                  aria-label={`Eliminar ${product.name}`}
                  onClick={() => deleteProduct(product)}
                >
                  Eliminar
                </button>
                <Switch
                  on={product.available}
                  label={product.available ? `Apagar ${product.name}` : `Prender ${product.name}`}
                  onClick={() => toggleProduct(product)}
                />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2>Ingredientes</h2>
        <ul className="menu-list">
          {ingredients.map(ingredient => (
            <li key={ingredient.id} className={ingredient.available ? "" : "is-off"}>
              <strong>{ingredientLabel(ingredient.name)}</strong>
              <div className="menu-row-actions">
              <button
                type="button"
                className="menu-delete"
                aria-label={`Eliminar ${ingredientLabel(ingredient.name)}`}
                onClick={() => deleteIngredient(ingredient)}
              >
                Eliminar
              </button>
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
    </div>
  );
}
