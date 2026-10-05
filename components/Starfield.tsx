"use client";

import React, { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/context";

export function Starfield() {
  const pathname = usePathname();
  const { focusMode } = useApp();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const isVisiblePage = pathname === "/" || pathname === "/profile";

  useEffect(() => {
    if (!isVisiblePage || focusMode) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    let animFrameId: number;
    let particles: Array<{
      x: number;
      y: number;
      r: number;
      vx: number;
      vy: number;
      a: number;
      t: number;
    }> = [];

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;

      const particleCount = Math.min(70, Math.round((rect.width * rect.height) / 20000));
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: (0.6 + Math.random() * 1.4) * dpr,
          vx: (Math.random() - 0.5) * 0.25 * dpr,
          vy: (Math.random() - 0.5) * 0.25 * dpr,
          a: 0.2 + Math.random() * 0.5,
          t: Math.random() * 6,
        });
      }
    };

    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      if (document.hidden) {
        animFrameId = requestAnimationFrame(render);
        return;
      }
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      particles.forEach((p) => {
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;
        p.t += 0.02;
        ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(p.t));
        ctx.fillStyle = "#a38ad1";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });

      animFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", resize);
    };
  }, [pathname, focusMode, isVisiblePage]);

  if (!isVisiblePage || focusMode) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-0 h-full w-full"
    />
  );
}
