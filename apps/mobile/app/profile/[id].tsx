import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { LinkRole, MealTimes, ProfileLink } from '@uposhom/shared';
import { api } from '../../src/api/endpoints';
import { AppointmentsSection } from '../../src/components/AppointmentsSection';
import { BottomSheet } from '../../src/components/BottomSheet';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Badge, Chip } from '../../src/components/Chip';
import { Header } from '../../src/components/Header';
import { Avatar, Banner, ErrorState, Loading, SectionTitle } from '../../src/components/Misc';
import { Screen } from '../../src/components/Screen';
import { StepUpSheet } from '../../src/components/StepUpSheet';
import { Text } from '../../src/components/Text';
import { TextField } from '../../src/components/TextField';
import { TimeStepper } from '../../src/components/TimeStepper';
import { qk, useCircle } from '../../src/hooks/queries';
import { useT } from '../../src/i18n';
import { toLatinDigits } from '../../src/utils/bangla';
import { errorMessage } from '../../src/utils/errors';
import { normalizeBdMsisdn } from '../../src/utils/phone';

const ROLES: LinkRole[] = ['ADMIN', 'CAREGIVER', 'VIEWER'];
const DEFAULT_MEALS: MealTimes = {
  morning: '08:00',
  noon: '13:30',
  evening: '17:00',
  night: '20:30',
};

