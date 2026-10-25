import { getInstallationConfig } from '../../lib/config.js';

export async function dashboardAggregate(context) {
  const config = await getInstallationConfig();
  return { ok: true, data: { canvases: [], configVersion: config.configVersion || '' } };
}
