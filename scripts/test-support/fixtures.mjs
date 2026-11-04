/**
 * Shared fixtures for resolver tests. Shapes mirror what Jira's enhanced search
 * returns (issue properties alongside fields), so the code under test sees the
 * same thing it sees in production.
 */

export const ADMIN_CONTEXT = {
  accountId: 'acc-admin',
  userAccess: { hasAccess: true, isAdmin: true },
};

export const USER_CONTEXT = {
  accountId: 'acc-user',
  userAccess: { hasAccess: true, isAdmin: false },
};

export const CREATE_CLAIMS = {
  sub: 'acc-admin',
  scope: 'create',
  permittedProjects: '*',
  isAdmin: false,
};

export const THUMBNAIL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==';

export function pinMetadata({ canvas, canvasId, url, position = '{"x":100,"y":200}', selector = null }) {
  const pin = { canvas, url, position, selector };
  if (canvasId) pin.canvasId = canvasId;
  return { version: 1, pin };
}

export function jiraIssue({
  key,
  metadata = null,
  statusCategory = 'new',
  statusName = 'To Do',
  projectKey = 'TEST',
  updated = '2026-11-04T10:00:00.000+0000',
  assignee = null,
  reporter = null,
  summary = null,
}) {
  return {
    key,
    fields: {
      summary: summary || `Ticket ${key}`,
      status: { name: statusName, statusCategory: { key: statusCategory } },
      project: { key: projectKey },
      updated,
      assignee,
      reporter,
      issuetype: { id: '10001', name: 'Task' },
      priority: null,
      parent: null,
      created: updated,
    },
    properties: metadata ? { 'com.jiratack.metadata': metadata } : {},
  };
}

export function searchPage(issues, extra = {}) {
  return { issues, isLast: true, ...extra };
}
