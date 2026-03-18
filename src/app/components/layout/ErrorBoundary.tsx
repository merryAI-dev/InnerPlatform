import React from 'react';
import { AlertTriangle, Home, RefreshCcw } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

type ResetKey = string | number | null | undefined;

function inferHomePath(explicit?: string): string {
  if (explicit) return explicit;
  if (typeof window === 'undefined') return '/';
  return window.location.pathname.startsWith('/portal') ? '/portal' : '/';
}

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  homePath?: string;
  resetKey?: ResetKey;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: unknown;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown) {
    // Keep a console record for debugging; UI shows a user-friendly fallback.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] uncaught error', error);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  private handleReload = () => {
    if (typeof window === 'undefined') return;
    window.location.reload();
  };

  private handleGoHome = () => {
    if (typeof window === 'undefined') return;
    window.location.assign(inferHomePath(this.props.homePath));
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const homePath = inferHomePath(this.props.homePath);
    const message =
      this.state.error instanceof Error ? this.state.error.message : undefined;

    return (
      <div className="py-10">
        <Card className="border-rose-200/60 dark:border-rose-800/40 bg-rose-50/50 dark:bg-rose-950/10">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[14px]" style={{ fontWeight: 800 }}>
                  예기치 못한 오류가 발생했습니다
                </p>
                <p className="text-[12px] text-muted-foreground mt-1">
                  새로고침을 시도하거나 홈으로 이동해 주세요. 문제가 반복되면 관리자에게 알려주세요.
                </p>
                {message && (
                  <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-300 break-words">
                    {message}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-2">
                  <Button variant="outline" className="gap-1.5" onClick={this.handleReload}>
                    <RefreshCcw className="w-3.5 h-3.5" /> 새로고침
                  </Button>
                  <Button className="gap-1.5" onClick={this.handleGoHome}>
                    <Home className="w-3.5 h-3.5" /> 홈으로 ({homePath})
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }
}

