"use client";

import { useEffect, useRef, useState } from "react";

// Scroll-reveal like framer-motion's whileInView: hidden inline until it enters the viewport.
export default function Reveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setShown(true));
    io.observe(ref.current!);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-testid="reveal"
      style={shown ? { opacity: 1, transform: "none" } : { opacity: 0, transform: "translateY(40px)" }}
    >
      {children}
    </div>
  );
}
