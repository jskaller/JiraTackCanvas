export function canAccessProject(permittedProjects, projectKey) {
  if (permittedProjects === '*') return true;
  if (!Array.isArray(permittedProjects)) return false;
  return permittedProjects.includes(projectKey);
}

export function scopeAllowed(claims, allowedScopes) {
  return Array.isArray(allowedScopes) && allowedScopes.includes(claims.scope);
}
