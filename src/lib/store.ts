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
  overallScore: number;
  exerciseScores: Record<string, number>;
};
export type PersonalBests = {
  accuracy: number | null;
  overallScore: number | null;
  confidence: string | null;
  exerciseScores: Record<string, number>;
};
type State = {
  settings: Settings;
  trials: Trial[];
  history: SensitivityHistoryEntry[];
  personalBests: PersonalBests;
  setSettings: (s: Settings) => void;
  addTrial: (t: Trial) => void;
  clearTrials: () => void;
  addHistoryEntry: (entry: SensitivityHistoryEntry) => void;
  removeHistoryEntry: (id: string) => void;
  clearHistory: () => void;
  clearPersonalBests: () => void;
};
export const useCalibration = create<State>()(
  persist(
    (set) => ({
      settings: { dpi: 800, sens: 1, polling: 1000, refresh: 144 },
      trials: [],
      history: [],
      personalBests: { accuracy: null, overallScore: null, confidence: null, exerciseScores: {} },
      setSettings: (settings) => set({ settings }),
      addTrial: (trial) => set((s) => ({ trials: [...s.trials, trial] })),
      clearTrials: () => set({ trials: [] }),
      addHistoryEntry: (entry) =>
        set((s) => {
          const confidenceRank = (confidence: string | null) =>
            confidence === 'High' ? 3 : confidence === 'Moderate' ? 2 : confidence === 'Low' ? 1 : 0;
          const bests = { ...s.personalBests, exerciseScores: { ...s.personalBests.exerciseScores } };
          if (entry.accuracy !== null && (bests.accuracy === null || entry.accuracy > bests.accuracy))
            bests.accuracy = entry.accuracy;
          if (bests.overallScore === null || entry.overallScore > bests.overallScore)
            bests.overallScore = entry.overallScore;
          if (confidenceRank(entry.confidence) > confidenceRank(bests.confidence))
            bests.confidence = entry.confidence;
          for (const [exercise, score] of Object.entries(entry.exerciseScores)) {
            if (bests.exerciseScores[exercise] === undefined || score > bests.exerciseScores[exercise])
              bests.exerciseScores[exercise] = score;
          }
          return { history: [entry, ...s.history].slice(0, 50), personalBests: bests };
        }),
      removeHistoryEntry: (id) =>
        set((s) => ({ history: s.history.filter((entry) => entry.id !== id) })),
      clearHistory: () => set({ history: [] }),
      clearPersonalBests: () =>
        set({ personalBests: { accuracy: null, overallScore: null, confidence: null, exerciseScores: {} } }),
    }),
    { name: 'senslab-v1', storage: createJSONStorage(() => localStorage) },
  ),
);
