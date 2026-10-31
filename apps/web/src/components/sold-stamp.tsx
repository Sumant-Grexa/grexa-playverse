"use client";

import { useEffect, useRef, useState } from "react";
import { playSoldSound } from "@/lib/sold-sound";

export function SoldStamp({ saleId, pulse = 0 }: { saleId: string | null; pulse?: number }) {
  const seen = useRef<string | null | undefined>(undefined);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (seen.current === undefined) {
      seen.current = saleId;
      return;
    }
    if (!saleId || seen.current === saleId) return;
    seen.current = saleId;
    setShow(true);
    playSoldSound();
    const timer = window.setTimeout(() => setShow(false), 1400);
    return () => window.clearTimeout(timer);
  }, [saleId]);

  useEffect(() => {
    if (pulse === 0) return;
    setShow(true);
    playSoldSound();
    const timer = window.setTimeout(() => setShow(false), 1400);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  if (!show) return null;
  return (
    <div className="sold-stamp" aria-hidden="true">
      <strong>SOLD</strong>
    </div>
  );
}
