import api from '@forge/api';
import { createSeedTicket } from '../../lib/canvas.js';

export async function createCanvas(payload, claims) {
  return createSeedTicket({
    requester: api.asApp(),
    reporterAccountId: claims && claims.sub,
    canvasName: payload && payload.canvasName,
    targetUrl: payload && payload.targetUrl,
    projectKey: payload && payload.projectKey,
    issueTypeId: payload && payload.issueTypeId,
    permittedProjects: claims && claims.permittedProjects,
  });
}
