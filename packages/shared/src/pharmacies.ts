import { z } from 'zod';

export const stockStatus = z.enum(['IN_STOCK', 'OUT_OF_STOCK']);
export type StockStatus = z.infer<typeof stockStatus>;

export const nearbyPharmacy = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  distanceKm: z.number().nullable().optional(),
  phone: z.string(),
  isPartner: z.boolean(),
  /** Stock for the searched drug, as last set by the owner (not a live feed). */
  stockStatus: stockStatus.optional(),
  stockUpdatedAt: z.string().optional(),
});
export type NearbyPharmacy = z.infer<typeof nearbyPharmacy>;
export const pharmaciesResponse = z.object({ pharmacies: z.array(nearbyPharmacy) });

export const stockRow = z.object({
  drugId: z.string(),
  nameEn: z.string(),
  nameBn: z.string(),
  strength: z.string(),
  status: stockStatus,
  updatedAt: z.string().optional(),
});
export type StockRow = z.infer<typeof stockRow>;

export const storeProfile = z.object({
  name: z.string(),
  address: z.string(),
  phone: z.string(),
  openingHours: z.string(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  isPartner: z.boolean().optional(),
  priorityListing: z.boolean().optional(),
});
export type StoreProfile = z.infer<typeof storeProfile>;

/** Proposed: one call for the owner's store profile and stock list. */
export const myPharmacyResponse = z.object({ profile: storeProfile, stock: z.array(stockRow) });
export type MyPharmacyResponse = z.infer<typeof myPharmacyResponse>;
export const setStockBody = z.object({ status: stockStatus });
