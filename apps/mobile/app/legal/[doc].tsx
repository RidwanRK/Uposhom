import { useLocalSearchParams } from 'expo-router';
import { Linking, View } from 'react-native';
import { API_URL } from '../../src/api/config';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Header } from '../../src/components/Header';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { trList, useT } from '../../src/i18n';

/**
 * Help and legal, each one tap from Settings: support contact, terms of service, privacy policy
 * (Master Plan section 8: Applink checks for these). The Bangla summary is bundled so it works offline;
 * the full pages are served by the backend (/support, /legal/terms, /legal/privacy).
 * The wording is a working draft until the team's legal review (docs/legal-review.md) is done.
 */
export default function LegalDoc() {
  const t = useT();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const kind = doc === 'terms' || doc === 'privacy' ? doc : 'support';
  const title =
    kind === 'terms'
      ? t('settings.terms')
      : kind === 'privacy'
        ? t('settings.privacyPolicy')
        : t('legal.supportTitle');
  const serverPath =
    kind === 'terms' ? '/legal/terms' : kind === 'privacy' ? '/legal/privacy' : '/support';

  return (
    <>
      <Header title={title} />
      <Screen edges={['bottom']}>
        {kind === 'support' ? (
          <Card style={{ gap: 12 }}>
            <Text variant="bodyLarge">{t('legal.supportBody')}</Text>
            <Button
              label={t('legal.supportEmail')}
              icon="email-outline"
              variant="secondary"
              onPress={() => void Linking.openURL(`mailto:${t('legal.supportEmail')}`)}
            />
            <Button
              label={t('legal.supportPhone')}
              icon="phone"
              variant="secondary"
              onPress={() =>
                void Linking.openURL(`tel:${t('legal.supportPhone').replace(/[^\d]/g, '')}`)
              }
            />
          </Card>
        ) : (
          <View style={{ gap: 12 }}>
            {trList(kind === 'terms' ? 'legal.termsBody' : 'legal.privacyBody').map((p) => (
              <Text key={p} variant="bodyLarge" color="onSurface">
                {p}
              </Text>
            ))}
          </View>
        )}
        {API_URL ? (
          <Button
            label={t('settings.viewOnline')}
            variant="ghost"
            icon="open-in-new"
            onPress={() => void Linking.openURL(`${API_URL}${serverPath}`)}
          />
        ) : null}
      </Screen>
    </>
  );
}
