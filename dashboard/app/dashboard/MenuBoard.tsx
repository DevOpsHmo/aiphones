"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { ingredientLabel, ingredientsFromText } from "../../lib/menu-ingredients";

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

export default function MenuBoard() {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<"Pizzas" | "Bebidas">("Pizzas");
  const [price, setPrice] = useState("30");
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
    const drinkPrice = Number(price);
    const { error: insertError } = await supabase.from("products").insert({
      business_id: businessId,
      name: name.trim(),
      description: description.trim(),
      category,
      price: category === "Bebidas" ? drinkPrice : 0,
      available: true
    });
    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }
    const found = ingredientsFromText(description);
    if (found.length) {
      await supabase.from("menu_ingredients").upsert(
        found.map(ingredient => ({
          business_id: businessId,
          name: ingredient,
          available: true
        })),
        { onConflict: "business_id,name", ignoreDuplicates: true }
      );
    }
    setName("");
    setDescription("");
    setSaving(false);
    void load();
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
      <section>
        <h2>Precios</h2>
        <form className="menu-form" onSubmit={savePrices}>
          <label>
            Mediana
            <input
              name="price-mediana"
              type="number"
              min="0"
              value={sizePrices.mediana}
              onChange={event => setSizePrices(current => ({ ...current, mediana: event.target.value }))}
            />
          </label>
          <label>
            Grande
            <input
              name="price-grande"
              type="number"
              min="0"
              value={sizePrices.grande}
              onChange={event => setSizePrices(current => ({ ...current, grande: event.target.value }))}
            />
          </label>
          <label>
            Familiar
            <input
              name="price-familiar"
              type="number"
              min="0"
              value={sizePrices.familiar}
              onChange={event => setSizePrices(current => ({ ...current, familiar: event.target.value }))}
            />
          </label>
          <label>
            Extra
            <input
              name="price-extra"
              type="number"
              min="0"
              value={sizePrices.extra}
              onChange={event => setSizePrices(current => ({ ...current, extra: event.target.value }))}
            />
          </label>
          <label>
            Dos grandes
            <input
              name="price-promo"
              type="number"
              min="0"
              value={sizePrices.promo_pair}
              onChange={event => setSizePrices(current => ({ ...current, promo_pair: event.target.value }))}
            />
          </label>
          <button type="submit">Guardar precios</button>
        </form>
      </section>
      <section>
        <h2>Productos</h2>
        <ul className="menu-list">
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
                    <input
                      name={`price-${product.id}`}
                      type="number"
                      min="0"
                      defaultValue={Number(product.price)}
                      onBlur={event => saveProductPrice(product, event.target.value)}
                    />
                  )}
                </div>
                <button type="button" onClick={() => toggleProduct(product)}>
                  {product.available ? "Disponible" : "Apagado"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2>Producto nuevo</h2>
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
            onChange={event => setCategory(event.target.value as "Pizzas" | "Bebidas")}
          >
            <option value="Pizzas">Pizza</option>
            <option value="Bebidas">Bebida</option>
          </select>
          <input
            name="product-description"
            placeholder="Descripción o ingredientes"
            value={description}
            onChange={event => setDescription(event.target.value)}
          />
          {category === "Bebidas" && (
            <input
              name="product-price"
              type="number"
              min="0"
              value={price}
              onChange={event => setPrice(event.target.value)}
            />
          )}
          <button type="submit" disabled={saving || !businessId}>
            Agregar
          </button>
        </form>
      </section>
      <section>
        <h2>Ingredientes</h2>
        <ul className="menu-list">
          {ingredients.map(ingredient => (
            <li key={ingredient.id} className={ingredient.available ? "" : "is-off"}>
              <strong>{ingredientLabel(ingredient.name)}</strong>
              <button type="button" onClick={() => toggleIngredient(ingredient)}>
                {ingredient.available ? "Disponible" : "Apagado"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
