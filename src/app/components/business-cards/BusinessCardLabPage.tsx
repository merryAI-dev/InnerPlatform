import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Search,
  Sparkles,
  Upload,
  UserRoundCheck,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { PwaInstallPrompt } from '../pwa/PwaInstallPrompt';
import { useAuth } from '../../data/auth-store';
import {
  confirmBusinessCardImportViaBff,
  isPlatformApiEnabled,
  listBusinessCardImportsViaBff,
  processBusinessCardViaBff,
  searchContactsViaBff,
  type ActorLike,
  type BusinessCardImportListItem,
  type BusinessCardImportResult,
  type ContactSearchResult,
} from '../../lib/platform-bff-client';
import {
  prepareBusinessCardImage,
  type BusinessCardPreparedImage,
} from './business-card-image';
import {
  buildBusinessCardConfirmPayload,
  canConfirmBusinessCardContact,
  formStateFromBusinessCardExtraction,
  isLowConfidenceField,
} from './business-card-quality';

type BusinessCardTab = 'search' | 'capture' | 'review';

const TABS: Array<{ id: BusinessCardTab; label: string; description: string }> = [
  { id: 'capture', label: '명함 등록', description: '모바일 카메라나 이미지 파일로 새 명함을 등록합니다.' },
  { id: 'search', label: '검색', description: '전사 연락처를 이름, 회사, 이메일, 전화번호로 찾습니다.' },
  { id: 'review', label: '검토 대기', description: 'Gemini 추출 후 저장 전 상태의 명함을 확인합니다.' },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

export function BusinessCardLabPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<BusinessCardTab>('capture');
  const [preparedImage, setPreparedImage] = useState<BusinessCardPreparedImage | null>(null);
  const [imageError, setImageError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingImports, setLoadingImports] = useState(false);
  const [searching, setSearching] = useState(false);
  const [workflowMessage, setWorkflowMessage] = useState('');
  const [currentImport, setCurrentImport] = useState<BusinessCardImportResult | null>(null);
  const [reviewImports, setReviewImports] = useState<BusinessCardImportListItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ContactSearchResult[]>([]);
  const [formState, setFormState] = useState({
    name: '',
    organization: '',
    department: '',
    title: '',
    role: '',
    emailsText: '',
    phonesText: '',
    website: '',
    address: '',
    memo: '',
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeTabMeta = useMemo(
    () => TABS.find((tab) => tab.id === activeTab) || TABS[0],
    [activeTab],
  );
  const tenantId = user?.tenantId || 'mysc';
  const actor: ActorLike | null = user ? {
    uid: user.uid,
    email: user.email,
    role: user.role,
    idToken: user.idToken,
  } : null;
  const confirmPayload = useMemo(() => buildBusinessCardConfirmPayload(formState), [formState]);
  const canSave = canConfirmBusinessCardContact(confirmPayload) && Boolean(currentImport?.importId);
  const bffEnabled = isPlatformApiEnabled();

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setImageError('');
    if (!file) return;
    setPreparing(true);
    try {
      const nextImage = await prepareBusinessCardImage(file);
      setPreparedImage(nextImage);
      setWorkflowMessage('');
    } catch (error) {
      setPreparedImage(null);
      setImageError(error instanceof Error ? error.message : '이미지를 준비하지 못했습니다.');
    } finally {
      setPreparing(false);
      event.target.value = '';
    }
  }

  function updateFormField(key: keyof typeof formState, value: string) {
    setFormState((current) => ({ ...current, [key]: value }));
  }

  function applyImportForReview(item: BusinessCardImportListItem | BusinessCardImportResult) {
    if (!item.extracted) return;
    const importId = 'importId' in item ? item.importId : item.id;
    setCurrentImport({
      importId,
      status: item.status,
      extracted: item.extracted,
      error: item.error || null,
    });
    setFormState(formStateFromBusinessCardExtraction(item.extracted));
    setWorkflowMessage('');
    setActiveTab('capture');
  }

  async function handleProcessImage() {
    if (!preparedImage || !actor) return;
    if (!bffEnabled) {
      setWorkflowMessage('BFF API가 꺼져 있어 명함 추출을 실행할 수 없습니다.');
      return;
    }
    setProcessing(true);
    setWorkflowMessage('');
    try {
      const result = await processBusinessCardViaBff({
        tenantId,
        actor,
        upload: {
          fileName: preparedImage.fileName,
          mimeType: preparedImage.mimeType,
          fileSize: preparedImage.fileSize,
          contentBase64: preparedImage.contentBase64,
        },
      });
      applyImportForReview(result);
      setWorkflowMessage('추출 draft를 만들었습니다. 필드를 확인한 뒤 저장해 주세요.');
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : '명함 추출 요청에 실패했습니다.');
    } finally {
      setProcessing(false);
    }
  }

  async function handleSaveContact() {
    if (!actor || !currentImport?.importId || !canSave) return;
    setSaving(true);
    setWorkflowMessage('');
    try {
      const result = await confirmBusinessCardImportViaBff({
        tenantId,
        actor,
        importId: currentImport.importId,
        contact: confirmPayload,
      });
      setWorkflowMessage(`연락처로 저장했습니다. contactId: ${result.contactId}`);
      setCurrentImport((current) => current ? { ...current, status: 'saved' } : current);
      setActiveTab('search');
      setSearchQuery(confirmPayload.name || confirmPayload.organization || confirmPayload.emails[0] || confirmPayload.phones[0] || '');
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : '연락처 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLoadReviewImports() {
    if (!actor || !bffEnabled) {
      setWorkflowMessage('BFF API가 꺼져 있어 검토 대기열을 불러올 수 없습니다.');
      return;
    }
    setLoadingImports(true);
    setWorkflowMessage('');
    try {
      const result = await listBusinessCardImportsViaBff({
        tenantId,
        actor,
        status: 'needs_review',
      });
      setReviewImports(result.items);
      setWorkflowMessage(`검토 대기 ${result.items.length}건을 불러왔습니다.`);
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : '검토 대기열을 불러오지 못했습니다.');
    } finally {
      setLoadingImports(false);
    }
  }

  async function handleSearchContacts() {
    if (!actor || !bffEnabled || !searchQuery.trim()) return;
    setSearching(true);
    setWorkflowMessage('');
    try {
      const result = await searchContactsViaBff({
        tenantId,
        actor,
        query: searchQuery,
      });
      setSearchResults(result.items);
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : '연락처 검색에 실패했습니다.');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[linear-gradient(135deg,#eef6ff_0%,#f8fbff_46%,#ecfdf5_100%)] px-4 py-6 dark:bg-[linear-gradient(135deg,#061a2f_0%,#0f172a_52%,#052e2b_100%)] md:px-6 md:py-8">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <section className="overflow-hidden rounded-lg border border-white/70 bg-white/55 shadow-xl shadow-slate-900/5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/45">
          <div className="border-b border-white/40 bg-[#0f2747]/95 px-5 py-5 text-white md:px-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-sky-100/80">
                  LAB · Business Card DB
                </p>
                <h1 className="mt-2 text-[28px] font-extrabold leading-tight md:text-[36px]">
                  명함 DB
                </h1>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-sky-50/85">
                  명함 이미지를 업로드하고, 추출 결과를 검토한 뒤 전사에서 다시 검색할 수 있는 연락처로 저장합니다.
                </p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-sky-50 backdrop-blur-md">
                <Sparkles className="h-3.5 w-3.5" />
                Gemini 검토형 추출
              </span>
            </div>
          </div>

          <div className="border-b border-white/50 px-5 py-4 md:px-7">
            <PwaInstallPrompt />
          </div>

          <div className="grid gap-5 px-5 py-5 md:grid-cols-[240px_1fr] md:px-7 md:py-6">
            <nav className="space-y-2">
              {TABS.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition-all ${
                      active
                        ? 'border-sky-200 bg-white/85 text-sky-950 shadow-md shadow-sky-900/10 dark:border-sky-400/30 dark:bg-sky-950/35 dark:text-sky-100'
                        : 'border-white/70 bg-white/45 text-slate-700 hover:border-sky-200 hover:bg-white/70 dark:border-white/10 dark:bg-slate-950/35 dark:text-slate-300 dark:hover:border-sky-400/20'
                    }`}
                  >
                    <span className="block text-[13px] font-bold">{tab.label}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">{tab.description}</span>
                  </button>
                );
              })}
            </nav>

            <main className="min-h-[420px] rounded-lg border border-white/70 bg-white/55 p-4 shadow-inner shadow-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/35 md:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[18px] font-extrabold text-slate-950 dark:text-slate-50">{activeTabMeta.label}</h2>
                  <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{activeTabMeta.description}</p>
                </div>
              </div>

              {activeTab === 'capture' && (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="rounded-lg border border-dashed border-sky-200 bg-sky-50/55 p-4 dark:border-sky-400/25 dark:bg-sky-950/20">
                    <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 text-sky-700 shadow-sm backdrop-blur-md dark:bg-slate-950/60 dark:text-sky-200">
                        {preparing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
                      </div>
                      <div>
                        <h3 className="text-[16px] font-bold text-slate-950 dark:text-slate-50">명함 이미지 선택</h3>
                        <p className="mt-2 max-w-md text-[13px] leading-6 text-muted-foreground">
                          모바일에서는 카메라가 열리고, 데스크톱에서는 파일 선택으로 이어집니다. 이미지는 업로드 전에 브라우저에서 한 번 압축합니다.
                        </p>
                      </div>
                      <Input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={handleFileChange}
                      />
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={preparing}>
                          <Upload className="h-4 w-4" />
                          촬영/업로드
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!preparedImage || processing || !bffEnabled}
                          onClick={handleProcessImage}
                        >
                          {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                          추출 실행
                        </Button>
                      </div>
                      {imageError && (
                        <p className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700 dark:border-rose-400/20 dark:bg-rose-950/25 dark:text-rose-200">
                          <AlertTriangle className="h-4 w-4" />
                          {imageError}
                        </p>
                      )}
                    </div>
                  </div>

                  <aside className="rounded-lg border border-white/70 bg-white/65 p-4 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-950/45">
                    <h3 className="flex items-center gap-2 text-[13px] font-bold text-slate-950 dark:text-slate-50">
                      <UserRoundCheck className="h-4 w-4 text-sky-600" />
                      업로드 미리보기
                    </h3>
                    {preparedImage ? (
                      <div className="mt-3 space-y-3">
                        <img
                          src={preparedImage.previewUrl}
                          alt="명함 미리보기"
                          className="aspect-[1.58/1] w-full rounded-lg border border-slate-200 object-cover dark:border-white/10"
                        />
                        <dl className="space-y-2 text-[12px]">
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">파일명</dt>
                            <dd className="max-w-[180px] truncate font-semibold text-slate-900 dark:text-slate-100">{preparedImage.fileName}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">형식</dt>
                            <dd className="font-semibold text-slate-900 dark:text-slate-100">{preparedImage.mimeType}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">용량</dt>
                            <dd className="font-semibold text-slate-900 dark:text-slate-100">{formatBytes(preparedImage.fileSize)}</dd>
                          </div>
                        </dl>
                        <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-400/20 dark:bg-amber-950/25 dark:text-amber-200">
                          추출 실행 시 이 이미지는 private Storage에 저장되고 Gemini 검토 draft로 이어집니다.
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white/40 px-4 text-center text-[12px] leading-5 text-muted-foreground dark:border-white/10 dark:bg-slate-950/25">
                        선택한 명함 이미지가 여기에 표시됩니다.
                      </div>
                    )}
                  </aside>
                  <div className="lg:col-span-2">
                    {workflowMessage && (
                      <div className="mb-4 rounded-lg border border-sky-200/70 bg-sky-50/75 px-3 py-2 text-[12px] font-semibold text-sky-800 dark:border-sky-400/20 dark:bg-sky-950/25 dark:text-sky-200">
                        {workflowMessage}
                      </div>
                    )}

                    {currentImport?.extracted && (
                      <section className="rounded-lg border border-white/70 bg-white/70 p-4 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-950/45">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-[15px] font-extrabold text-slate-950 dark:text-slate-50">추출 결과 검토</h3>
                            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                              낮은 신뢰도의 값은 표시해 두었습니다. 확인 후 저장해야 전사 검색에 반영됩니다.
                            </p>
                          </div>
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-400/20 dark:bg-amber-950/25 dark:text-amber-200">
                            {currentImport.status}
                          </span>
                        </div>

                        {currentImport.extracted.warnings.length > 0 && (
                          <div className="mt-3 rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[12px] leading-5 text-amber-800 dark:border-amber-400/20 dark:bg-amber-950/25 dark:text-amber-200">
                            {currentImport.extracted.warnings.join(' · ')}
                          </div>
                        )}

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          {[
                            ['name', '이름', currentImport.extracted.name],
                            ['organization', '회사/소속', currentImport.extracted.organization],
                            ['department', '부서', currentImport.extracted.department],
                            ['title', '직함', currentImport.extracted.title],
                            ['role', '직책/역할', currentImport.extracted.role],
                            ['website', '웹사이트', currentImport.extracted.website],
                          ].map(([key, label, field]) => (
                            <label key={String(key)} className="space-y-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                              <span className="flex items-center gap-2">
                                {label as string}
                                {isLowConfidenceField(field as typeof currentImport.extracted.name) && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">확인 필요</span>
                                )}
                              </span>
                              <Input
                                value={formState[key as keyof typeof formState]}
                                onChange={(event) => updateFormField(key as keyof typeof formState, event.target.value)}
                              />
                            </label>
                          ))}
                          <label className="space-y-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                            이메일
                            <Input value={formState.emailsText} onChange={(event) => updateFormField('emailsText', event.target.value)} placeholder="email@example.com, ..." />
                          </label>
                          <label className="space-y-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
                            전화번호
                            <Input value={formState.phonesText} onChange={(event) => updateFormField('phonesText', event.target.value)} placeholder="010-0000-0000, ..." />
                          </label>
                          <label className="space-y-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200 md:col-span-2">
                            주소
                            <Input value={formState.address} onChange={(event) => updateFormField('address', event.target.value)} />
                          </label>
                          <label className="space-y-1.5 text-[12px] font-semibold text-slate-700 dark:text-slate-200 md:col-span-2">
                            메모
                            <Input value={formState.memo} onChange={(event) => updateFormField('memo', event.target.value)} />
                          </label>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[11px] text-muted-foreground">
                            저장 조건: 이름 또는 회사/소속 1개 이상, 이메일 또는 전화번호 1개 이상
                          </p>
                          <Button type="button" onClick={handleSaveContact} disabled={!canSave || saving || currentImport.status === 'saved'}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            연락처 저장
                          </Button>
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'search' && (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleSearchContacts();
                      }}
                      placeholder="이름, 회사, 이메일, 전화번호 검색"
                    />
                    <Button type="button" onClick={handleSearchContacts} disabled={!searchQuery.trim() || searching || !bffEnabled}>
                      {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      검색
                    </Button>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-white/70 bg-white/65 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-950/35">
                    {searchResults.length === 0 ? (
                      <div className="flex min-h-[180px] flex-col items-center justify-center px-4 text-center">
                        <Search className="h-8 w-8 text-sky-600 dark:text-sky-300" />
                        <h3 className="mt-3 text-[15px] font-bold text-slate-950 dark:text-slate-50">전사 연락처 검색</h3>
                        <p className="mt-2 max-w-md text-[12px] leading-5 text-muted-foreground">
                          저장된 연락처를 이름, 회사, 이메일, 전화번호 일부로 찾습니다.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y divide-white/70 dark:divide-white/10">
                        {searchResults.map((contact) => (
                          <div key={contact.id} className="px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <p className="text-[14px] font-bold text-slate-950 dark:text-slate-50">{contact.name || contact.organization}</p>
                                <p className="mt-1 text-[12px] text-muted-foreground">
                                  {[contact.organization, contact.department, contact.title || contact.role].filter(Boolean).join(' · ')}
                                </p>
                              </div>
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-800 dark:border-sky-400/20 dark:bg-sky-950/25 dark:text-sky-200">
                                score {contact.score.toFixed(2)}
                              </span>
                            </div>
                            <p className="mt-2 text-[12px] text-slate-700 dark:text-slate-200">
                              {[contact.emails?.[0], contact.phones?.[0]].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'review' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/70 bg-white/55 px-4 py-3 backdrop-blur-md dark:border-white/10 dark:bg-slate-950/35">
                    <div>
                      <h3 className="text-[14px] font-bold text-slate-950 dark:text-slate-50">검토 대기 명함</h3>
                      <p className="mt-1 text-[12px] text-muted-foreground">저장 전 확인이 필요한 추출 draft입니다.</p>
                    </div>
                    <Button type="button" variant="outline" onClick={handleLoadReviewImports} disabled={loadingImports || !bffEnabled}>
                      {loadingImports ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      불러오기
                    </Button>
                  </div>
                  {reviewImports.length === 0 ? (
                    <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white/40 px-4 text-center text-[12px] text-muted-foreground dark:border-white/10 dark:bg-slate-950/25">
                      검토 대기 명함이 없습니다.
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {reviewImports.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => applyImportForReview(item)}
                          className="rounded-lg border border-white/70 bg-white/65 p-4 text-left shadow-sm backdrop-blur-md transition-colors hover:border-sky-200 hover:bg-sky-50/70 dark:border-white/10 dark:bg-slate-950/35 dark:hover:border-sky-400/20"
                        >
                          <span className="block text-[13px] font-bold text-slate-950 dark:text-slate-50">{item.extracted?.name.value || item.extracted?.organization.value || item.fileName}</span>
                          <span className="mt-1 block text-[11px] text-muted-foreground">{item.fileName} · {formatBytes(item.fileSize)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </main>
          </div>
        </section>
      </div>
    </div>
  );
}
