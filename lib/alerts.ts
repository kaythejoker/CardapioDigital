"use client";
// Alertas sonoros e visuais da equipe (spec-fase2.md, seção 1). Os sons são
// sintetizados no navegador, sem arquivos; só tocam depois de um toque do
// usuário ("Ativar som"), guardado por aparelho.

import { useCallback, useEffect, useRef, useState } from "react";

export type AlertKind = "new" | "ready" | "call" | "late";
const STORAGE = "comanda:som";

// Sequências curtas [frequência Hz, duração s]; cada evento toca uma vez.
const TONES: Record<AlertKind, [number, number][]> = {
  new: [[880, 0.12], [1175, 0.18]],
  ready: [[988, 0.1], [1319, 0.1], [1568, 0.2]],
  call: [[660, 0.15], [660, 0.15], [660, 0.25]],
  late: [[440, 0.3], [349, 0.35]],
};
const VIBRATION: Record<AlertKind, number[]> = {
  new: [120],
  ready: [200, 100, 200],
  call: [300, 120, 300, 120, 300],
  late: [400],
};

type AudioCtx = AudioContext;
let context: AudioCtx | null = null;

function playTones(kind: AlertKind) {
  if (!context) return;
  const now = context.currentTime;
  let at = now;
  for (const [frequency, duration] of TONES[kind]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === "late" ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
    at += duration + 0.05;
  }
}

export function vibrate(kind: AlertKind) {
  try {
    navigator.vibrate?.(VIBRATION[kind]);
  } catch {
    /* sem vibração neste aparelho */
  }
}

/**
 * Estado do som por aparelho. `play` toca uma vez; se a aba estiver em segundo
 * plano o aviso fica pendente e toca uma única vez ao voltar.
 */
export function useAlerts() {
  // O botão só aparece depois que o painel carrega no cliente, então ler a
  // preferência na inicialização não causa diferença com o HTML do servidor.
  const [enabled, setEnabled] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(STORAGE) === "1";
    } catch {
      return false;
    }
  });
  const pending = useRef<Set<AlertKind>>(new Set());
  const ensureContext = useCallback(() => {
    if (typeof window === "undefined" || !("AudioContext" in window)) return false;
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return true;
  }, []);
  const enable = useCallback(() => {
    const ok = ensureContext();
    setEnabled(ok);
    try {
      localStorage.setItem(STORAGE, ok ? "1" : "0");
    } catch {
      /* ignorado */
    }
    if (ok) playTones("new");
  }, [ensureContext]);
  const disable = useCallback(() => {
    setEnabled(false);
    try {
      localStorage.setItem(STORAGE, "0");
    } catch {
      /* ignorado */
    }
  }, []);
  const play = useCallback(
    (kind: AlertKind) => {
      vibrate(kind);
      if (!enabled) return;
      if (document.hidden) {
        pending.current.add(kind);
        return;
      }
      if (ensureContext()) playTones(kind);
    },
    [enabled, ensureContext],
  );
  useEffect(() => {
    const onVisible = () => {
      if (document.hidden || !pending.current.size) return;
      const kinds = [...pending.current];
      pending.current.clear();
      if (!enabled || !ensureContext()) return;
      // Um toque só ao voltar, do evento mais importante.
      const order: AlertKind[] = ["call", "ready", "late", "new"];
      playTones(order.find((k) => kinds.includes(k)) ?? kinds[0]);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, ensureContext]);
  return { enabled, enable, disable, play };
}

/** Prefixo "(N) " no título da aba enquanto houver pendências. */
export function useTabBadge(count: number, base: string) {
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [count, base]);
}
