import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';
import { isLicensedUser } from '../../lib/license.js';
import { loadJiraTackIssue } from '../../lib/issueContext.js';
import { mergeDescription, splitDescription } from '../../lib/descriptionBlocks.js';

const MAX_SUMMARY = 215;
const SUMMARY_PREFIX = '[JiraTack]';

function hasField(input, name) {
  return Object.prototype.hasOwnProperty.call(input, name);
}

export async function updateIssue(payload, claims) {
  const issueKey = payload && payload.issueKey;
  const input = (payload && payload.fields) || {};

  if (typeof issueKey !== 'string' || issueKey.length === 0) {
    return errorResult('BAD_REQUEST', 'issueKey is required.');
  }

  const supported = ['statusId', 'priorityId', 'assigneeAccountId', 'summary', 'descriptionText'];
  if (!supported.some((name) => hasField(input, name))) {
    return errorResult('BAD_REQUEST', 'No supported fields were provided.');
  }

  if (hasField(input, 'statusId') && (typeof input.statusId !== 'string' || input.statusId.length === 0)) {
    return errorResult('BAD_REQUEST', 'statusId must be a non-empty string.');
  }
  if (hasField(input, 'summary') && typeof input.summary !== 'string') {
    return errorResult('BAD_REQUEST', 'summary must be a string.');
  }
  if (hasField(input, 'descriptionText') && typeof input.descriptionText !== 'string') {
    return errorResult('BAD_REQUEST', 'descriptionText must be a string.');
  }

  const context = await loadJiraTackIssue(issueKey, claims || {});
  if (!context.ok) return context.error;

  const updateFields = {};

  if (hasField(input, 'priorityId')) {
    updateFields.priority = input.priorityId ? { id: String(input.priorityId) } : null;
  }

  if (hasField(input, 'assigneeAccountId')) {
    const accountId = input.assigneeAccountId ? String(input.assigneeAccountId) : null;
    if (accountId && claims && claims.scope === 'guest_create' && !(await isLicensedUser(accountId))) {
      return errorResult(
        'VALIDATION_ERROR',
        'Guest tickets must be assigned to a licensed JiraTack user.',
      );
    }
    updateFields.assignee = accountId ? { accountId } : null;
  }

  if (hasField(input, 'summary')) {
    const raw = input.summary.trim();
    if (raw.length === 0) {
      return errorResult('VALIDATION_ERROR', 'Summary cannot be empty.');
    }
    if (raw.length > MAX_SUMMARY) {
      return errorResult('VALIDATION_ERROR', `Summary must be ${MAX_SUMMARY} characters or fewer.`);
    }
    updateFields.summary = raw.startsWith(SUMMARY_PREFIX) ? raw : `${SUMMARY_PREFIX} ${raw}`;
  }

  if (hasField(input, 'descriptionText')) {
    const split = splitDescription(context.fields.description);
    if (!split.marker) {
      return errorResult(
        'VALIDATION_ERROR',
        'This description is missing the JiraTack pin marker. Edit it in Jira instead.',
      );
    }
    updateFields.description = mergeDescription(input.descriptionText, split);
  }

  if (input.statusId) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: input.statusId } }),
    });
    if (!res.ok) {
      if (res.status === 400) {
        return errorResult('VALIDATION_ERROR', 'Jira rejected the transition.');
      }
      return errorResult('INTERNAL', `Jira transition failed with HTTP ${res.status}.`);
    }
  }

  if (Object.keys(updateFields).length > 0) {
    const res = await api.asApp().requestJira(
      route`/rest/api/3/issue/${issueKey}?overrideScreenSecurity=true&overrideEditableFlag=true`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: updateFields }),
      },
    );
    if (!res.ok) {
      let detail = '';
      try {
        detail = await res.text();
      } catch (e) {
        detail = '';
      }
      console.error('[JiraTack] updateIssue failed:', issueKey, Object.keys(updateFields), res.status, detail);
      if (res.status === 400) {
        return errorResult('VALIDATION_ERROR', 'Jira rejected the issue update.', { raw: detail.slice(0, 500) });
      }
      return errorResult('INTERNAL', `Jira issue update failed with HTTP ${res.status}.`, { raw: detail.slice(0, 500) });
    }
  }

  return {
    ok: true,
    data: { configVersion: context.config.configVersion || '' },
  };
}
