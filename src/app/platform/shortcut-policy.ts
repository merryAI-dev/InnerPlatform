import { canShowAdminNavItem } from './admin-nav';

export interface Shortcut {
  keys: string[];
  desc: string;
  /**
   * Optional target path used to filter the shortcut by role navigation policy.
   * If omitted, the shortcut is considered global.
   */
  to?: string;
}

export interface ShortcutGroup {
  label: string;
  shortcuts: Shortcut[];
}

const BASE_GROUPS: ShortcutGroup[] = [
  {
    label: '글로벌',
    shortcuts: [
      { keys: ['⌘', 'K'], desc: '커맨드 팔레트 열기' },
      { keys: ['⌘', '/'], desc: '키보드 단축키 도움말' },
      { keys: ['Esc'], desc: '팝업/패널 닫기' },
    ],
  },
  {
    label: '네비게이션',
    shortcuts: [
      { keys: ['G', 'D'], desc: '대시보드로 이동', to: '/' },
      { keys: ['G', 'P'], desc: '프로젝트 목록으로 이동', to: '/projects' },
      { keys: ['G', 'C'], desc: '캐시플로로 이동', to: '/cashflow' },
      { keys: ['G', 'E'], desc: '증빙/정산으로 이동', to: '/evidence' },
      { keys: ['G', 'A'], desc: '감사로그로 이동', to: '/audit' },
      { keys: ['G', 'S'], desc: '설정으로 이동', to: '/settings' },
    ],
  },
  {
    label: '작업',
    shortcuts: [
      { keys: ['N'], desc: '새 사업 등록', to: '/projects/new' },
      { keys: ['⌘', 'Enter'], desc: '폼 제출 / 확인' },
    ],
  },
];

export function getShortcutGroupsForRole(role: unknown): ShortcutGroup[] {
  return BASE_GROUPS
    .map((group) => ({
      ...group,
      shortcuts: group.shortcuts.filter((s) => (s.to ? canShowAdminNavItem(role, s.to) : true)),
    }))
    .filter((group) => group.shortcuts.length > 0);
}