/** Screen 14: Profile details. Fields, meal times, quiet hours, roles, secondary caregiver, own phone. */
export default function ProfileDetails() {
  const t = useT();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useCircle();
  const profile = data?.profiles.find((p) => p.id === id);
  const isAdmin = profile?.myRole === 'ADMIN';

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [allergies, setAllergies] = useState('');
  const [meals, setMeals] = useState<MealTimes>(DEFAULT_MEALS);
  const [quiet, setQuiet] = useState({ start: '22:00', end: '06:00' });
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removeFor, setRemoveFor] = useState<ProfileLink | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitePhone, setInvitePhone] = useState('');
  const [inviteRole, setInviteRole] = useState<LinkRole>('CAREGIVER');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkPhone, setLinkPhone] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [linkOtp, setLinkOtp] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setAge(profile.age != null ? String(profile.age) : '');
    setAllergies(profile.allergies ?? '');
    setMeals(profile.mealTimes);
    if (profile.quietHours) setQuiet(profile.quietHours);
  }, [profile?.id]);

  const refresh = () => qc.invalidateQueries({ queryKey: qk.circle });

  const save = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      await api.circles.updateProfile(profile.id, {
        name: name.trim(),
        age: age ? Number(toLatinDigits(age)) : undefined,
        allergies,
        mealTimes: meals,
        quietHours: quiet,
      });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setBusy(false);
    }
  };

  const invite = async () => {
    const m = normalizeBdMsisdn(invitePhone);
    if (!m || !profile) return setInviteError(t('auth.phone.invalid'));
    await api.circles.invite({ profileId: profile.id, msisdn: m, role: inviteRole });
    await refresh();
    setInviteOpen(false);
    setInvitePhone('');
    setInviteError(null);
  };

  if (isLoading && !data)
    return (
      <>
        <Header title={t('profile.title')} />
        <Loading />
      </>
    );
  if (isError || !profile)
    return (
      <>
        <Header title={t('profile.title')} />
        <ErrorState error={error} onRetry={() => void refetch()} />
      </>
    );

  return (
    <>
      <Header title={profile.name} />
      <Screen edges={['bottom']}>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Avatar emoji={profile.avatar} size={72} />
        </View>
        {!isAdmin ? (
          <Banner icon="information-outline" tone="mint" text={t('profile.adminOnly')} />
        ) : null}

        <TextField
          label={t('profile.name')}
          value={name}
          onChangeText={setName}
          editable={isAdmin}
        />
        <TextField
          label={t('profile.age')}
          value={age}
          onChangeText={(v) => setAge(toLatinDigits(v).replace(/\D/g, '').slice(0, 3))}
          keyboardType="number-pad"
          editable={isAdmin}
        />
        <TextField
          label={t('profile.allergies')}
          hint={t('profile.allergiesHint')}
          value={allergies}
          onChangeText={setAllergies}
          multiline
          editable={isAdmin}
        />

        <View style={{ gap: 8 }}>
          <SectionTitle>{t('profile.mealTimes')}</SectionTitle>
          <TimeStepper
            label={t('addDependent.morning')}
            value={meals.morning}
            onChange={(v) => isAdmin && setMeals({ ...meals, morning: v })}
          />
          <TimeStepper
            label={t('addDependent.noon')}
            value={meals.noon}
            onChange={(v) => isAdmin && setMeals({ ...meals, noon: v })}
          />
          <TimeStepper
            label={t('addDependent.evening')}
            value={meals.evening}
            onChange={(v) => isAdmin && setMeals({ ...meals, evening: v })}
          />
          <TimeStepper
            label={t('addDependent.night')}
            value={meals.night}
            onChange={(v) => isAdmin && setMeals({ ...meals, night: v })}
          />
        </View>

        <View style={{ gap: 8 }}>
          <SectionTitle>{t('profile.quietHours')}</SectionTitle>
          <Text variant="caption">{t('profile.quietHint')}</Text>
          <TimeStepper
            label={t('profile.quietStart')}
            value={quiet.start}
            onChange={(v) => isAdmin && setQuiet({ ...quiet, start: v })}
          />
          <TimeStepper
            label={t('profile.quietEnd')}
            value={quiet.end}
            onChange={(v) => isAdmin && setQuiet({ ...quiet, end: v })}
          />
        </View>

        {isAdmin ? (
          <Button
            label={saved ? t('profile.saved') : t('common.save')}
            loading={busy}
            onPress={save}
          />
        ) : null}

        <View style={{ gap: 10 }}>
          <SectionTitle>{t('profile.people')}</SectionTitle>
          {(profile.links ?? []).map((l) => (
            <Card key={l.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text variant="titleMedium" style={{ flex: 1 }}>
                  {l.name}
                </Text>
                <Badge
                  label={t(`profile.roles.${l.role}`)}
                  tone={l.role === 'ADMIN' ? 'green' : 'primary'}
                />
              </View>
              {l.isSecondaryCaregiver ? (
                <Badge label={t('profile.secondary')} tone="amber" icon="shield-account" />
              ) : null}
              {isAdmin ? (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {ROLES.map((r) => (
                      <Chip
                        key={r}
                        label={t(`profile.roles.${r}`)}
                        selected={l.role === r}
                        onPress={async () => {
                          await api.circles.changeRole(l.id, r);
                          await refresh();
                        }}
                      />
                    ))}
                  </View>
                  {l.role === 'CAREGIVER' && !l.isSecondaryCaregiver ? (
                    <Button
                      label={t('profile.makeSecondary')}
                      variant="tonal"
                      onPress={async () => {
                        await api.circles.setSecondaryCaregiver(profile.id, l.id);
                        await refresh();
                      }}
                    />
                  ) : null}
                  {l.role !== 'ADMIN' ? (
                    <Button
                      label={t('profile.removePerson')}
                      variant="ghost"
                      icon="account-remove-outline"
                      onPress={() => setRemoveFor(l)}
                    />
                  ) : null}
                </>
              ) : null}
            </Card>
          ))}
          {isAdmin ? (
            <Button
              label={t('profile.invite')}
              icon="account-plus-outline"
              variant="secondary"
              onPress={() => setInviteOpen(true)}
            />
          ) : null}
        </View>

        <AppointmentsSection profileId={profile.id} canEdit={profile.myRole !== 'VIEWER'} />

        <View style={{ gap: 10 }}>
          <SectionTitle>{t('profile.ownPhone')}</SectionTitle>
          <Text variant="bodyLarge">
            {profile.phoneLinked ? t('profile.phoneLinked') : t('profile.phoneNotLinked')}
          </Text>
          {isAdmin ? (
            <Button
              label={t('profile.reverify')}
              variant="secondary"
              onPress={() => setLinkOpen(true)}
            />
          ) : null}
        </View>
      </Screen>

      <StepUpSheet
        visible={!!removeFor}
        onClose={() => setRemoveFor(null)}
        onToken={async (token) => {
          if (removeFor) await api.circles.removeLink(removeFor.id, token);
          setRemoveFor(null);
          await refresh();
        }}
      />

      <BottomSheet
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title={t('profile.invite')}
      >
        <TextField
          label={t('profile.invitePhone')}
          value={invitePhone}
          onChangeText={setInvitePhone}
          keyboardType="phone-pad"
          error={inviteError}
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ROLES.filter((r) => r !== 'ADMIN').map((r) => (
            <Chip
              key={r}
              label={t(`profile.roles.${r}`)}
              selected={inviteRole === r}
              onPress={() => setInviteRole(r)}
            />
          ))}
        </View>
        <Button label={t('common.add')} onPress={invite} />
      </BottomSheet>

      <BottomSheet
        visible={linkOpen}
        onClose={() => setLinkOpen(false)}
        title={t('addDependent.consentTitle')}
      >
        <Text variant="bodyLarge">{t('addDependent.consentBody')}</Text>
        <TextField
          label={t('addDependent.phone')}
          value={linkPhone}
          onChangeText={setLinkPhone}
          keyboardType="phone-pad"
          error={linkSent ? null : linkError}
        />
        {!linkSent ? (
          <Button
            label={t('addDependent.consentSend')}
            onPress={async () => {
              const m = normalizeBdMsisdn(linkPhone);
              if (!m) return setLinkError(t('auth.phone.invalid'));
              try {
                await api.circles.requestLink(profile.id, m);
                setLinkSent(true);
                setLinkError(null);
              } catch (e) {
                setLinkError(errorMessage(e, t));
              }
            }}
          />
        ) : (
          <>
            <TextField
              label={t('auth.otp.label')}
              value={linkOtp}
              onChangeText={(v) => setLinkOtp(toLatinDigits(v).replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              error={linkError}
            />
            <Button
              label={t('addDependent.consentVerify')}
              disabled={linkOtp.length !== 6}
              onPress={async () => {
                try {
                  await api.circles.verifyLink(
                    profile.id,
                    normalizeBdMsisdn(linkPhone) ?? linkPhone,
                    linkOtp,
                  );
                  await refresh();
                  setLinkOpen(false);
                  setLinkSent(false);
                  setLinkOtp('');
                } catch (e) {
                  setLinkError(errorMessage(e, t));
                }
              }}
            />
          </>
        )}
      </BottomSheet>
    </>
  );
}
