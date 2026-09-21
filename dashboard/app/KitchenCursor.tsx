"use client";

import { useEffect, useRef } from "react";

export default function KitchenCursor() {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const pointRef = useRef({ x: -80, y: -80 });
  const timerRef = useRef(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    if (!window.matchMedia("(any-pointer: fine)").matches) {
      return;
    }

    function move(event: MouseEvent) {
      pointRef.current = { x: event.clientX, y: event.clientY };
      if (frameRef.current) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = 0;
        const { x, y } = pointRef.current;
        root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      });
    }

    function spin() {
      window.clearTimeout(timerRef.current);
      root.classList.remove("is-click");
      void root.offsetWidth;
      root.classList.add("is-click");
      timerRef.current = window.setTimeout(() => {
        root.classList.remove("is-click");
      }, 320);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.repeat) {
        return;
      }
      spin();
    }

    window.addEventListener("mousemove", move, { passive: true });
    window.addEventListener("mousedown", spin);
    window.addEventListener("keydown", onKey);

    return () => {
      window.cancelAnimationFrame(frameRef.current);
      window.clearTimeout(timerRef.current);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mousedown", spin);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div ref={rootRef} className="pizza-cursor" aria-hidden="true">
      <span className="pizza-cursor-slice" />
      <span className="pizza-cursor-full" />
    </div>
  );
}
