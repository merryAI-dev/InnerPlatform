import { useState, useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';
import { Separator } from '../ui/separator';
import { Button } from '../ui/button';

const SHORTCUT_GROUPS = [
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
      { keys: ['G', 'D'], desc: '대시보드로 이동' },
      { keys: ['G', 'P'], desc: '프로젝트 목록으로 이동' },
      { keys: ['G', 'C'], desc: '캐시플로로 이동' },
      { keys: ['G', 'E'], desc: '증빙/정산으로 이동' },
      { keys: ['G', 'A'], desc: '감사로그로 이동' },
      { keys: ['G', 'S'], desc: '설정으로 이동' },
    ],
  },
  {
    label: '작업',
    shortcuts: [
      { keys: ['N'], desc: '새 사업 등록' },
      { keys: ['⌘', 'Enter'], desc: '폼 제출 / 확인' },
    ],
  },
];

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // ⌘+/ or Ctrl+/ to open shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault();
        setOpen(prev => !prev);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-[340px] sm:w-[380px] p-0">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="flex items-center gap-2 text-[14px]">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}
            >
              <Keyboard className="w-3.5 h-3.5 text-white" />
            </div>
            키보드 단축키
          </SheetTitle>
        </SheetHeader>

        <div className="px-5 pb-5 space-y-5 overflow-y-auto max-h-[calc(100vh-100px)]">
          {SHORTCUT_GROUPS.map((group, gi) => (
            <div key={group.label}>
              {gi > 0 && <Separator className="mb-4" />}
              <p
                className="text-[10px] tracking-wider text-muted-foreground mb-2.5"
                style={{ fontWeight: 600, textTransform: 'uppercase' }}
              >
                {group.label}
              </p>
              <div className="space-y-1.5">
                {group.shortcuts.map((s, si) => (
                  <div key={si} className="flex items-center justify-between py-1.5">
                    <span className="text-[12px] text-foreground/80">{s.desc}</span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((k, ki) => (
                        <span key={ki}>
                          <kbd
                            className="inline-flex items-center justify-center min-w-[24px] h-[22px] rounded-md bg-muted border border-border/60 text-[10px] text-muted-foreground px-1.5"
                            style={{ fontWeight: 600, fontFamily: 'inherit' }}
                          >
                            {k}
                          </kbd>
                          {ki < s.keys.length - 1 && (
                            <span className="text-[10px] text-muted-foreground mx-0.5">+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="bg-muted/50 rounded-lg p-3 mt-4">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              <span style={{ fontWeight: 600 }}>팁:</span> 커맨드 팔레트(⌘K)에서 모든 기능을 검색할 수 있습니다.
              네비게이션 단축키는 순차적으로 누르세요 (예: G → D).
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
