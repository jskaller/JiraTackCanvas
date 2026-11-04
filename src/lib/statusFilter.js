/**
 * Status visibility rules (D38).
 *
 * One rule, configured per project: which statuses are filtered out of the
 * canvas. `filteredStatusIds` is the authoritative list; when it is not set the
 * Done status category is filtered. A status literally named "Removed" is never
 * returned to the client at all, whatever the toggle says.
 */

export function isRemovedStatus(status) {
  return Boolean(status && String(status.name || '').trim().toLowerCase() === 'removed');
}

export function isFilteredStatus(status, projectConfig) {
  if (!status) return false;
  const configured = projectConfig && Array.isArray(projectConfig.filteredStatusIds)
    ? projectConfig.filteredStatusIds.map((id) => String(id))
    : null;
  if (configured) return configured.includes(String(status.id || ''));
  const category = status.statusCategory && status.statusCategory.key;
  return category === 'done';
}
