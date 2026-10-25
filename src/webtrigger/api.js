export const handler = async (req) => {
  return {
    statusCode: 501,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' } }),
  };
};
