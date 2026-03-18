export function hasUnsavedChanges(states: Record<string, string | undefined>): boolean {
  return Object.values(states).some((state) => state === 'dirty' || state === 'saving' || state === 'error');
}

