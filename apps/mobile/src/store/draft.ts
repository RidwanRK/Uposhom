import { create } from 'zustand';
import type { ExtractedItem } from '@uposhom/shared';

/** One editable medicine card on the confirm screen. `pattern` is canonical Latin ('1+0+1'). */
export interface DraftItem {
  key: string;
  brandName: string;
  genericName?: string;
  strength: string;
  form: string;
  pattern: string;
  mealRelation: ExtractedItem['mealRelation'];
  durationDays: number;
  pillCount?: number;
  /** 0-1. Manually added items are 1: a person typed them. */
  confidence: number;
  /** Only a person can turn this on, never the AI (design.md 6.3). Always starts false. */
  isCritical: boolean;
  manual: boolean;
}

interface DraftState {
  draftId: string | null;
  imageUri: string | null;
  transcript: string;
  items: DraftItem[];
  start: (d: {
    draftId: string;
    imageUri: string;
    transcript: string;
    items: ExtractedItem[];
  }) => void;
  startManual: () => void;
  update: (key: string, patch: Partial<DraftItem>) => void;
  add: () => void;
  remove: (key: string) => void;
  reset: () => void;
}

let counter = 0;
const nextKey = () => `item_${Date.now()}_${counter++}`;

export const blankItem = (): DraftItem => ({
  key: nextKey(),
  brandName: '',
  strength: '',
  form: 'Tablet',
  pattern: '',
  mealRelation: 'PC',
  durationDays: 7,
  confidence: 1,
  isCritical: false,
  manual: true,
});

export const useDraft = create<DraftState>((set) => ({
  draftId: null,
  imageUri: null,
  transcript: '',
  items: [],

  start: ({ draftId, imageUri, transcript, items }) =>
    set({
      draftId,
      imageUri,
      transcript,
      items: items.map((i) => ({
        key: nextKey(),
        brandName: i.brandName,
        genericName: i.genericName,
        strength: i.strength,
        form: i.form,
        pattern: i.pattern,
        mealRelation: i.mealRelation,
        durationDays: i.durationDays,
        pillCount: i.pillCount,
        confidence: i.confidence,
        isCritical: false, // never trust a model-supplied critical flag
        manual: false,
      })),
    }),

  startManual: () => set({ draftId: null, imageUri: null, transcript: '', items: [blankItem()] }),

  update: (key, patch) =>
    set((s) => ({ items: s.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) })),

  add: () => set((s) => ({ items: [...s.items, blankItem()] })),
  remove: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
  reset: () => set({ draftId: null, imageUri: null, transcript: '', items: [] }),
}));
