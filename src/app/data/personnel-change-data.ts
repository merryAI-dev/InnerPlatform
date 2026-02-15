// ═══════════════════════════════════════════════════════════════
// 인력변경 요청·증빙서류·이력 데이터
// KOICA 사업 인력 배치 변경 워크플로 지원
// ═══════════════════════════════════════════════════════════════

export type ChangeRequestState = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'REVISION_REQUESTED';

export type DocumentType =
  | 'CHANGE_REQUEST_FORM'   // 인력변경요청서
  | 'CAREER_CERT'           // 경력증명서
  | 'EMPLOYMENT_CERT'       // 재직증명서
  | 'RATE_CHANGE_CONFIRM'   // 투입율변경확인서
  | 'GRADE_CHANGE_CERT'     // 등급변경확인서
  | 'ASSIGNMENT_LETTER'     // 투입확인서
  | 'RESIGNATION_LETTER'    // 투입해제확인서
  | 'MONTHLY_REPORT'        // 월간보고서
  | 'KOICA_APPROVAL'        // KOICA 승인서
  | 'INTERNAL_MEMO'         // 내부품의서
  | 'OTHER';

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  CHANGE_REQUEST_FORM: '인력변경요청서',
  CAREER_CERT: '경력증명서',
  EMPLOYMENT_CERT: '재직증명서',
  RATE_CHANGE_CONFIRM: '투입율변경확인서',
  GRADE_CHANGE_CERT: '등급변경확인서',
  ASSIGNMENT_LETTER: '투입확인서',
  RESIGNATION_LETTER: '투입해제확인서',
  MONTHLY_REPORT: '월간보고서',
  KOICA_APPROVAL: 'KOICA 승인서',
  INTERNAL_MEMO: '내부품의서',
  OTHER: '기타',
};

export const DOC_TYPE_ICONS: Record<DocumentType, string> = {
  CHANGE_REQUEST_FORM: 'FileText',
  CAREER_CERT: 'Award',
  EMPLOYMENT_CERT: 'Building2',
  RATE_CHANGE_CONFIRM: 'Percent',
  GRADE_CHANGE_CERT: 'ArrowUpDown',
  ASSIGNMENT_LETTER: 'UserPlus',
  RESIGNATION_LETTER: 'UserMinus',
  MONTHLY_REPORT: 'BarChart3',
  KOICA_APPROVAL: 'Shield',
  INTERNAL_MEMO: 'FileSignature',
  OTHER: 'File',
};

export const STATE_LABELS: Record<ChangeRequestState, string> = {
  DRAFT: '초안',
  SUBMITTED: '제출됨',
  APPROVED: '승인',
  REJECTED: '반려',
  REVISION_REQUESTED: '수정요청',
};

export interface EvidenceDocument {
  id: string;
  type: DocumentType;
  fileName: string;
  fileSize: string;       // e.g. "1.2 MB"
  mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'application/xlsx';
  uploadedBy: string;
  uploadedAt: string;     // ISO date
  pageCount?: number;     // PDF pages
  status: 'VALID' | 'EXPIRED' | 'PENDING_REVIEW';
  notes?: string;
  // Mock PDF preview data
  previewPages?: PdfPreviewPage[];
}

export interface PdfPreviewPage {
  pageNum: number;
  title: string;          // what the page shows
  sections: string[];     // summary of sections on page
}

export interface StaffChangeItem {
  staffName: string;
  changeType: 'ADD' | 'REMOVE' | 'RATE_CHANGE' | 'GRADE_CHANGE' | 'MONTHS_CHANGE' | 'REPLACEMENT';
  description: string;
  before?: {
    grade?: string;
    rate?: number;
    months?: number;
    monthlyPay?: number;
    total?: number;
  };
  after?: {
    grade?: string;
    rate?: number;
    months?: number;
    monthlyPay?: number;
    total?: number;
  };
  replacedBy?: string;
  replacedFrom?: string;
  requiredDocs: DocumentType[];
}

export interface ChangeRequest {
  id: string;
  projectId: string;
  projectName: string;
  projectShortName: string;
  title: string;
  description: string;
  state: ChangeRequestState;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  requestedBy: string;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewComment?: string;
  effectiveDate: string;  // 적용 일자
  changes: StaffChangeItem[];
  documents: EvidenceDocument[];
  timeline: TimelineEvent[];
  costImpact: {
    beforeTotal: number;
    afterTotal: number;
    difference: number;
  };
}

