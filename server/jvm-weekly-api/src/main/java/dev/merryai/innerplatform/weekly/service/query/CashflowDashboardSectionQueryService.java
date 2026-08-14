package dev.merryai.innerplatform.weekly.service.query;

import dev.merryai.innerplatform.weekly.service.port.CashflowReadPort;
import org.springframework.stereotype.Service;

import java.util.function.Supplier;

@Service
public class CashflowDashboardSectionQueryService {

    public <T> CashflowDashboardSectionResult<T> read(
        String unavailableCode,
        Supplier<T> operation
    ) {
        try {
            return CashflowDashboardSectionResult.available(operation.get());
        } catch (CashflowReadPort.Unavailable error) {
            return CashflowDashboardSectionResult.unavailable(unavailableCode);
        }
    }
}
