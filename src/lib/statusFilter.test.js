import assert from 'node:assert/strict';
import { isFilteredStatus, isRemovedStatus } from './statusFilter.js';

// Default rule: the Done status category.
assert.equal(isFilteredStatus({ id: '1', statusCategory: { key: 'done' } }, null), true);
assert.equal(isFilteredStatus({ id: '2', statusCategory: { key: 'indeterminate' } }, null), false);
assert.equal(isFilteredStatus({ id: '3', statusCategory: { key: 'new' } }, {}), false);
assert.equal(isFilteredStatus(null, null), false);

// An explicit list is authoritative, including statuses outside Done.
assert.equal(isFilteredStatus({ id: '4', statusCategory: { key: 'new' } }, { filteredStatusIds: ['4'] }), true);
assert.equal(isFilteredStatus({ id: '1', statusCategory: { key: 'done' } }, { filteredStatusIds: ['4'] }), false);
assert.equal(isFilteredStatus({ id: '1', statusCategory: { key: 'done' } }, { filteredStatusIds: [] }), false);

// "Removed" is a permanent exclusion, independent of any rule.
assert.equal(isRemovedStatus({ id: '9', name: 'Removed', statusCategory: { key: 'done' } }), true);
assert.equal(isRemovedStatus({ id: '9', name: ' removed ' }), true);
assert.equal(isRemovedStatus({ id: '9', name: 'Done', statusCategory: { key: 'done' } }), false);
assert.equal(isRemovedStatus(null), false);

console.log('PASS  status filter rules');