export interface TimelineEvent {
  id: string;
  action: string;
  actor: string;
  timestamp: string;
  comment?: string;
  type: 'CREATE' | 'UPDATE' | 'SUBMIT' | 'APPROVE' | 'REJECT' | 'REVISION' | 'UPLOAD' | 'COMMENT';
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA
// ═══════════════════════════════════════════════════════════════

function mockPdfPages(title: string, sections: string[][]): PdfPreviewPage[] {
  return sections.map((s, i) => ({
    pageNum: i + 1,
    title: i === 0 ? title : `${title} (${i + 1}/${sections.length})`,
    sections: s,
  }));
}

export const CHANGE_REQUESTS: ChangeRequest[] = [
  // ── 1. CTS 2023~2026: 강민경 이현미 대체 + 김다은 투입율 변경 ──
  {
    id: 'cr-001',
    projectId: 'cts_2326',
    projectName: '2023~2026 CTS 참여기업 역량강화',
    projectShortName: 'CTS 2023~2026',
    title: '이현미→강민경 대체 투입 및 김다은 투입율 조정',
    description: '이현미 퇴사에 따른 강민경 대체 투입(연구보조원 90%) 및 김다은 투입율 30%→20% 하향 조정',
    state: 'APPROVED',
    priority: 'HIGH',
    requestedBy: '민가람',
    requestedAt: '2026-01-08T09:30:00',
    reviewedBy: '김정태',
    reviewedAt: '2026-01-10T14:20:00',
    reviewComment: '승인합니다. KOICA 사전 통보 완료 확인.',
    effectiveDate: '2026-01-15',
    changes: [
      {
        staffName: '이현미',
        changeType: 'REMOVE',
        description: '이현미 퇴사로 인한 투입 해제',
        before: { grade: '연구보조원', rate: 90, months: 9, monthlyPay: 3226156, total: 29035404 },
        requiredDocs: ['RESIGNATION_LETTER', 'CHANGE_REQUEST_FORM'],
      },
      {
        staffName: '강민경',
        changeType: 'REPLACEMENT',
        description: '이현미 대체 투입 (연구보조원 90%)',
        after: { grade: '연구보조원', rate: 90, months: 5, monthlyPay: 3226156, total: 16130780 },
        replacedFrom: '이현미',
        requiredDocs: ['ASSIGNMENT_LETTER', 'CAREER_CERT', 'EMPLOYMENT_CERT'],
      },
      {
        staffName: '김다은',
        changeType: 'RATE_CHANGE',
        description: '투입율 30%→20% 하향 조정',
        before: { grade: '연구보조원', rate: 30, months: 9, monthlyPay: 1075386, total: 9678474 },
        after: { grade: '연구보조원', rate: 20, months: 5, monthlyPay: 716924, total: 3584620 },
        requiredDocs: ['RATE_CHANGE_CONFIRM'],
      },
    ],
    documents: [
      {
        id: 'doc-001',
        type: 'CHANGE_REQUEST_FORM',
        fileName: 'CTS_2326_인력변경요청서_20260108.pdf',
        fileSize: '2.4 MB',
        mimeType: 'application/pdf',
        uploadedBy: '민가람',
        uploadedAt: '2026-01-08T09:30:00',
        pageCount: 3,
        status: 'VALID',
        previewPages: mockPdfPages('인력변경요청서', [
          ['문서번호: MYSC-CTS26-CR-001', '요청일: 2026.01.08', '사업명: CTS 2023~2026', '변경 사유 요약'],
          ['변경 대상 인력 상세', '이현미 → 강민경 대체 사유', '김다은 투입율 변경 사유'],
          ['비용 변동 분석', '서명란: 요청자/검토자/승인자'],
        ]),
      },
      {
        id: 'doc-002',
        type: 'RESIGNATION_LETTER',
        fileName: '이현미_투입해제확인서_20260105.pdf',
        fileSize: '890 KB',
        mimeType: 'application/pdf',
        uploadedBy: '민가람',
        uploadedAt: '2026-01-08T10:15:00',
        pageCount: 1,
        status: 'VALID',
        previewPages: mockPdfPages('투입해제확인서', [
          ['대상자: 이현미', '해제일: 2026.01.15', '사유: 자발적 퇴사', '확인 서명'],
        ]),
      },
      {
        id: 'doc-003',
        type: 'CAREER_CERT',
        fileName: '강민경_경력증명서_20260107.pdf',
        fileSize: '1.1 MB',
        mimeType: 'application/pdf',
        uploadedBy: '민가람',
        uploadedAt: '2026-01-08T10:20:00',
        pageCount: 2,
        status: 'VALID',
        previewPages: mockPdfPages('경력증명서', [
          ['성명: 강민경', '학력: 연세대학교 경제학과', '주요 경력 사항'],
          ['KOICA 관련 프로젝트 경험', '발급일: 2026.01.07', '발급기관: (주)MYSC'],
        ]),
      },
      {
        id: 'doc-004',
        type: 'EMPLOYMENT_CERT',
        fileName: '강민경_재직증명서_20260107.pdf',
        fileSize: '560 KB',
        mimeType: 'application/pdf',
        uploadedBy: '민가람',
        uploadedAt: '2026-01-08T10:25:00',
        pageCount: 1,
        status: 'VALID',
        previewPages: mockPdfPages('재직증명서', [
          ['성명: 강민경', '소속: (주)MYSC CIC 사업팀', '입사일: 2024.03.01', '직급: 매니저', '발급일: 2026.01.07'],
        ]),
      },
      {
        id: 'doc-005',
        type: 'ASSIGNMENT_LETTER',
        fileName: '강민경_투입확인서_20260108.pdf',
        fileSize: '740 KB',
        mimeType: 'application/pdf',
        uploadedBy: '민가람',
        uploadedAt: '2026-01-08T10:30:00',
        pageCount: 1,
        status: 'VALID',
        previewPages: mockPdfPages('투입확인서', [
          ['대상자: 강민경', '투입일: 2026.01.15', '등급: 연구보조원', '투입율: 90%', '기간: 5개월'],
        ]),
      },
      {
        id: 'doc-006',
        type: 'RATE_CHANGE_CONFIRM',
        fileName: '김다은_투입율변경확인서_20260108.pdf',
        fileSize: '480 KB',
        mimeType: 'application/pdf',
        uploadedBy: '민가람',
        uploadedAt: '2026-01-08T10:35:00',
        pageCount: 1,
        status: 'VALID',
        previewPages: mockPdfPages('투입율변경확인서', [
          ['대상자: 김다은', '변경전 투입율: 30%', '변경후 투입율: 20%', '변경 사유: 타 사업 투입 우선'],
        ]),
      },
      {
        id: 'doc-007',
        type: 'KOICA_APPROVAL',
        fileName: 'KOICA_CTS_인력변경승인_20260110.pdf',
        fileSize: '1.8 MB',
        mimeType: 'application/pdf',
        uploadedBy: '김정태',
        uploadedAt: '2026-01-10T14:15:00',
        pageCount: 2,
        status: 'VALID',
        previewPages: mockPdfPages('KOICA 인력변경 승인서', [
          ['문서번호: KOICA-2026-0108', '사업명: CTS 2023~2026', '변경 내역 요약', '승인 사항'],
          ['KOICA 담당자 서명', '승인일: 2026.01.10', '조건부 승인 사항 (해당없음)'],
        ]),
      },
    ],
    timeline: [
      { id: 'tl-001', action: '변경 요청 생성', actor: '민가람', timestamp: '2026-01-08T09:30:00', type: 'CREATE' },
      { id: 'tl-002', action: '증빙서류 6건 업로드', actor: '민가람', timestamp: '2026-01-08T10:35:00', type: 'UPLOAD' },
      { id: 'tl-003', action: '검토 요청 (SUBMITTED)', actor: '민가람', timestamp: '2026-01-08T11:00:00', type: 'SUBMIT', comment: '검토 부탁드립니다. 이현미님 퇴사일이 1/15이라 긴급합니다.' },
      { id: 'tl-004', action: '코멘트', actor: '박정호', timestamp: '2026-01-09T10:20:00', type: 'COMMENT', comment: '강민경님 CTS 경험 있으니 대체 적합. KOICA 사전 통보 필요.' },
      { id: 'tl-005', action: 'KOICA 승인서 업로드', actor: '김정태', timestamp: '2026-01-10T14:15:00', type: 'UPLOAD' },
      { id: 'tl-006', action: '승인 (APPROVED)', actor: '김정태', timestamp: '2026-01-10T14:20:00', type: 'APPROVE', comment: '승인합니다. KOICA 사전 통보 완료 확인.' },
    ],
    costImpact: {
      beforeTotal: 38713878,
      afterTotal: 19715400,
      difference: -18998478,
    },
  },

  // ── 2. CTS 2025~2028: 이예지→노성진 대체 + 다수 변경 ──
  {
    id: 'cr-002',
    projectId: 'cts_2528',
    projectName: '2025~2028 CTS 참여기업 역량강화',
    projectShortName: 'CTS 2025~2028',
    title: '이예지→노성진 대체 및 신규 인력 3명 추가',
    description: '이예지 타 프로젝트 전배에 따른 노성진 대체(연구원 50%), 김현지/강민경/최지윤 신규 추가, 양인영/이시은 투입율 상향',
    state: 'SUBMITTED',
    priority: 'HIGH',
    requestedBy: '이예지',
    requestedAt: '2026-01-20T14:00:00',
    effectiveDate: '2026-02-01',
    changes: [
      {
        staffName: '이예지',
        changeType: 'REMOVE',
        description: '이예지 타 프로젝트 전배에 따른 투입 해제',
        before: { grade: '연구원', rate: 50, months: 12, monthlyPay: 2841638, total: 34099656 },
        requiredDocs: ['RESIGNATION_LETTER', 'CHANGE_REQUEST_FORM'],
      },
      {
        staffName: '노성진',
        changeType: 'REPLACEMENT',
        description: '이예지 대체 투입 (연구원 50%)',
        after: { grade: '연구원', rate: 50, months: 12, monthlyPay: 2841638, total: 34099656 },
        replacedFrom: '이예지',
        requiredDocs: ['ASSIGNMENT_LETTER', 'CAREER_CERT', 'EMPLOYMENT_CERT'],
      },
      {
        staffName: '김현지',
        changeType: 'ADD',
        description: '신규 추가 (연구보조원 30%, 11개월)',
        after: { grade: '연구보조원', rate: 30, months: 11, monthlyPay: 1139723, total: 12536953 },
        requiredDocs: ['ASSIGNMENT_LETTER', 'CAREER_CERT'],
      },
      {
        staffName: '강민경',
        changeType: 'ADD',
        description: '신규 추가 (연구보조원 10%, 11개월)',
        after: { grade: '연구보조원', rate: 10, months: 11, monthlyPay: 379908, total: 4178988 },
        requiredDocs: ['ASSIGNMENT_LETTER'],
      },
      {
        staffName: '최지윤',
        changeType: 'ADD',
        description: '신규 추가 (연구보조원 20%, 11개월) — 보조원→연구보조원 등급 변경',
        after: { grade: '연구보조원', rate: 20, months: 11, monthlyPay: 759816, total: 8357976 },
        requiredDocs: ['ASSIGNMENT_LETTER', 'GRADE_CHANGE_CERT'],
      },
      {
        staffName: '양인영',
        changeType: 'RATE_CHANGE',
        description: '투입율 80%→90% 상향 조정',
        before: { grade: '연구보조원', rate: 80, months: 12, monthlyPay: 3039262, total: 36471144 },
        after: { grade: '연구보조원', rate: 90, months: 12, monthlyPay: 3419170, total: 41030040 },
        requiredDocs: ['RATE_CHANGE_CONFIRM'],
      },
      {
        staffName: '이시은',
        changeType: 'RATE_CHANGE',
        description: '투입율 80%→90% 상향 조정',
        before: { grade: '연구보조원', rate: 80, months: 12, monthlyPay: 3039262, total: 36471144 },
        after: { grade: '연구보조원', rate: 90, months: 12, monthlyPay: 3419170, total: 41030040 },
        requiredDocs: ['RATE_CHANGE_CONFIRM'],
      },
      {
        staffName: '김원희',
        changeType: 'MONTHS_CHANGE',
        description: '참여 개월 12개월→1개월 대폭 축소',
        before: { grade: '연구보조원', rate: 80, months: 12, monthlyPay: 3039262, total: 36471144 },
        after: { grade: '연구보조원', rate: 80, months: 1, monthlyPay: 3039262, total: 3039262 },
        requiredDocs: ['CHANGE_REQUEST_FORM'],
      },
    ],
    documents: [
      {
        id: 'doc-010',
        type: 'CHANGE_REQUEST_FORM',
        fileName: 'CTS_2528_인력변경요청서_20260120.pdf',
        fileSize: '3.1 MB',
        mimeType: 'application/pdf',
        uploadedBy: '이예지',
        uploadedAt: '2026-01-20T14:00:00',
        pageCount: 5,
        status: 'VALID',
        previewPages: mockPdfPages('인력변경요청서', [
          ['문서번호: MYSC-CTS28-CR-002', '요청일: 2026.01.20', '사업명: CTS 2025~2028', '변경 사유 총괄'],
          ['이예지→노성진 대체 상세', '경력 비교표'],
          ['신규 인력 3명 투입 계획', '김현지/강민경/최지윤 배치 상세'],
          ['투입율 변경 상세', '양인영/이시은 80%→90%', '김원희 12개월→1개월'],
          ['비용 변동 분석', '총 증감: +약 2,500만원', '서명란'],
        ]),
      },
      {
        id: 'doc-011',
        type: 'CAREER_CERT',
        fileName: '노성진_경력증명서_20260118.pdf',
        fileSize: '1.3 MB',
        mimeType: 'application/pdf',
        uploadedBy: '이예지',
        uploadedAt: '2026-01-20T14:10:00',
        pageCount: 2,
        status: 'VALID',
        previewPages: mockPdfPages('경력증명서', [
          ['성명: 노성진', '학력: 서울대학교 국제개발협력', '주요 경력'],
          ['KOICA CTS 관련 경험', '발급일: 2026.01.18'],
        ]),
      },
      {
        id: 'doc-012',
        type: 'ASSIGNMENT_LETTER',
        fileName: '노성진_투입확인서_20260120.pdf',
        fileSize: '620 KB',
        mimeType: 'application/pdf',
        uploadedBy: '이예지',
        uploadedAt: '2026-01-20T14:15:00',
        pageCount: 1,
        status: 'VALID',
        previewPages: mockPdfPages('투입확인서', [
          ['대상자: 노성진', '투입일: 2026.02.01', '등급: 연구원', '투입율: 50%', '기간: 12개월'],
        ]),
      },
      {
        id: 'doc-013',
        type: 'RATE_CHANGE_CONFIRM',
        fileName: '양인영_이시은_투입율변경확인서_20260120.pdf',
        fileSize: '710 KB',
        mimeType: 'application/pdf',
        uploadedBy: '이예지',
        uploadedAt: '2026-01-20T14:20:00',
        pageCount: 2,
        status: 'PENDING_REVIEW',
        notes: '검토 필요 — 양인영/이시은 투입율 동시 상향의 타당성 확인',
        previewPages: mockPdfPages('투입율변경확인서', [
          ['양인영: 80%→90% 변경', '변경 사유: 업무량 증가 대응'],
          ['이시은: 80%→90% 변경', '변경 사유: 담당 업무 확대'],
        ]),
      },
      {
        id: 'doc-014',
        type: 'INTERNAL_MEMO',
        fileName: '내부품의서_CTS28_인력변경_20260120.pdf',
        fileSize: '1.5 MB',
        mimeType: 'application/pdf',
        uploadedBy: '이예지',
        uploadedAt: '2026-01-20T14:25:00',
        pageCount: 3,
        status: 'VALID',
        previewPages: mockPdfPages('내부품의서', [
          ['품의 제목: CTS 2025~2028 인력 변경 승인 요청', '품의 일자: 2026.01.20'],
          ['변경 사유 및 배경', '비용 영향 분석'],
          ['결재선: 팀장→사업부장→대표이사'],
        ]),
      },
    ],
    timeline: [
      { id: 'tl-010', action: '변경 요청 생성', actor: '이예지', timestamp: '2026-01-20T14:00:00', type: 'CREATE' },
      { id: 'tl-011', action: '증빙서류 5건 업로드', actor: '이예지', timestamp: '2026-01-20T14:25:00', type: 'UPLOAD' },
      { id: 'tl-012', action: '검토 요청 (SUBMITTED)', actor: '이예지', timestamp: '2026-01-20T15:00:00', type: 'SUBMIT', comment: '2월 1일 적용 필요합니다. 노성진님 투입 준비 완료.' },
      { id: 'tl-013', action: '코멘트', actor: '김정태', timestamp: '2026-01-21T09:30:00', type: 'COMMENT', comment: '양인영/이시은 투입율 동시 상향 사유 보완 필요.' },
    ],
    costImpact: {
      beforeTotal: 143512088,
      afterTotal: 168272915,
      difference: 24760827,
    },
  },

  // ── 3. AP IBS: 최유진 등급 변경 + 하윤지→강혜진 대체 ──
  {
    id: 'cr-003',
    projectId: 'ap_ibs',
    projectName: '인도네시아 및 인도 임팩트 펀드 결성',
    projectShortName: 'AP IBS',
    title: '최유진 등급변경(3→4급) 및 하윤지→강혜진 대체',
    description: '최유진 3급→4급 등급 변경, 하윤지 타 사업 이동에 따른 강혜진 대체 투입, 박연주 5급→6급 변경',
    state: 'REVISION_REQUESTED',
    priority: 'MEDIUM',
    requestedBy: '최유진',
    requestedAt: '2026-01-22T11:00:00',
    reviewedBy: '박정호',
    reviewedAt: '2026-01-23T16:00:00',
    reviewComment: '박연주 등급 변경(5→6) 사유 보완 필요. 경력증명서 보완해주세요.',
    effectiveDate: '2026-02-01',
    changes: [
      {
        staffName: '최유진',
        changeType: 'GRADE_CHANGE',
        description: '등급 3급→4급 변경 (업무 역할 재조정)',
        before: { grade: '3급', rate: 35, months: 5 },
        after: { grade: '4급', rate: 35, months: 12 },
        requiredDocs: ['GRADE_CHANGE_CERT', 'CHANGE_REQUEST_FORM'],
      },
      {
        staffName: '하윤지',
        changeType: 'REMOVE',
        description: '하윤지 타 사업(Seed 0) 전배에 따른 투입 해제',
        before: { grade: '3급', rate: 15, months: 5 },
        requiredDocs: ['RESIGNATION_LETTER'],
      },
      {
        staffName: '강혜진',
        changeType: 'REPLACEMENT',
        description: '하윤지 대체 투입 (3급 20%)',
        after: { grade: '3급', rate: 20, months: 12 },
        replacedFrom: '하윤지',
        requiredDocs: ['ASSIGNMENT_LETTER', 'CAREER_CERT', 'EMPLOYMENT_CERT'],
      },
      {
        staffName: '박연주',
        changeType: 'GRADE_CHANGE',
        description: '등급 5급→6급 변경',
        before: { grade: '5급', rate: 55, months: 5 },
        after: { grade: '6급', rate: 55, months: 12 },
        requiredDocs: ['GRADE_CHANGE_CERT'],
      },
    ],
    documents: [
      {
        id: 'doc-020',
        type: 'CHANGE_REQUEST_FORM',
        fileName: 'AP_IBS_인력변경요청서_20260122.pdf',
        fileSize: '2.8 MB',
        mimeType: 'application/pdf',
        uploadedBy: '최유진',
        uploadedAt: '2026-01-22T11:00:00',
        pageCount: 4,
        status: 'VALID',
        previewPages: mockPdfPages('인력변경요청서', [
          ['문서번호: MYSC-AP-CR-003', '요청일: 2026.01.22', '사업명: AP IBS'],
          ['최유진 등급 변경 상세', '하윤지→강혜진 대체 사유'],
          ['박연주 등급 변경 상세', '비용 영향 분석'],
          ['서명란', '첨부 서류 목록'],
        ]),
      },
      {
        id: 'doc-021',
        type: 'GRADE_CHANGE_CERT',
        fileName: '최유진_등급변경확인서_20260121.pdf',
        fileSize: '920 KB',
        mimeType: 'application/pdf',
        uploadedBy: '최유진',
        uploadedAt: '2026-01-22T11:10:00',
        pageCount: 1,
        status: 'VALID',
        previewPages: mockPdfPages('등급변경확인서', [
          ['대상자: 최유진', '변경전 등급: 3급', '변경후 등급: 4급', '변경 사유: 업무 역할 재조정'],
        ]),
      },
      {
        id: 'doc-022',
        type: 'CAREER_CERT',
        fileName: '강혜진_경력증명서_20260120.pdf',
        fileSize: '1.0 MB',
        mimeType: 'application/pdf',
        uploadedBy: '최유진',
        uploadedAt: '2026-01-22T11:15:00',
        pageCount: 2,
        status: 'VALID',
        previewPages: mockPdfPages('경력증명서', [
          ['성명: 강혜진', '학력: 고려대학교 국제학과', '주요 경력'],
          ['해외 개발협력 프로젝트 경험', '발급일: 2026.01.20'],
        ]),
      },
      {
        id: 'doc-023',
        type: 'GRADE_CHANGE_CERT',
        fileName: '박연주_등급변경확인서_20260121.pdf',
        fileSize: '680 KB',
        mimeType: 'application/pdf',
        uploadedBy: '최유진',
        uploadedAt: '2026-01-22T11:20:00',
        pageCount: 1,
        status: 'EXPIRED',
        notes: '경력증명서 미첨부 — 보완 필요',
        previewPages: mockPdfPages('등급변경확인서', [
          ['대상자: 박연주', '변경전 등급: 5급', '변경후 등급: 6급', '변경 사유: (미기재)'],
        ]),
      },
    ],
    timeline: [
      { id: 'tl-020', action: '변경 요청 생성', actor: '최유진', timestamp: '2026-01-22T11:00:00', type: 'CREATE' },
      { id: 'tl-021', action: '증빙서류 4건 업로드', actor: '최유진', timestamp: '2026-01-22T11:20:00', type: 'UPLOAD' },
      { id: 'tl-022', action: '검토 요청 (SUBMITTED)', actor: '최유진', timestamp: '2026-01-22T13:00:00', type: 'SUBMIT' },
      { id: 'tl-023', action: '수정요청 (REVISION_REQUESTED)', actor: '박정호', timestamp: '2026-01-23T16:00:00', type: 'REVISION', comment: '박연주 등급 변경(5→6) 사유 보완 필요. 경력증명서 보완해주세요.' },
    ],
    costImpact: {
      beforeTotal: 0,
      afterTotal: 0,
      difference: 0,
    },
  },

  // ── 4. JLIN IBS: 이현미→고혜림 대체 ──
  {
    id: 'cr-004',
    projectId: 'jlin_ibs',
    projectName: '혼합금융 기반 동남아 임팩트 생태계 조성',
    projectShortName: 'JLIN IBS',
    title: '이현미→고혜림 대체 투입',
    description: '이현미 퇴사에 따른 고혜림 대체 투입 (2급, 실급여 기준, 10%)',
    state: 'DRAFT',
    priority: 'LOW',
    requestedBy: '고인효',
    requestedAt: '2026-01-25T10:00:00',
    effectiveDate: '2026-02-15',
    changes: [
      {
        staffName: '이현미',
        changeType: 'REMOVE',
        description: '이현미 퇴사로 인한 투입 해제',
        before: { grade: '2급', rate: 10, months: 12 },
        requiredDocs: ['RESIGNATION_LETTER', 'CHANGE_REQUEST_FORM'],
      },
      {
        staffName: '고혜림',
        changeType: 'REPLACEMENT',
        description: '이현미 대체 투입 (2급 10%, 실급여 기준)',
        after: { grade: '2급', rate: 10, months: 12 },
        replacedFrom: '이현미',
        requiredDocs: ['ASSIGNMENT_LETTER', 'CAREER_CERT', 'EMPLOYMENT_CERT'],
      },
    ],
    documents: [
      {
        id: 'doc-030',
        type: 'CHANGE_REQUEST_FORM',
        fileName: 'JLIN_인력변경요청서_초안_20260125.pdf',
        fileSize: '1.9 MB',
        mimeType: 'application/pdf',
        uploadedBy: '고인효',
        uploadedAt: '2026-01-25T10:00:00',
        pageCount: 2,
        status: 'PENDING_REVIEW',
        notes: '초안 상태 — 경력증명서/재직증명서 미첨부',
        previewPages: mockPdfPages('인력변경요청서 (초안)', [
          ['문서번호: (미발번)', '요청일: 2026.01.25', '사업명: JLIN IBS'],
          ['이현미→고혜림 대체 사유', '비용 변동: 실급여 기준으로 차액 미확정'],
        ]),
      },
    ],
    timeline: [
      { id: 'tl-030', action: '변경 요청 초안 생성', actor: '고인효', timestamp: '2026-01-25T10:00:00', type: 'CREATE' },
      { id: 'tl-031', action: '인력변경요청서 초안 업로드', actor: '고인효', timestamp: '2026-01-25T10:05:00', type: 'UPLOAD' },
    ],
    costImpact: {
      beforeTotal: 0,
      afterTotal: 0,
      difference: 0,
    },
  },

  // ── 5. YK IBS: 윤지수 투입율 변경 ──
  {
    id: 'cr-005',
    projectId: 'yk_ibs',
    projectName: '동남아시아 기후환경 스타트업 ESG투자',
    projectShortName: 'YK IBS',
    title: '윤지수 투입율 35%→50% 상향 조정',
    description: '윤지수 업무량 증가에 따른 투입율 상향 조정',
    state: 'APPROVED',
    priority: 'MEDIUM',
    requestedBy: '박정호',
    requestedAt: '2026-01-12T09:00:00',
    reviewedBy: '김정태',
    reviewedAt: '2026-01-14T11:30:00',
    reviewComment: '승인. 실급여 기준이므로 KOICA 별도 통보 불필요.',
    effectiveDate: '2026-02-01',
    changes: [
      {
        staffName: '윤지수',
        changeType: 'RATE_CHANGE',
        description: '투입율 35%→50% 상향 조정',
        before: { grade: '4급', rate: 35, months: 12 },
        after: { grade: '4급', rate: 50, months: 12 },
        requiredDocs: ['RATE_CHANGE_CONFIRM', 'CHANGE_REQUEST_FORM'],
      },
    ],
    documents: [
      {
        id: 'doc-040',
        type: 'CHANGE_REQUEST_FORM',
        fileName: 'YK_IBS_윤지수_투입율변경_20260112.pdf',
        fileSize: '1.4 MB',
        mimeType: 'application/pdf',
        uploadedBy: '박정호',
        uploadedAt: '2026-01-12T09:00:00',
        pageCount: 2,
        status: 'VALID',
        previewPages: mockPdfPages('인력변경요청서', [
          ['문서번호: MYSC-YK-CR-005', '요청일: 2026.01.12', '사업명: YK IBS'],
          ['윤지수 투입율 변경 상세', '35%→50% 사유: 업무량 증가'],
        ]),
      },
      {
        id: 'doc-041',
        type: 'RATE_CHANGE_CONFIRM',
        fileName: '윤지수_투입율변경확인서_20260112.pdf',
        fileSize: '530 KB',
        mimeType: 'application/pdf',
        uploadedBy: '박정호',
        uploadedAt: '2026-01-12T09:10:00',
        pageCount: 1,
        status: 'VALID',
        previewPages: mockPdfPages('투입율변경확인서', [
          ['대상자: 윤지수', '변경전: 35%', '변경후: 50%', '4급 실급여 기준'],
        ]),
      },
    ],
    timeline: [
      { id: 'tl-040', action: '변경 요청 생성', actor: '박정호', timestamp: '2026-01-12T09:00:00', type: 'CREATE' },
      { id: 'tl-041', action: '증빙서류 2건 업로드', actor: '박정호', timestamp: '2026-01-12T09:10:00', type: 'UPLOAD' },
      { id: 'tl-042', action: '검토 요청 (SUBMITTED)', actor: '박정호', timestamp: '2026-01-12T10:00:00', type: 'SUBMIT' },
      { id: 'tl-043', action: '승인 (APPROVED)', actor: '김정태', timestamp: '2026-01-14T11:30:00', type: 'APPROVE', comment: '승인. 실급여 기준이므로 KOICA 별도 통보 불필요.' },
    ],
    costImpact: {
      beforeTotal: 0,
      afterTotal: 0,
      difference: 0,
    },
  },
];

// ── Helper: 필요 서류 완료율 체크 ──

export function getDocCompleteness(request: ChangeRequest): { total: number; uploaded: number; missing: DocumentType[] } {
  const needed = new Set<DocumentType>();
  for (const ch of request.changes) {
    for (const dt of ch.requiredDocs) {
      needed.add(dt);
    }
  }
  const uploaded = new Set(request.documents.map(d => d.type));
  const missing: DocumentType[] = [];
  for (const dt of needed) {
    if (!uploaded.has(dt)) missing.push(dt);
  }
  return { total: needed.size, uploaded: uploaded.size, missing };
}