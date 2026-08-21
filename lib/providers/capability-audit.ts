import { listProviderDefinitions } from './registry';
import { resolveCapabilities } from './capability-resolver';

export type CapabilityAuditResult = {
  provider: string;
  model?: string;
  capabilities: ReturnType<typeof resolveCapabilities>;
};

/**
 * Audit declared provider capabilities without turning local fallbacks into
 * provider verification. This intentionally does not call external providers.
 */
export function runCapabilityAudit(): CapabilityAuditResult[] {
  const results: CapabilityAuditResult[] = [];

  for (const provider of listProviderDefinitions()) {
    if (provider.models.length === 0) {
      results.push({
        provider: provider.key,
        capabilities: resolveCapabilities(provider, undefined, undefined, { includeFallbacks: false }),
      });
      continue;
    }

    for (const model of provider.models) {
      results.push({
        provider: provider.key,
        model: model.id,
        capabilities: resolveCapabilities(provider, model, undefined, { includeFallbacks: false }),
      });
    }
  }

  return results;
}
