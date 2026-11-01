'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Trial } from './calibration';
type Settings = { dpi: number; sens: number; polling: number; refresh: number };
export type SensitivityHistoryEntry = {
  id: string;
  completedAt: string;
  startingSens: number;
  recommendedSens: number;
  dpi: number;
  confidence: string;
  accuracy: number | null;
  testLength: string;
  blocks: number;
  scoreGap: number;
};
type State = {
  settings: Settings;
  trials: Trial[];
  history: SensitivityHistoryEntry[];
  setSettings: (s: Settings) => void;
  addTrial: (t: Trial) => void;
  clearTrials: () => void;
  addHistoryEntry: (entry: SensitivityHistoryEntry) => void;
  removeHistoryEntry: (id: string) => void;
  clearHistory: () => void;
};
export const useCalibration = create<State>()(
  persist(
    (set) => ({
      settings: { dpi: 800, sens: 1, polling: 1000, refresh: 144 },
      trials: [],
      history: [],
      setSettings: (settings) => set({ settings }),
      addTrial: (trial) => set((s) => ({ trials: [...s.trials, trial] })),
      clearTrials: () => set({ trials: [] }),
      addHistoryEntry: (entry) =>
        set((s) => ({ history: [entry, ...s.history].slice(0, 50) })),
      removeHistoryEntry: (id) =>
        set((s) => ({ history: s.history.filter((entry) => entry.id !== id) })),
      clearHistory: () => set({ history: [] }),
    }),
    { name: 'senslab-v1', storage: createJSONStorage(() => localStorage) },
  ),
);
