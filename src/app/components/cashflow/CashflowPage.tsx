import { useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { CashflowAnalyticsPage } from './CashflowAnalyticsPage';
import { CashflowWeeklyPage } from './CashflowWeeklyPage';

export function CashflowPage() {
  const [tab, setTab] = useState<'weekly' | 'analytics'>('weekly');

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onValueChange={(v) => {
          if (v === 'weekly' || v === 'analytics') setTab(v);
        }}
      >
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="weekly" className="gap-2">
            <Table2 className="w-4 h-4" />
            주간 시트
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="w-4 h-4" />
            분석
          </TabsTrigger>
        </TabsList>

        <TabsContent value="weekly">
          <CashflowWeeklyPage />
        </TabsContent>
        <TabsContent value="analytics">
          <CashflowAnalyticsPage />
        </TabsContent>
      </Tabs>
    </div>
  );
}
