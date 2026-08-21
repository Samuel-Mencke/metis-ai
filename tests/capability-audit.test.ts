import assert from 'node:assert/strict';
import test from 'node:test';
import { runCapabilityAudit } from '../lib/providers/capability-audit';
import { resolveCapabilities } from '../lib/providers/capability-resolver';
import type { ProviderDefinition } from '../lib/providers/types';

test('capability audit does not promote local fallbacks to verification', () => {
  const result = runCapabilityAudit();
  assert.ok(result.length > 0);
  const openAi = result.find((item) => item.provider === 'openai' && item.model === 'gpt-5');
  assert.ok(openAi);
  assert.equal(openAi.capabilities.verified.agent, false);
  assert.deepEqual(openAi.capabilities.fallbacks, []);
});

test('capability resolver keeps fallback behavior enabled by default', () => {
  const provider = {
    key: 'test',
    name: 'Test',
    description: '',
    kind: 'compatible',
    authTypes: ['local'],
    capabilities: { streaming: true, tools: false, vision: false, agent: false, modelDiscovery: false },
    models: [],
    setupHint: '',
  } satisfies ProviderDefinition;

  const result = resolveCapabilities(provider);
  assert.equal(result.verified.tools, true);
  assert.equal(result.verified.agent, true);
  assert.deepEqual(result.fallbacks, ['embedded-tool-fallback', 'metis-agent-runtime']);
});
