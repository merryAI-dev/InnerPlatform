export type AppWriteTarget = 'bff' | 'firestore' | 'local';

export interface AppWriteStrategy {
  target: AppWriteTarget;
  mirrorRemoteWritesLocally: boolean;
}

export function resolveAppWriteStrategy(
  platformApiEnabled: boolean,
  firestoreEnabled: boolean,
): AppWriteStrategy {
  if (platformApiEnabled) {
    return {
      target: 'bff',
      mirrorRemoteWritesLocally: true,
    };
  }

  if (firestoreEnabled) {
    return {
      target: 'firestore',
      mirrorRemoteWritesLocally: false,
    };
  }

  return {
    target: 'local',
    mirrorRemoteWritesLocally: false,
  };
}
