import { z } from 'zod';

export const drugBrand = z.object({
  id: z.string(),
  nameEn: z.string(),
  nameBn: z.string(),
  generic: z.string(),
  strength: z.string(),
  form: z.string(),
  manufacturer: z.string(),
  indicativePrice: z.number(), // BDT per piece, indicative
});
export type DrugBrand = z.infer<typeof drugBrand>;

export const drugSearchResponse = z.object({ results: z.array(drugBrand) });

export const genericsResponse = z.object({
  original: drugBrand,
  alternatives: z.array(drugBrand.extend({ savingPercent: z.number().nullable() })),
  note: z.string().optional(),
});
export type GenericsResponse = z.infer<typeof genericsResponse>;
