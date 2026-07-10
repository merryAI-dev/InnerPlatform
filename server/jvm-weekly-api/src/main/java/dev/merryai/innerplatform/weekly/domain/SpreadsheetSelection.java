package dev.merryai.innerplatform.weekly.domain;

public record SpreadsheetSelection(int startRow, int startColumn, int endRow, int endColumn) {
    public SpreadsheetSelection {
        if (startRow < 0 || startColumn < 0 || endRow < 0 || endColumn < 0) {
            throw new IllegalArgumentException("selection coordinates must be non-negative");
        }
    }

    public int top() {
        return Math.min(startRow, endRow);
    }

    public int bottom() {
        return Math.max(startRow, endRow);
    }

    public int left() {
        return Math.min(startColumn, endColumn);
    }

    public int right() {
        return Math.max(startColumn, endColumn);
    }

    public int rowCount() {
        return bottom() - top() + 1;
    }

    public int columnCount() {
        return right() - left() + 1;
    }
}
