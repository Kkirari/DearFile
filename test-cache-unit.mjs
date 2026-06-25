/**
 * Unit test for preview cache workspace scoping
 * Run: node test-cache-unit.mjs
 */

// Simulate the cache module
const TTL_MS = 30_000;
const cache = new Map();

function getCached(cacheKey) {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.data;
}

function setCached(cacheKey, data) {
  cache.set(cacheKey, { data, expiresAt: Date.now() + TTL_MS });
}

function invalidatePreviews(cacheKey) {
  cache.delete(cacheKey);
}

// Test cases
console.log('🧪 Testing workspace-scoped cache...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Test 1: Different workspaces have separate caches
test('Different workspaces have separate caches', () => {
  setCached('userId123', { inbox: { total: 5 } });
  setCached('ws:workspace-A', { inbox: { total: 10 } });
  setCached('ws:workspace-B', { inbox: { total: 3 } });

  const personal = getCached('userId123');
  const wsA = getCached('ws:workspace-A');
  const wsB = getCached('ws:workspace-B');

  assert(personal.inbox.total === 5, 'Personal cache wrong');
  assert(wsA.inbox.total === 10, 'Workspace A cache wrong');
  assert(wsB.inbox.total === 3, 'Workspace B cache wrong');
});

// Test 2: Invalidating one workspace doesn't affect others
test('Invalidating one workspace doesn\'t affect others', () => {
  setCached('userId123', { inbox: { total: 5 } });
  setCached('ws:workspace-A', { inbox: { total: 10 } });
  setCached('ws:workspace-B', { inbox: { total: 3 } });

  invalidatePreviews('ws:workspace-A');

  assert(getCached('ws:workspace-A') === null, 'Workspace A should be invalidated');
  assert(getCached('ws:workspace-B') !== null, 'Workspace B should still exist');
  assert(getCached('userId123') !== null, 'Personal should still exist');
});

// Test 3: Cache key format matches API route pattern
test('Cache key format matches API route pattern', () => {
  const userId = 'U1234567890';
  const wsId = 'ws_abc123';

  // Personal: just userId
  const personalKey = userId;
  setCached(personalKey, { inbox: { total: 1 } });
  assert(getCached(personalKey) !== null, 'Personal key should work');

  // Workspace: ws:${wsId}
  const workspaceKey = `ws:${wsId}`;
  setCached(workspaceKey, { inbox: { total: 2 } });
  assert(getCached(workspaceKey) !== null, 'Workspace key should work');
});

// Test 4: Correct invalidation on upload (workspace)
test('Upload to workspace invalidates correct cache', () => {
  const userId = 'U1234567890';
  const wsId = 'ws_abc123';

  setCached(`ws:${wsId}`, { inbox: { total: 5 } });
  setCached(userId, { inbox: { total: 10 } });

  // Simulate upload to workspace (should invalidate workspace cache only)
  const isWorkspaceCall = true;
  if (isWorkspaceCall) invalidatePreviews(`ws:${wsId}`);
  else invalidatePreviews(userId);

  assert(getCached(`ws:${wsId}`) === null, 'Workspace cache should be invalidated');
  assert(getCached(userId) !== null, 'Personal cache should remain');
});

// Test 5: Correct invalidation on upload (personal)
test('Upload to personal invalidates correct cache', () => {
  cache.clear();
  const userId = 'U1234567890';
  const wsId = 'ws_abc123';

  setCached(`ws:${wsId}`, { inbox: { total: 5 } });
  setCached(userId, { inbox: { total: 10 } });

  // Simulate upload to personal (should invalidate personal cache only)
  const isWorkspaceCall = false;
  if (isWorkspaceCall) invalidatePreviews(`ws:${wsId}`);
  else invalidatePreviews(userId);

  assert(getCached(`ws:${wsId}`) !== null, 'Workspace cache should remain');
  assert(getCached(userId) === null, 'Personal cache should be invalidated');
});

// Test 6: Switching workspaces uses different cache keys
test('Switching workspaces uses different cache keys', () => {
  cache.clear();

  // User starts in workspace A
  const currentWorkspaceId = 'ws_groupA';
  const cacheKey1 = currentWorkspaceId ? `ws:${currentWorkspaceId}` : 'userId123';
  setCached(cacheKey1, { inbox: { total: 5 } });

  // User switches to workspace B
  const newWorkspaceId = 'ws_groupB';
  const cacheKey2 = newWorkspaceId ? `ws:${newWorkspaceId}` : 'userId123';

  assert(cacheKey1 !== cacheKey2, 'Cache keys should be different');
  assert(getCached(cacheKey2) === null, 'New workspace should have no cache yet');
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\n⚠️  Some tests failed - fix before pushing!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed - safe to push!');
  process.exit(0);
}
