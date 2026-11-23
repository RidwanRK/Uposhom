import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { MyPharmacyResponse, StockStatus } from '@uposhom/shared';
import { api } from '../../src/api/endpoints';
import { Card } from '../../src/components/Card';
import { Header } from '../../src/components/Header';
import { Banner, EmptyState, ErrorState, Loading } from '../../src/components/Misc';
import { Text } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { qk } from '../../src/hooks/queries';
import { useT } from '../../src/i18n';
import { colors } from '../../src/theme/colors';
import { MIN_TOUCH } from '../../src/theme/spacing';
import { relativeAgoBn } from '../../src/utils/dates';
import { formAndStrengthBn } from '../../src/utils/drug';
import { errorMessage } from '../../src/utils/errors';

/** Pharmacy tab 1: a searchable list of the store's medicines with a large In Stock / Out of Stock toggle. */
export default function Stock() {
  const t = useT();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.pharmacyMe,
    queryFn: () => api.pharmacies.me(),
  });

  const toggle = useMutation({
    mutationFn: ({ drugId, status }: { drugId: string; status: StockStatus }) =>
      api.pharmacies.setStock(drugId, status),
    // Optimistic: the switch moves at once and rolls back if the server refuses.
    onMutate: async ({ drugId, status }) => {
      await qc.cancelQueries({ queryKey: qk.pharmacyMe });
      const prev = qc.getQueryData<MyPharmacyResponse>(qk.pharmacyMe);
      if (prev) {
        qc.setQueryData<MyPharmacyResponse>(qk.pharmacyMe, {
          ...prev,
          stock: prev.stock.map((r) =>
            r.drugId === drugId ? { ...r, status, updatedAt: new Date().toISOString() } : r,
          ),
        });
      }
      return { prev };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.pharmacyMe, ctx.prev);
      setMessage(errorMessage(e, t));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.pharmacyMe }),
  });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data?.stock ?? []).filter(
      (r) => !s || r.nameEn.toLowerCase().includes(s) || r.nameBn.includes(q.trim()),
    );
  }, [data, q]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Header title={t('pharmacy.stockTitle')} noBack />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <TextField
          value={q}
          onChangeText={setQ}
          placeholder={t('pharmacy.stockSearch')}
          accessibilityLabel={t('pharmacy.stockSearch')}
        />
        {message ? <Banner icon="alert-circle-outline" text={message} /> : null}
        {isLoading ? <Loading label={t('common.loading')} /> : null}
        {isError && !data ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
        {data && rows.length === 0 ? (
          <EmptyState icon="package-variant" title={t('explore.none')} />
        ) : null}
        {rows.map((r) => {
          const inStock = r.status === 'IN_STOCK';
          return (
            <Card key={r.drugId} style={{ gap: 8 }}>
              <View>
                <Text variant="titleMedium">{r.nameBn}</Text>
                <Text variant="bodyMedium">
                  {r.nameEn} · {formAndStrengthBn(undefined, r.strength)}
                </Text>
                {r.updatedAt ? (
                  <Text variant="caption">
                    {t('pharmacy.updated', { when: relativeAgoBn(r.updatedAt) })}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: inStock }}
                accessibilityLabel={`${r.nameBn} ${inStock ? t('pharmacy.inStock') : t('pharmacy.outOfStock')}`}
                onPress={() =>
                  toggle.mutate({ drugId: r.drugId, status: inStock ? 'OUT_OF_STOCK' : 'IN_STOCK' })
                }
                style={{
                  minHeight: MIN_TOUCH,
                  borderRadius: 12,
                  paddingHorizontal: 14,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: inStock ? colors.taken : '#FDECEA',
                  borderWidth: 2,
                  borderColor: inStock ? colors.taken : colors.emergency,
                }}
              >
                <Text
                  variant="titleMedium"
                  style={{ color: inStock ? colors.onPrimary : colors.emergency }}
                >
                  {inStock ? `🟢 ${t('pharmacy.inStock')}` : `🔴 ${t('pharmacy.outOfStock')}`}
                </Text>
                <View
                  style={{
                    width: 64,
                    height: 36,
                    borderRadius: 18,
                    padding: 3,
                    backgroundColor: inStock ? '#0F4F31' : colors.outline,
                    justifyContent: 'center',
                  }}
                >
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      backgroundColor: colors.surface,
                      alignSelf: inStock ? 'flex-end' : 'flex-start',
                    }}
                  />
                </View>
              </Pressable>
            </Card>
          );
        })}
      </ScrollView>
    </View>
  );
}
