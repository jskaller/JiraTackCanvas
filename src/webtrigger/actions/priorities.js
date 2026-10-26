import api, { route } from '@forge/api';
import { errorResult } from '../../lib/errors.js';

export async function getPriorities() {
  let res;
  try {
    res = await api.asApp().requestJira(route`/rest/api/3/priority`);
  } catch (e) {
    return errorResult('INTERNAL', e && e.message ? e.message : String(e));
  }

  if (!res.ok) {
    return errorResult('INTERNAL', `Jira priorities lookup failed with HTTP ${res.status}.`);
  }

  const data = await res.json();
  const list = Array.isArray(data) ? data : ((data && data.values) || []);
  const priorities = list.map((priority) => ({ id: priority.id, name: priority.name }));

  return { ok: true, data: { priorities } };
}
