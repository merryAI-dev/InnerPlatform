package dev.merryai.innerplatform.weekly.api;

public final class WeeklyExpenseRequestLimits {
    public static final int MAX_ROW_COUNT = 2000;
    public static final int MAX_ROW_INDEX = MAX_ROW_COUNT - 1;
    public static final int COLUMN_COUNT = 20;
    public static final int MAX_COLUMN_INDEX = COLUMN_COUNT - 1;
    public static final int MAX_PATCH_CELL_COUNT = MAX_ROW_COUNT * COLUMN_COUNT;
    public static final int MAX_ROW_OPERATION_COUNT = 2000;
    public static final int MAX_IDEMPOTENCY_KEY_LENGTH = 120;
    public static final int MAX_SHEET_NAME_LENGTH = 255;
    public static final int MAX_SOURCE_ID_LENGTH = 120;
    public static final int MAX_ENTRY_KIND_LENGTH = 30;
    public static final int MAX_CELL_VALUE_LENGTH = 4000;
    public static final int MAX_CELL_VALIDATION_MESSAGE_LENGTH = 1000;
    public static final int MAX_CASHFLOW_LINE_LENGTH = 200;
    public static final int MAX_YEAR_MONTH_LENGTH = 7;

    private WeeklyExpenseRequestLimits() {
    }
}
