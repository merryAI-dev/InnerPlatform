package dev.merryai.innerplatform.weekly.domain;

import java.util.List;

public record ClipboardPayload(
    SpreadsheetOperationType operationType,
    ClipboardDepth depth,
    SpreadsheetSelection sourceSelection,
    int rowCount,
    int columnCount,
    List<ClipboardCell> cells
) {
    public ClipboardPayload {
        cells = List.copyOf(cells);
        if (rowCount <= 0) throw new IllegalArgumentException("rowCount must be positive");
        if (columnCount <= 0) throw new IllegalArgumentException("columnCount must be positive");
    }
}

