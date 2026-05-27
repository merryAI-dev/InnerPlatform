import { getAuthInstance } from '../lib/firebase';
import {
  isPlatformApiEnabled,
  processProjectRequestContractViaBff,
  type ActorLike,
} from '../lib/platform-bff-client';

export async function uploadProjectRequestContractFile(params: {
  tenantId: string;
  actor: ActorLike | null | undefined;
  file: File;
}) {
  if (!params.actor?.uid) {
    throw new Error('로그인 정보를 확인할 수 없습니다.');
  }
  if (!isPlatformApiEnabled()) {
    throw new Error('계약서 업로드는 플랫폼 API가 켜진 환경에서만 사용할 수 있습니다.');
  }

  const idToken = params.actor.idToken
    || await getAuthInstance()?.currentUser?.getIdToken()
    || undefined;
  const processed = await processProjectRequestContractViaBff({
    tenantId: params.tenantId,
    actor: {
      ...params.actor,
      idToken,
    },
    file: params.file,
  });

  return {
    contractDocument: processed.contractDocument,
    contractAnalysis: processed.analysis,
  };
}
