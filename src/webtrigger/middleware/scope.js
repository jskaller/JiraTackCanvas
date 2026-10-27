export function canAccessProject(permittedProjects, projectKey) {
  if (permittedProjects === '*') return true;
  if (!Array.isArray(permittedProjects)) return false;
  return permittedProjects.includes(projectKey);
}

export function canAccessCanvas(claims, canvasId) {
  if (!claims || claims.scope !== 'guest_create') return true;
  if (!Array.isArray(claims.permittedCanvases)) return false;
  return claims.permittedCanvases.includes(canvasId);
}

export function scopeAllowed(claims, allowedScopes) {
  return Array.isArray(allowedScopes) && allowedScopes.includes(claims.scope);
}
