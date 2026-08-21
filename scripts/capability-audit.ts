import { runCapabilityAudit } from '../lib/providers/capability-audit';

const result = runCapabilityAudit();
console.log(JSON.stringify({
  checked: result.length,
  providers: result,
}, null, 2));
