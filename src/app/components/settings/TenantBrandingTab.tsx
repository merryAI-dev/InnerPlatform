import { useCallback, useEffect, useState } from 'react';
import { Loader2, Palette, Save } from 'lucide-react';
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import { Switch } from '../ui/switch';
import { toast } from 'sonner';
import { useFirebase } from '../../lib/firebase-context';

// ── Types ──

interface BrandingConfig {
  orgName: string;
  primaryColor: string;
  logoUrl: string;
}

interface FeatureFlags {
  tenantIsolationStrict: boolean;
  enableBudgetSuggestions: boolean;
  enableVlmPilot: boolean;
  enableParticipationRiskAlerts: boolean;
  enableMultiTenantUi: boolean;
}

const DEFAULT_BRANDING: BrandingConfig = {
  orgName: '',
  primaryColor: '#6366f1',
  logoUrl: '',
};

const DEFAULT_FLAGS: FeatureFlags = {
  tenantIsolationStrict: true,
  enableBudgetSuggestions: true,
  enableVlmPilot: false,
  enableParticipationRiskAlerts: true,
  enableMultiTenantUi: false,
};

// ── Firestore helpers ──

async function loadBranding(db: Firestore, orgId: string): Promise<BrandingConfig> {
  try {
    const snap = await getDoc(doc(db, `orgs/${orgId}/settings/branding`));
    if (!snap.exists()) return { ...DEFAULT_BRANDING };
    const data = snap.data();
    return {
      orgName: data.orgName || '',
      primaryColor: data.primaryColor || DEFAULT_BRANDING.primaryColor,
      logoUrl: data.logoUrl || '',
    };
  } catch {
    return { ...DEFAULT_BRANDING };
  }
}

async function saveBranding(db: Firestore, orgId: string, branding: BrandingConfig): Promise<void> {
  await setDoc(doc(db, `orgs/${orgId}/settings/branding`), branding, { merge: true });
}

async function loadFeatureFlags(db: Firestore, orgId: string): Promise<FeatureFlags> {
  try {
    const snap = await getDoc(doc(db, `orgs/${orgId}/settings/feature-flags`));
    if (!snap.exists()) return { ...DEFAULT_FLAGS };
    return { ...DEFAULT_FLAGS, ...snap.data() } as FeatureFlags;
  } catch {
    return { ...DEFAULT_FLAGS };
  }
}

async function saveFeatureFlags(db: Firestore, orgId: string, flags: FeatureFlags): Promise<void> {
  await setDoc(doc(db, `orgs/${orgId}/settings/feature-flags`), flags, { merge: true });
}

// ── Flag metadata ──

const FLAG_META: { key: keyof FeatureFlags; label: string; description: string }[] = [
  {
    key: 'tenantIsolationStrict',
    label: '테넌트 엄격 격리',
    description: '다른 org의 데이터 접근을 완전히 차단합니다',
  },
  {
    key: 'enableBudgetSuggestions',
    label: '비목 자동 제안',
    description: '거래처 히스토리 및 코드북 기반 비목/세목 제안 칩 표시',
  },
  {
    key: 'enableParticipationRiskAlerts',
    label: '참여율 위험 알림',
    description: '100% 초과 참여율 경고 및 대시보드 드릴다운',
  },
  {
    key: 'enableMultiTenantUi',
    label: '멀티테넌트 UI',
    description: '테넌트 선택 드롭다운 및 온보딩 플로우 활성화',
  },
  {
    key: 'enableVlmPilot',
    label: 'VLM 파일럿 (실험적)',
    description: '영수증/계약서 이미지에서 거래처·금액 자동 추출 (Claude Vision)',
  },
];

// ── Component ──

