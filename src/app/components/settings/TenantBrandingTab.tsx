import { useCallback, useEffect, useState } from 'react';
import { Loader2, Palette, Save } from 'lucide-react';
import type { Firestore } from 'firebase/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { toast } from 'sonner';
import { useFirebase } from '../../lib/firebase-context';

// ── Types ──

interface BrandingConfig {
  orgName: string;
  primaryColor: string;
  logoUrl: string;
}

const DEFAULT_BRANDING: BrandingConfig = {
  orgName: '',
  primaryColor: '#0891b2',
  logoUrl: '',
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

// ── Component ──

export function TenantBrandingTab() {
  const { db, orgId } = useFirebase();
  const [branding, setBranding] = useState<BrandingConfig>(DEFAULT_BRANDING);
  const [loadingBranding, setLoadingBranding] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);

  useEffect(() => {
    if (!db) return;
    setLoadingBranding(true);
    void loadBranding(db, orgId).then((b) => { setBranding(b); setLoadingBranding(false); });
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
                      placeholder="#0891b2"
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
                        style={{ background: `linear-gradient(135deg, ${/^#[0-9a-fA-F]{6}$/.test(branding.primaryColor) ? branding.primaryColor : '#0891b2'}, ${/^#[0-9a-fA-F]{6}$/.test(branding.primaryColor) ? branding.primaryColor : '#0891b2'}99)` }}
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
    </div>
  );
}
