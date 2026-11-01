'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Trial } from './calibration';
type Settings = { dpi: number; sens: number; polling: number; refresh: number };
type State = {
  settings: Settings;
  trials: Trial[];
  setSettings: (s: Settings) => void;
  addTrial: (t: Trial) => void;
  clearTrials: () => void;
};
export const useCalibration = create<State>()(
  persist(
    (set) => ({
      settings: { dpi: 800, sens: 1, polling: 1000, refresh: 144 },
      trials: [],
      setSettings: (settings) => set({ settings }),
      addTrial: (trial) => set((s) => ({ trials: [...s.trials, trial] })),
      clearTrials: () => set({ trials: [] }),
    }),
    { name: 'senslab-v1', storage: createJSONStorage(() => localStorage) },
  ),
);
