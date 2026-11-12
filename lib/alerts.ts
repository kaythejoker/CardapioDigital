"use client";
// Alertas sonoros e visuais da equipe (spec-fase2.md, seção 1). Os sons são
// sintetizados no navegador, sem arquivos; só tocam depois de um toque do
// usuário ("Ativar som"), guardado por aparelho.

import { useCallback, useEffect, useState } from "react";

export type AlertKind = "new" | "ready" | "call" | "late";
const STORAGE = "comanda:som";

// Cada evento é um motivo [frequência Hz, duração s] repetido até `seconds`:
// pedido novo, pronto e chamada tocam por ~10 s para quem está no salão
// ouvir (piloto Arroba, 12/11/2026); atraso toca uma vez. Um toque na tela
// interrompe o som.
const TONES: Record<AlertKind, { motif: [number, number][]; pause: number; seconds: number }> = {
  new: { motif: [[880, 0.16], [1175, 0.24]], pause: 0.5, seconds: 10 },
  ready: { motif: [[988, 0.12], [1319, 0.12], [1568, 0.24]], pause: 0.5, seconds: 10 },
  call: { motif: [[660, 0.28], [880, 0.28]], pause: 0.35, seconds: 10 },
  late: { motif: [[440, 0.3], [349, 0.35]], pause: 0, seconds: 0 },
};
const VOLUME = 0.8;
const VIBRATION: Record<AlertKind, number[]> = {
  new: [120],
  ready: [200, 100, 200],
  call: [300, 120, 300, 120, 300],
  late: [400],
};

type AudioCtx = AudioContext;
let context: AudioCtx | null = null;

let ringing: OscillatorNode[] = [];

/** Para o som que estiver tocando (toque na tela ou novo alerta). */
export function stopAlertSound() {
  for (const o of ringing) {
    try {
      o.stop();
    } catch {
      /* já parou */
    }
  }
  ringing = [];
}

function playTones(kind: AlertKind, once = false) {
  if (!context) return;
  // Atraso não corta uma chamada ou um pedido novo que ainda está tocando.
  if (kind === "late" && ringing.length) return;
  stopAlertSound();
  const { motif, pause, seconds } = TONES[kind];
  const end = context.currentTime + (once ? 0 : seconds);
  let at = context.currentTime;
  do {
    for (const [frequency, duration] of motif) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "late" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(VOLUME, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + duration + 0.02);
      oscillator.onended = () => {
        ringing = ringing.filter((o) => o !== oscillator);
      };
      ringing.push(oscillator);
      at += duration + 0.05;
    }
    at += pause;
  } while (at < end);
}

export function vibrate(kind: AlertKind) {
  try {
    navigator.vibrate?.(VIBRATION[kind]);
  } catch {
    /* sem vibração neste aparelho */
  }
}

/** Estado do som por aparelho. `play` toca o alerta do evento (veja TONES). */
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
    if (ok) playTones("new", true);
  }, [ensureContext]);
  const disable = useCallback(() => {
    setEnabled(false);
    try {
      localStorage.setItem(STORAGE, "0");
    } catch {
      /* ignorado */
    }
  }, []);
  // Toca na hora, mesmo com a aba em segundo plano: o tablet do salão nem
  // sempre está com o painel na frente.
  const play = useCallback(
    (kind: AlertKind) => {
      vibrate(kind);
      if (enabled && ensureContext()) playTones(kind);
    },
    [enabled, ensureContext],
  );
  useEffect(() => {
    const stop = () => stopAlertSound();
    window.addEventListener("pointerdown", stop);
    window.addEventListener("keydown", stop);
    return () => {
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
    };
  }, []);
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
