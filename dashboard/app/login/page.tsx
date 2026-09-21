"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "../../lib/supabase/client";

function toGmail(raw: string) {
  const local = raw.trim().split("@")[0].replace(/\s/g, "");
  return `${local}@gmail.com`;
}

function usernameFromInput(value: string) {
  return value.replace(/\s/g, "").split("@")[0];
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const screenRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.documentElement.classList.add("login-lock");
    document.body.classList.add("login-lock");

    return () => {
      document.documentElement.classList.remove("login-lock");
      document.body.classList.remove("login-lock");
    };
  }, []);

  useEffect(() => {
    function updateKeyboardInset() {
      const vv = window.visualViewport;
      const node = screenRef.current;
      if (!vv || !node) {
        return;
      }

      const keyboard = Math.max(
        0,
        window.innerHeight - vv.height - vv.offsetTop
      );
      node.style.setProperty("--login-kb", `${keyboard}px`);
    }

    function schedule() {
      window.requestAnimationFrame(updateKeyboardInset);
    }

    const vv = window.visualViewport;
    vv?.addEventListener("resize", schedule);
    vv?.addEventListener("scroll", schedule);
    window.addEventListener("focusin", schedule);
    window.addEventListener("focusout", schedule);
    schedule();

    return () => {
      vv?.removeEventListener("resize", schedule);
      vv?.removeEventListener("scroll", schedule);
      window.removeEventListener("focusin", schedule);
      window.removeEventListener("focusout", schedule);
    };
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: toGmail(username),
        password
      });

      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }

      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
      setLoading(false);
    }
  }

  return (
    <main
      ref={screenRef}
      className="login-screen"
      onTouchMove={event => event.preventDefault()}
    >
      <div className="login-blobs" aria-hidden="true">
        <span className="login-blob login-blob-bottom" />
      </div>

      <form
        className="login-card"
        onSubmit={login}
        onTouchMove={event => event.stopPropagation()}
      >
        <h1>AI-Phone</h1>
        <p>Iniciar sesión</p>

        <input
          id="login-username"
          type="text"
          name="username"
          autoComplete="username"
          inputMode="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Usuario"
          value={username}
          onChange={e => setUsername(usernameFromInput(e.target.value))}
          required
        />

        <input
          id="login-password"
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="Contraseña"
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
        />

        {error && <p className="login-error">{error}</p>}

        <button
          type="submit"
          className={
            loading ? "login-submit login-submit-loading" : "login-submit"
          }
          disabled={loading}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}
