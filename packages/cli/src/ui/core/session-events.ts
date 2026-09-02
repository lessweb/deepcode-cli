export function isActiveSessionEvent(activeSessionId: string | null, eventSessionId?: string): boolean {
  return activeSessionId !== null && eventSessionId === activeSessionId;
}

export function claimPlanImplementation(inFlight: { current: boolean }): boolean {
  if (inFlight.current) {
    return false;
  }
  inFlight.current = true;
  return true;
}
