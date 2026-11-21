import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { DrugBrand, NearbyPharmacy } from '@uposhom/shared';
import { api } from '../../src/api/endpoints';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Chip';
import { Icon } from '../../src/components/Icon';
import {
  Disclaimer,
  EmptyState,
  ErrorState,
  Loading,
  SectionTitle,
} from '../../src/components/Misc';
import { Text } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { useT } from '../../src/i18n';
import { colors } from '../../src/theme/colors';
import { toBn } from '../../src/utils/bangla';
import { relativeAgoBn } from '../../src/utils/dates';
import { formAndStrengthBn, savingPercent } from '../../src/utils/drug';
import { formatMoneyBn } from '../../src/utils/bangla';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Screen 6: Generic drug finder and nearby pharmacy discovery. */
export default function Explore() {
  const t = useT();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 350);
  const [selected, setSelected] = useState<DrugBrand | null>(null);

  const search = useQuery({
    queryKey: ['drug-search', dq],
    enabled: dq.length >= 2,
    queryFn: () => api.drugs.search(dq),
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text variant="headlineMedium" accessibilityRole="header">
        {t('explore.heading')}
      </Text>
      <TextField
        value={q}
        onChangeText={(v) => {
          setQ(v);
          setSelected(null);
        }}
        placeholder={t('explore.search')}
        returnKeyType="search"
        accessibilityLabel={t('explore.search')}
      />

      {dq.length >= 2 && !selected ? (
        search.isLoading ? (
          <Loading />
        ) : search.isError ? (
          <ErrorState error={search.error} onRetry={() => void search.refetch()} />
        ) : (search.data?.results.length ?? 0) === 0 ? (
          <EmptyState icon="magnify-close" title={t('explore.none')} />
        ) : (
          <View style={{ gap: 8 }}>
            {search.data?.results.map((d) => (
              <Pressable key={d.id} accessibilityRole="button" onPress={() => setSelected(d)}>
                <Card style={styles.result}>
                  <View style={{ flex: 1 }}>
                    <Text variant="titleMedium">{d.nameBn}</Text>
                    <Text variant="bodyMedium">
                      {d.nameEn} · {d.generic}
                    </Text>
                    <Text variant="caption">{formAndStrengthBn(d.form, d.strength)}</Text>
                  </View>
                  <Icon name="chevron-right" size={26} color="onSurfaceVariant" />
                </Card>
              </Pressable>
            ))}
          </View>
        )
      ) : null}

      {selected ? <Comparison drug={selected} /> : null}

      <Pharmacies drugId={selected?.id} />
    </ScrollView>
  );
}

function Comparison({ drug }: { drug: DrugBrand }) {
  const t = useT();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['generics', drug.id],
    queryFn: () => api.drugs.generics(drug.nameEn),
  });
  if (isLoading) return <Loading />;
  if (isError || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;
  const original = data.original;
  return (
    <View style={{ gap: 12 }}>
      <SectionTitle>{t('explore.original')}</SectionTitle>
      <DrugCard drug={original} />
      <SectionTitle>{t('explore.alternatives')}</SectionTitle>
      {data.alternatives.length === 0 ? (
        <Text variant="bodyLarge">{t('explore.noAlternative')}</Text>
      ) : null}
      {data.alternatives.map((a) => {
        // Computed from the two indicative prices and labelled indicative. Never "bioequivalent".
        const pct = a.savingPercent ?? savingPercent(original.indicativePrice, a.indicativePrice);
        return <DrugCard key={a.id} drug={a} saving={pct} />;
      })}
      <Disclaimer text={data.note ?? t('explore.advisory')} />
    </View>
  );
}

function DrugCard({ drug, saving }: { drug: DrugBrand; saving?: number | null }) {
  const t = useT();
  return (
    <Card style={{ gap: 6 }} borderColor={saving ? colors.taken : undefined}>
      <Text variant="titleMedium">
        {drug.nameEn} {drug.strength} ({drug.manufacturer})
      </Text>
      <Text variant="bodyMedium">
        {drug.nameBn} · {formAndStrengthBn(drug.form, drug.strength)}
      </Text>
      <Text variant="bodyLarge">
        {t('explore.price')} ({t('explore.indicative')}):{' '}
        <Text variant="titleMedium">
          {formatMoneyBn(drug.indicativePrice)}
          {t('explore.perPiece')}
        </Text>
      </Text>
      {saving ? (
        <Badge
          tone="green"
          icon="tag-outline"
          label={`${t('explore.cheaperBadge', { n: toBn(saving) })} (${t('explore.indicative')})`}
        />
      ) : null}
    </Card>
  );
}

