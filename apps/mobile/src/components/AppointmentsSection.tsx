import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { View } from 'react-native';
import { api } from '../api/endpoints';
import { useT } from '../i18n';
import { toBn } from '../utils/bangla';
import { dhakaParts, formatDateBn, formatTimeBn } from '../utils/dates';
import { errorMessage } from '../utils/errors';
import { Button } from './Button';
import { Card } from './Card';
import { Icon } from './Icon';
import { Banner, SectionTitle, Stepper } from './Misc';
import { Text } from './Text';
import { TextField } from './TextField';
import { TimeStepper } from './TimeStepper';

/** ISO 8601 with the +06:00 offset for "N days from today at HH:mm" in Asia/Dhaka. */
function dueIso(daysAhead: number, hhmm: string, now: number = Date.now()): string {
  const base = new Date(now + daysAhead * 24 * 60 * 60 * 1000);
  const p = dhakaParts(base);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${hhmm}:00+06:00`;
}

/**
 * Follow-up appointments for a profile (docs/domain-api.md). The server reminds the patient by SMS and an
 * inbox notice within 24 hours of the visit. The date is picked as "days from today" plus a time.
 */
export function AppointmentsSection({
  profileId,
  canEdit,
}: {
  profileId: string;
  canEdit: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const key = ['appointments', profileId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.appointments.list(profileId) });
  const [title, setTitle] = useState('');
  const [days, setDays] = useState(7);
  const [time, setTime] = useState('10:00');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.appointments.add(profileId, { title: title.trim(), dueAt: dueIso(days, time) });
      setTitle('');
      setMessage(t('appointments.added'));
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setMessage(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <SectionTitle>{t('appointments.title')}</SectionTitle>
      <Text variant="caption">{t('appointments.hint')}</Text>
      {(data?.appointments ?? []).length === 0 ? (
        <Text variant="bodyMedium">{t('appointments.empty')}</Text>
      ) : null}
      {data?.appointments.map((a) => (
        <Card key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="calendar-clock" size={26} color="primary" />
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium">{a.title}</Text>
            <Text variant="caption">
              {formatDateBn(a.dueAt)} · {formatTimeBn(a.dueAt)}
            </Text>
          </View>
        </Card>
      ))}
      {canEdit ? (
        <Card style={{ gap: 10 }}>
          <TextField
            value={title}
            onChangeText={setTitle}
            placeholder={t('appointments.name')}
            accessibilityLabel={t('appointments.name')}
          />
          <Text variant="titleMedium">{t('appointments.inDays')}</Text>
          <Stepper value={days} onChange={setDays} min={1} max={180} label={`${toBn(days)} দিন`} />
          <TimeStepper label={t('appointments.time')} value={time} onChange={setTime} />
          {message ? <Banner icon="information-outline" tone="mint" text={message} /> : null}
          <Button
            label={t('appointments.add')}
            loading={busy}
            disabled={!title.trim()}
            onPress={add}
          />
        </Card>
      ) : null}
    </View>
  );
}
