package dev.merryai.innerplatform.weekly.domain;

public record CellAddress(int rowIndex, int columnIndex) {
    public CellAddress {
        if (rowIndex < 0) throw new IllegalArgumentException("rowIndex must be non-negative");
        if (columnIndex < 0) throw new IllegalArgumentException("columnIndex must be non-negative");
    }
}