function Pharmacies({ drugId }: { drugId?: string }) {
  const t = useT();
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [area, setArea] = useState('');
  const [denied, setDenied] = useState(false);
  const darea = useDebounced(area.trim(), 500);

  // If location was already allowed earlier, use it without asking again.
  useEffect(() => {
    void (async () => {
      try {
        const p = await Location.getForegroundPermissionsAsync();
        if (p.granted) await locate();
      } catch {
        // ignore
      }
    })();
  }, []);

  const locate = async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        setDenied(true);
        return;
      }
      const pos =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setDenied(false);
    } catch {
      setDenied(true);
    }
  };

  const ready = !!coords || darea.length > 0;
  const q = useQuery({
    queryKey: ['pharmacies', coords?.lat, coords?.lng, darea, drugId],
    enabled: ready,
    queryFn: () =>
      api.pharmacies.nearby({
        lat: coords?.lat,
        lng: coords?.lng,
        area: darea || undefined,
        drugId,
        radiusKm: 3,
      }),
  });

  return (
    <View style={{ gap: 12 }}>
      <SectionTitle>{t('explore.pharmacies')}</SectionTitle>
      {!drugId ? <Text variant="bodyMedium">{t('explore.selectDrug')}</Text> : null}
      {denied ? (
        <Text variant="bodyMedium" style={{ color: colors.tertiary }}>
          {t('explore.locationDenied')}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <TextField
            value={area}
            onChangeText={setArea}
            placeholder={t('explore.areaPlaceholder')}
            accessibilityLabel={t('explore.findArea')}
          />
        </View>
      </View>
      {!coords ? (
        <Button
          label={t('explore.useLocation')}
          variant="secondary"
          icon="crosshairs-gps"
          onPress={locate}
        />
      ) : null}

      {!ready ? null : q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (q.data?.pharmacies.length ?? 0) === 0 ? (
        <EmptyState icon="store-off-outline" title={t('explore.noPharmacy')} />
      ) : (
        q.data?.pharmacies.map((p) => <PharmacyCard key={p.id} p={p} />)
      )}
      {drugId ? <Text variant="caption">{t('explore.stockNote')}</Text> : null}
    </View>
  );
}

function PharmacyCard({ p }: { p: NearbyPharmacy }) {
  const t = useT();
  return (
    <Card style={{ gap: 8 }} borderColor={p.isPartner ? colors.primary : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="titleMedium" style={{ flex: 1 }}>
          {p.name}
        </Text>
        {p.isPartner ? (
          <Badge tone="primary" icon="check-decagram" label={`${t('explore.partner')} (Partner)`} />
        ) : null}
      </View>
      <Text variant="bodyMedium">
        {p.address}
        {p.distanceKm != null ? ` · ${toBn(p.distanceKm)} ${t('explore.km')}` : ''}
      </Text>
      {p.stockStatus ? (
        <View style={{ gap: 2 }}>
          <Text
            variant="bodyLarge"
            style={{
              color: p.stockStatus === 'IN_STOCK' ? colors.taken : colors.emergency,
              fontWeight: '700',
            }}
          >
            {p.stockStatus === 'IN_STOCK'
              ? `🟢 ${t('explore.inStock')} (In Stock)`
              : `🔴 ${t('explore.outOfStock')}`}
          </Text>
          {p.stockUpdatedAt ? (
            <Text variant="caption">
              {t('explore.updated', { when: relativeAgoBn(p.stockUpdatedAt) })}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Button
        label={`${t('explore.call')} · ${toBn(p.phone)}`}
        icon="phone"
        variant="tonal"
        onPress={() => void Linking.openURL(`tel:${p.phone}`)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
