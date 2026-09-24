export function canPersistPlanRows(activeClientId: string, loadedClientId: string | null) {
  return loadedClientId === activeClientId;
}
