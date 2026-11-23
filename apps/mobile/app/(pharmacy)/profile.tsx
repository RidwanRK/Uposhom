import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { api } from '../../src/api/endpoints';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { Banner, ErrorState, Loading } from '../../src/components/Misc';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { qk } from '../../src/hooks/queries';
import { useT } from '../../src/i18n';
import { errorMessage } from '../../src/utils/errors';

/** Pharmacy tab 3: store name, address, location pin, phone and opening hours. */
export default function StoreProfile() {
  const t = useT();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: qk.pharmacyMe,
    queryFn: () => api.pharmacies.me(),
  });
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [hours, setHours] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const p = data?.profile;
    if (!p) return;
    setName(p.name);
    setAddress(p.address);
    setPhone(p.phone);
    setHours(p.openingHours);
    if (p.lat != null && p.lng != null) setPin({ lat: p.lat, lng: p.lng });
  }, [data]);

  const setLocation = async () => {
    try {
      // Coarse location only, and only now that the owner asked for it.
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) return setMessage(t('explore.locationDenied'));
      const pos =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }));
      setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setMessage(t('pharmacy.pinDone'));
    } catch {
      setMessage(t('explore.locationDenied'));
    }
  };

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.pharmacies.updateProfile({
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        openingHours: hours.trim(),
        lat: pin?.lat ?? null,
        lng: pin?.lng ?? null,
      });
      await qc.invalidateQueries({ queryKey: qk.pharmacyMe });
      setMessage(t('pharmacy.saved'));
    } catch (e) {
      setMessage(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header title={t('pharmacy.profileTitle')} noBack />
      <Screen edges={[]}>
        {isLoading ? <Loading label={t('common.loading')} /> : null}
        {isError && !data ? <ErrorState error={error} onRetry={() => void refetch()} /> : null}
        {message ? <Banner icon="information-outline" tone="mint" text={message} /> : null}
        {data ? (
          <>
            <TextField label={t('pharmacy.storeName')} value={name} onChangeText={setName} />
            <TextField
              label={t('pharmacy.address')}
              value={address}
              onChangeText={setAddress}
              multiline
            />
            <TextField
              label={t('pharmacy.phone')}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <TextField label={t('pharmacy.hours')} value={hours} onChangeText={setHours} />
            <Text variant="titleMedium">{t('pharmacy.pin')}</Text>
            <Button
              label={pin ? t('pharmacy.pinDone') : t('pharmacy.pinSet')}
              icon="map-marker-outline"
              variant="secondary"
              onPress={setLocation}
            />
            <Button
              label={t('common.save')}
              loading={busy}
              disabled={!name.trim()}
              onPress={save}
            />
          </>
        ) : null}
        <Button
          label={t('settings.title')}
          icon="cog-outline"
          variant="ghost"
          onPress={() => router.push('/settings')}
        />
      </Screen>
    </>
  );
}
