package dev.merryai.innerplatform.weekly.domain;

import java.util.Arrays;
import java.util.Optional;

public enum WeeklyExpenseColumn {
    AUTHOR(0, "작성자", SpreadsheetValueType.TEXT),
    NO(1, "No.", SpreadsheetValueType.NUMBER),
    DATE(2, "거래일시", SpreadsheetValueType.DATE),
    WEEK(3, "해당 주차", SpreadsheetValueType.TEXT),
    METHOD(4, "지출구분", SpreadsheetValueType.TEXT),
    BUDGET_CODE(5, "비목", SpreadsheetValueType.TEXT),
    SUB_CODE(6, "세목", SpreadsheetValueType.TEXT),
    SUB_SUB_CODE(7, "세세목", SpreadsheetValueType.TEXT),
    CASHFLOW_LINE(8, "cashflow항목", SpreadsheetValueType.TEXT),
    BALANCE_AFTER(9, "통장잔액", SpreadsheetValueType.NUMBER),
    BANK_AMOUNT(10, "통장에 찍힌 입/출금액", SpreadsheetValueType.NUMBER),
    DEPOSIT_AMOUNT(11, "입금액(사업비,공급가액,은행이자)", SpreadsheetValueType.NUMBER),
    VAT_REFUND(12, "매입부가세 반환", SpreadsheetValueType.NUMBER),
    EXPENSE_AMOUNT(13, "사업비 사용액", SpreadsheetValueType.NUMBER),
    VAT_IN(14, "매입부가세", SpreadsheetValueType.NUMBER),
    COUNTERPARTY(15, "지급처", SpreadsheetValueType.TEXT),
    MEMO(16, "상세 적요", SpreadsheetValueType.TEXT),
    EVIDENCE_REQUIRED(17, "필수증빙자료 리스트", SpreadsheetValueType.TEXT),
    EVIDENCE_COMPLETED(18, "실제 구비 완료된 증빙자료 리스트", SpreadsheetValueType.TEXT),
    EVIDENCE_PENDING(19, "준비필요자료", SpreadsheetValueType.TEXT);

    private final int index;
    private final String header;
    private final SpreadsheetValueType valueType;

    WeeklyExpenseColumn(int index, String header, SpreadsheetValueType valueType) {
        this.index = index;
        this.header = header;
        this.valueType = valueType;
    }

    public int index() {
        return index;
    }

    public String header() {
        return header;
    }

    public SpreadsheetValueType valueType() {
        return valueType;
    }

    public static Optional<WeeklyExpenseColumn> fromIndex(int index) {
        return Arrays.stream(values()).filter(column -> column.index == index).findFirst();
    }
}
