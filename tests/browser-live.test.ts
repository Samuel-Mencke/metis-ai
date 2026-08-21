import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesBrowserLiveEvent } from '../lib/browser-live-filter';

const event = {
  ownerId: 'user-a',
  chatId: 'chat-a',
  tabId: 'tab-a',
};

test('browser live event filter isolates user, chat, and tab', () => {
  assert.equal(matchesBrowserLiveEvent(event, 'user-a', 'chat-a', 'tab-a'), true);
  assert.equal(matchesBrowserLiveEvent(event, 'user-b', 'chat-a', 'tab-a'), false);
  assert.equal(matchesBrowserLiveEvent(event, 'user-a', 'chat-b', 'tab-a'), false);
  assert.equal(matchesBrowserLiveEvent(event, 'user-a', 'chat-a', 'tab-b'), false);
});

test('browser live event filter allows an intentionally unscoped chat or tab', () => {
  assert.equal(matchesBrowserLiveEvent(event, 'user-a', null, null), true);
  assert.equal(matchesBrowserLiveEvent(event, 'user-a', 'chat-a', null), true);
  assert.equal(matchesBrowserLiveEvent(event, 'user-a', null, 'tab-a'), true);
});
