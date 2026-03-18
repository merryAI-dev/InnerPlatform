export type EmploymentStatus = 'ACTIVE' | 'ON_LEAVE' | 'RESIGNED' | 'TERMINATED';
export type ContractType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERN';
export type LeaveType = 'ANNUAL' | 'SICK' | 'MATERNITY' | 'PATERNITY' | 'UNPAID' | 'OTHER';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface HrEmployee {
  id: string;
  orgId: string;
  uid: string;
  name: string;
  email: string;
  department: string;
  position: string;
  employmentStatus: EmploymentStatus;
  contractType: ContractType;
  joinDate: string;
  resignDate?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HrContract {
  id: string;
  employeeId: string;
  orgId: string;
  contractType: ContractType;
  startDate: string;
  endDate?: string;
  salary?: number;
  notes?: string;
  createdAt: string;
}

export interface HrLeave {
  id: string;
  employeeId: string;
  orgId: string;
  type: LeaveType;
  status: LeaveStatus;
  startDate: string;
  endDate: string;
  days: number;
  reason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  ACTIVE: '재직',
  ON_LEAVE: '휴직',
  RESIGNED: '퇴직',
  TERMINATED: '해고',
};

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  FULL_TIME: '정규직',
  PART_TIME: '시간제',
  CONTRACT: '계약직',
  INTERN: '인턴',
};

export const LEAVE_TYPE_LABELS: Record<LeaveType, string> = {
  ANNUAL: '연차',
  SICK: '병가',
  MATERNITY: '출산휴가',
  PATERNITY: '배우자출산휴가',
  UNPAID: '무급휴가',
  OTHER: '기타',
};

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  PENDING: '대기',
  APPROVED: '승인',
  REJECTED: '반려',
  CANCELLED: '취소',
};
