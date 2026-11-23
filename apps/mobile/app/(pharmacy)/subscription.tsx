import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';
import { api } from '../../src/api/endpoints';
import { Badge } from '../../src/components/Chip';
import { Card } from '../../src/components/Card';
import { Header } from '../../src/components/Header';
import { PremiumView } from '../../src/components/PremiumView';
import { Screen } from '../../src/components/Screen';
import { Text } from '../../src/components/Text';
import { qk } from '../../src/hooks/queries';
import { useT } from '../../src/i18n';

/**
 * Pharmacy tab 2: monthly carrier-billed plan with the same consent disclosure as Family Circle
 * (amount, currency, monthly renewal) and an opt-out button. Shows Partner status and priority listing.
 */
export default function PharmacySubscription() {
  const t = useT();
  const { data } = useQuery({ queryKey: qk.pharmacyMe, queryFn: () => api.pharmacies.me() });
  const partner = !!data?.profile.isPartner;
  const priority = !!data?.profile.priorityListing;

  return (
    <>
      <Header title={t('pharmacy.subTitle')} noBack />
      <Screen edges={[]}>
        <Card style={{ gap: 10 }}>
          <Text variant="titleMedium">{t('pharmacy.partnerStatus')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Badge
              tone={partner ? 'green' : 'gray'}
              icon={partner ? 'check-decagram' : 'store-outline'}
              label={partner ? t('pharmacy.partner') : t('pharmacy.notPartner')}
            />
            <Badge
              tone={priority ? 'green' : 'gray'}
              icon="sort-variant"
              label={`${t('pharmacy.priority')}: ${priority ? t('pharmacy.priorityOn') : t('pharmacy.priorityOff')}`}
            />
          </View>
        </Card>
        <PremiumView />
      </Screen>
    </>
  );
}
