// Payment provider settings from the environment. A provider without all of
// its keys is off: no button, no endpoint. No keys at all = no payments UI.
export type ClickConfig = { serviceId: string; merchantId: string; secretKey: string };
/** `test`: Payme's sandbox (PAYME_TEST_MODE); orders it confirms are stamped testMode. */
export type PaymeConfig = { merchantId: string; key: string; test: boolean };

export type BillingConfig = {
  click: ClickConfig | null;
  payme: PaymeConfig | null;
  /** When true, downloading the corrected file needs a paid order or a subscription. */
  requiredForExport: boolean;
  appUrl: string | null;
};

const val = (env: Record<string, string | undefined>, key: string): string | null => env[key]?.trim() || null;

export function billingConfig(env: Record<string, string | undefined> = process.env): BillingConfig {
  const clickService = val(env, 'CLICK_SERVICE_ID');
  const clickMerchant = val(env, 'CLICK_MERCHANT_ID');
  const clickSecret = val(env, 'CLICK_SECRET_KEY');
  const paymeMerchant = val(env, 'PAYME_MERCHANT_ID');
  const paymeTest = env['PAYME_TEST_MODE']?.trim() === 'true';
  // Payme issues separate keys for its sandbox and production.
  const paymeKey = paymeTest ? val(env, 'PAYME_TEST_KEY') : val(env, 'PAYME_KEY');
  // The sandbox confirms payments nobody made: never on a production server unless explicitly allowed.
  const paymeTestRefused = paymeTest && env['NODE_ENV'] === 'production' && env['PAYME_TEST_ALLOW_PROD']?.trim() !== '1';
  const appUrl = (val(env, 'APP_URL') ?? val(env, 'NEXT_PUBLIC_SITE_URL'))?.replace(/\/+$/, '') ?? null;
  return {
    click: clickService && clickMerchant && clickSecret ? { serviceId: clickService, merchantId: clickMerchant, secretKey: clickSecret } : null,
    payme: paymeMerchant && paymeKey && !paymeTestRefused ? { merchantId: paymeMerchant, key: paymeKey, test: paymeTest } : null,
    requiredForExport: env['BILLING_REQUIRED_FOR_EXPORT']?.trim() === 'true',
    appUrl: appUrl && /^https?:\/\//.test(appUrl) ? appUrl : null,
  };
}

export function paymentsEnabled(config: BillingConfig): boolean {
  return config.click !== null || config.payme !== null;
}
