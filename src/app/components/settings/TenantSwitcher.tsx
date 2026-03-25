import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown, Lock, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import type { Firestore } from 'firebase/firestore';
import { collection, getDocs, limit, query } from 'firebase/firestore';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Input } from '../ui/input';
import { Separator } from '../ui/separator';
import { useFirebase } from '../../lib/firebase-context';
import { isValidTenantId } from '../../platform/tenant';

// ── Types ──

interface TenantEntry {
  id: string;
  name: string;
}

// ── Firestore tenant list loader ──

async function loadKnownTenants(db: Firestore): Promise<TenantEntry[]> {
  try {
    const snap = await getDocs(query(collection(db, 'tenants'), limit(50)));
    return snap.docs.map((doc) => ({
      id: doc.id,
      name: (doc.data().name as string | undefined) || doc.id,
    }));
  } catch {
    return [];
  }
}

// ── Component ──

interface TenantSwitcherProps {
  collapsed?: boolean;
  userRole?: string;
}

export function TenantSwitcher({ collapsed = false, userRole }: TenantSwitcherProps) {
  const { orgId, setOrgId, isUsingEnvConfig, db } = useFirebase();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [tenants, setTenants] = useState<TenantEntry[]>([]);
  const [customInput, setCustomInput] = useState('');
  const [inputError, setInputError] = useState('');
  const loadedRef = useRef(false);

  const isAdmin = userRole === 'admin' || userRole === 'tenant_admin';
  const canSwitch = !isUsingEnvConfig && isAdmin;

  useEffect(() => {
    if (!open || !db || loadedRef.current) return;
    loadedRef.current = true;
    void loadKnownTenants(db).then((list) => {
      if (list.length > 0) setTenants(list);
    });
  }, [open, db]);

  const handleSelect = useCallback((nextId: string) => {
    if (nextId === orgId) { setOpen(false); return; }
    const ok = setOrgId(nextId);
    if (ok) {
      setOpen(false);
      setCustomInput('');
      navigate('/', { replace: true });
    }
  }, [orgId, setOrgId, navigate]);

  const handleCustomSwitch = useCallback(() => {
    const value = customInput.trim().toLowerCase();
    if (!isValidTenantId(value)) {
      setInputError('소문자 영문/숫자/-만 허용, 2~32자');
      return;
    }
    setInputError('');
    handleSelect(value);
  }, [customInput, handleSelect]);

  if (collapsed) {
    return (
      <div className="flex justify-center">
        <button
          type="button"
          className="w-7 h-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
          title={isUsingEnvConfig ? `테넌트: ${orgId} (잠금)` : `테넌트: ${orgId}`}
          onClick={() => canSwitch && setOpen(!open)}
          disabled={!canSwitch}
        >
          {isUsingEnvConfig ? <Lock className="w-3 h-3" /> : <Building2 className="w-3 h-3" />}
        </button>
      </div>
    );
  }

  return (
    <Popover open={open && canSwitch} onOpenChange={(v) => canSwitch && setOpen(v)}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!canSwitch}
          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-colors
            ${canSwitch
              ? 'hover:bg-white/10 text-slate-400 hover:text-slate-200 cursor-pointer'
              : 'text-slate-600 cursor-default'
            }`}
          title={isUsingEnvConfig ? '환경변수로 테넌트가 고정되어 있습니다' : '테넌트 전환'}
        >
          {isUsingEnvConfig
            ? <Lock className="w-3 h-3 shrink-0 text-slate-600" />
            : <Building2 className="w-3 h-3 shrink-0" />
          }
          <span className="flex-1 text-left font-mono truncate">{orgId}</span>
          {canSwitch && <ChevronDown className="w-3 h-3 shrink-0 opacity-50" />}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-2" align="start" side="right">
        <p className="text-[10px] font-medium text-muted-foreground px-1 pb-1.5 tracking-wider uppercase">
          테넌트 전환
        </p>

        {/* Known tenant list */}
        {tenants.length > 0 && (
          <div className="space-y-px mb-2">
            {tenants.map((t) => (
              <button
                key={t.id}
                type="button"
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] hover:bg-muted transition-colors"
                onClick={() => handleSelect(t.id)}
              >
                <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 text-left truncate">{t.name}</span>
                <span className="text-[10px] text-muted-foreground font-mono">{t.id}</span>
                {t.id === orgId && <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
              </button>
            ))}
          </div>
        )}

        <Separator className="my-2" />

        {/* Custom orgId input */}
        <div className="space-y-1.5 px-1">
          <p className="text-[10px] text-muted-foreground">직접 입력</p>
          <div className="flex gap-1.5">
            <Input
              value={customInput}
              onChange={(e) => {
                setCustomInput(e.target.value);
                setInputError('');
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomSwitch()}
              placeholder="org-id"
              className="h-7 text-[11px] font-mono"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px] shrink-0"
              onClick={handleCustomSwitch}
            >
              이동
            </Button>
          </div>
          {inputError && <p className="text-[10px] text-destructive">{inputError}</p>}
        </div>

        <Separator className="my-2" />

        {/* Register new tenant */}
        <button
          type="button"
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] hover:bg-muted transition-colors text-indigo-400"
          onClick={() => {
            setOpen(false);
            navigate('/settings?tab=tenants');
          }}
        >
          <Plus className="w-3.5 h-3.5" />
          신규 테넌트 등록
        </button>
      </PopoverContent>
    </Popover>
  );
}

// ── Compact badge for header ──

export function TenantBadge() {
  const { orgId, isUsingEnvConfig } = useFirebase();
  return (
    <Badge
      variant="outline"
      className="text-[10px] font-mono gap-1 px-1.5 py-0.5 h-5"
      title={isUsingEnvConfig ? '환경변수로 고정된 테넌트' : `현재 테넌트: ${orgId}`}
    >
      {isUsingEnvConfig && <Lock className="w-2.5 h-2.5" />}
      {orgId}
    </Badge>
  );
}
