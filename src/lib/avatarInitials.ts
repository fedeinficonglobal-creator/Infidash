export function getAvatarInitials(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('es')).join('') || 'U';
}
