import { describe, expect, it } from 'vitest';
import { mergeRegistryCreditsWithPeople } from './routes/jvm-weekly-api.mjs';

describe('Station Registry credits', () => {
  it('uses the MYSCube person directory for names and never exposes raw email', () => {
    expect(mergeRegistryCreditsWithPeople([
      { workEmail: 'jtkim@mysc.co.kr', totalCredit: 4150, recordCount: 2 },
      { workEmail: 'missing@mysc.co.kr', totalCredit: 100, recordCount: 1 },
    ], [
      { personId: 'person-able', name: '김정태', nickname: '에이블', email: 'JTKIM@mysc.co.kr' },
    ])).toEqual({
      source: 'station',
      readOnly: true,
      unmatchedCount: 1,
      people: [
        { personId: 'person-able', displayName: '김정태(에이블)', totalCredit: 4150, recordCount: 2 },
        { personId: null, displayName: '이름 미등록', totalCredit: 100, recordCount: 1 },
      ],
    });
  });
});
