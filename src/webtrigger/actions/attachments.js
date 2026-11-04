import api, { route } from '@forge/api';

/**
 * Attachment transport shared by ticket creation and pin moves.
 *
 * `attachScreenshot` keeps its historical name and its `dataUrl` parameter:
 * a rename here once left the multipart body reading a stale variable name and
 * every attachment threw. Do not rename either without changing both sides.
 */

function buildMultipartBody(fileBuffer, filename, mimeType) {
  const boundary = `----JiraTack${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const preamble = Buffer.from(
    `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`
      + `Content-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const epilogue = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return {
    body: Buffer.concat([preamble, fileBuffer, epilogue]),
    boundary,
  };
}

export async function attachScreenshot(issueKey, dataUrl, filenameOverride) {
  // Any file type: screenshots, documents and WebM recordings share this path.
  // Restricting it to image/* silently dropped every non-image attachment.
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    throw new Error('Unsupported attachment data URL.');
  }

  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext = (mime.split('/')[1] || 'bin').split('+')[0];
  const filename = filenameOverride || `jiratack-${issueKey}.${ext}`;
  const { body, boundary } = buildMultipartBody(buffer, filename, mime);

  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/attachments`, {
    method: 'POST',
    headers: {
      'X-Atlassian-Token': 'no-check',
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch (e) {
      detail = '';
    }
    throw new Error(`Attachment upload failed with HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }

  console.log('[JiraTack] Screenshot attached to issue:', issueKey);
}
