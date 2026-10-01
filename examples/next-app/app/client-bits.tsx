"use client";

import { useEffect, useRef } from "react";

export default function ClientBits() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "orange";
    ctx.fillRect(0, 0, 120, 40);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <input data-testid="name" placeholder="Type here" className="rounded border px-2 py-1" />
      <label className="flex items-center gap-1">
        <input data-testid="agree" type="checkbox" /> Agree
      </label>
      <select data-testid="plan" className="rounded border px-2 py-1">
        <option>Free</option>
        <option>Pro</option>
        <option>Team</option>
      </select>
      <button
        className="rounded border px-2 py-1"
        onClick={() => document.documentElement.classList.toggle("dark")}
      >
        Toggle dark
      </button>
      <canvas ref={canvas} width={120} height={40} />
      <span className="badge">styled-jsx</span>
      <style jsx>{`
        .badge {
          background: purple;
          color: white;
          padding: 2px 8px;
          border-radius: 999px;
        }
      `}</style>
    </div>
  );
}
