import { runSmoke } from '../src/ops/smoke.js';

// Usage (from the repo root):
//   APPLINK_APP_ID=... APPLINK_PASSWORD=... \
//   APPLINK_SUBSCRIPTION_QUERY_BASE_URL=https://api.applink.com.bd/subscription/query-base \
//   pnpm applink:smoke
// Run it ON THE VM for the real check: Applink allow-lists the VM's IP, not your laptop's.
const result = await runSmoke(process.env);
for (const line of result.lines) console.log(line);
process.exit(result.code);