export function TenantBrandingTab() {
  const { db, orgId } = useFirebase();
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING);
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [loadingFlags, setLoadingFlags] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [savingFlags, setSavingFlags] = useState(false);

  useEffect(() => {
    if (!db) return;
    setLoadingBranding(true);
    void loadBranding(db, orgId).then((b) => { setBranding(b); setLoadingBranding(false); });
    setLoadingFlags(true);
    void loadFeatureFlags(db, orgId).then((f) => { setFlags(f); setLoadingFlags(false); });
  }, [db, orgId]);

  const handleSaveBranding = useCallback(async () => {
    if (!db) return;
    setSavingBranding(true);
    try {
      await saveBranding(db, orgId, branding);
      toast.success('브랜딩 설정 저장 완료');
    } catch (err: unknown) {
      toast.error('저장 실패: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setSavingBranding(false);
    }
  }, [db, orgId, branding]);

  const handleSaveFlags = useCallback(async () => {
    if (!db) return;
    setSavingFlags(true);
    try {
      await saveFeatureFlags(db, orgId, flags);
      toast.success('기능 플래그 저장 완료');
    } catch (err: unknown) {
      toast.error('저장 실패: ' + (err instanceof Error ? err.message : ''));
    } finally {
      setSavingFlags(false);
    }
  }, [db, orgId, flags]);

  return (
    <div className="space-y-6">
      {/* Branding */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] flex items-center gap-2">
            <Palette className="w-4 h-4" />
            브랜딩 설정
          </CardTitle>
          <CardDescription className="text-[12px]">
            테넌트 <span className="font-mono">{orgId}</span>의 외관을 커스터마이징합니다
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loadingBranding ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 로딩 중...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="org-name" className="text-[12px]">조직 표시 이름</Label>
                  <Input
                    id="org-name"
                    value={branding.orgName}
                    onChange={(e) => setBranding((b) => ({ ...b, orgName: e.target.value }))}
                    placeholder="예: MYSC 사회적협동조합"
                    className="h-8 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="primary-color" className="text-[12px]">대표 컬러</Label>
                  <div className="flex gap-2 items-center">
                    <input
                      id="primary-color"
                      type="color"
                      value={branding.primaryColor}
                      onChange={(e) => setBranding((b) => ({ ...b, primaryColor: e.target.value }))}
                      className="w-8 h-8 rounded border border-border cursor-pointer p-0.5"
                    />
                    <Input
                      value={branding.primaryColor}
                      onChange={(e) => setBranding((b) => ({ ...b, primaryColor: e.target.value }))}
                      placeholder="#6366f1"
                      className="h-8 text-[13px] font-mono flex-1"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="logo-url" className="text-[12px]">로고 URL</Label>
                <Input
                  id="logo-url"
                  value={branding.logoUrl}
                  onChange={(e) => setBranding((b) => ({ ...b, logoUrl: e.target.value }))}
                  placeholder="https://cdn.example.com/logo.svg"
                  className="h-8 text-[13px]"
                />
                <p className="text-[10px] text-muted-foreground">
                  SVG 또는 PNG 권장. 사이드바 상단에 표시됩니다.
                </p>
              </div>

              {/* Preview */}
              {(branding.orgName || branding.logoUrl) && (
                <div className="rounded-lg border p-3 bg-muted/30">
                  <p className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">미리보기</p>
                  <div className="flex items-center gap-2">
                    {branding.logoUrl && /^https?:\/\//.test(branding.logoUrl) ? (
                      <img
                        src={branding.logoUrl}
                        alt="logo"
                        className="w-8 h-8 rounded-lg object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[13px]"
                        style={{ background: `linear-gradient(135deg, ${/^#[0-9a-fA-F]{6}$/.test(branding.primaryColor) ? branding.primaryColor : '#6366f1'}, ${/^#[0-9a-fA-F]{6}$/.test(branding.primaryColor) ? branding.primaryColor : '#6366f1'}99)` }}
                      >
                        {(branding.orgName || orgId).charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="text-[13px] font-semibold">{branding.orgName || orgId}</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Business Platform</p>
                    </div>
                  </div>
                </div>
              )}

              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSaveBranding}
                disabled={savingBranding}
              >
                {savingBranding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                브랜딩 저장
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Feature Flags */}
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px]">기능 플래그</CardTitle>
          <CardDescription className="text-[12px]">
            테넌트 <span className="font-mono">{orgId}</span>에서 활성화할 기능을 선택합니다.
            변경 사항은 저장 후 즉시 적용됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingFlags ? (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 로딩 중...
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {FLAG_META.map(({ key, label, description }) => (
                  <div key={key} className="flex items-center justify-between gap-4 py-1">
                    <div>
                      <p className="text-[13px] font-medium">{label}</p>
                      <p className="text-[11px] text-muted-foreground">{description}</p>
                    </div>
                    <Switch
                      checked={flags[key] as boolean}
                      onCheckedChange={(v) => setFlags((f) => ({ ...f, [key]: v }))}
                    />
                  </div>
                ))}
              </div>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={handleSaveFlags}
                disabled={savingFlags}
              >
                {savingFlags ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                플래그 저장
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
