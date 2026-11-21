import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CaasPurpose } from '@uposhom/shared';
import { ApiError } from '../api/client';
import { PaymentSheet } from '../components/PaymentSheet';

interface Gate {
  /** Open the pay-per-use sheet. Resolves true once the carrier confirmed the charge. */
  requestPayment: (purpose: CaasPurpose) => Promise<boolean>;
  /** True when an API error means "this needs a paid action" (HTTP 402), plus which action. */
  paymentPurpose: (e: unknown) => CaasPurpose | null;
}

const Ctx = createContext<Gate | null>(null);

/**
 * Pay-per-use plumbing (design.md Screen 12). A Free user hits a paid action, the server answers 402
 * PAYMENT_REQUIRED with the purpose, and the screen opens this sheet, then repeats the action.
 */
export function PaymentGateProvider({ children }: { children: ReactNode }) {
  const [purpose, setPurpose] = useState<CaasPurpose | null>(null);
  const [resolver, setResolver] = useState<((ok: boolean) => void) | null>(null);

  const requestPayment = useCallback(
    (p: CaasPurpose) =>
      new Promise<boolean>((resolve) => {
        setPurpose(p);
        setResolver(() => resolve);
      }),
    [],
  );

  const finish = (ok: boolean) => {
    resolver?.(ok);
    setResolver(null);
    setPurpose(null);
  };

  const value = useMemo<Gate>(
    () => ({
      requestPayment,
      paymentPurpose: (e) => {
        if (e instanceof ApiError && e.status === 402 && e.code === 'PAYMENT_REQUIRED') {
          const m = e.message as CaasPurpose | 'PREMIUM';
          return m === 'SCAN' || m === 'DOCTOR_SUMMARY' || m === 'REPORT_EXPLAIN' ? m : null;
        }
        return null;
      },
    }),
    [requestPayment],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <PaymentSheet purpose={purpose} onDone={finish} />
    </Ctx.Provider>
  );
}

export function usePaymentGate(): Gate {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePaymentGate must be used inside PaymentGateProvider');
  return v;
}
