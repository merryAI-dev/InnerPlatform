package dev.merryai.innerplatform.weekly.storage;

import java.util.List;

public final class CashflowCoordinates {
    private CashflowCoordinates() {}

    public static int weekOrdinal(int weeklyYear, String yearMonth, int weekNo) {
        requireWeeklyYear(weeklyYear);
        if (yearMonth == null || !yearMonth.matches("20\\d{2}-(0[1-9]|1[0-2])") || weekNo < 1 || weekNo > 5) {
            return -1;
        }
        int year = Integer.parseInt(yearMonth.substring(0, 4));
        if (year != weeklyYear) {
            return -1;
        }
        int month = Integer.parseInt(yearMonth.substring(5, 7));
        return (month - 1) * 5 + weekNo - 1;
    }

    public static List<Integer> annualYearsFor(int weeklyYear) {
        requireWeeklyYear(weeklyYear);
        return List.of(
            weeklyYear - 2,
            weeklyYear - 1,
            weeklyYear + 1,
            weeklyYear + 2,
            weeklyYear + 3,
            weeklyYear + 4,
            weeklyYear + 5,
            weeklyYear + 6
        );
    }

    public static int requireWeeklyYear(int weeklyYear) {
        if (weeklyYear < 2000 || weeklyYear > 2099) {
            throw new IllegalArgumentException("Cashflow weeklyYear must be between 2000 and 2099.");
        }
        return weeklyYear;
    }
}
