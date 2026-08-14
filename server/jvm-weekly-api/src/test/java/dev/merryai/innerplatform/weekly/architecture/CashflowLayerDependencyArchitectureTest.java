package dev.merryai.innerplatform.weekly.architecture;

import dev.merryai.innerplatform.weekly.service.WeeklyExpenseCommandService;
import dev.merryai.innerplatform.weekly.service.port.CashflowMonthReopenPort;
import dev.merryai.innerplatform.weekly.service.query.CashflowMonthReopenAuthorityResult;
import dev.merryai.innerplatform.weekly.storage.WeeklyExpensePersistence;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class CashflowLayerDependencyArchitectureTest {

    @Test
    void domainDoesNotImportApplicationApiOrStorageLayers() throws IOException {
        Path domain = sourceRoot().resolve("dev/merryai/innerplatform/weekly/domain");

        try (var files = Files.walk(domain)) {
            List<String> forbiddenImports = files
                .filter(path -> path.toString().endsWith(".java"))
                .flatMap(path -> readLines(path).stream())
                .map(String::trim)
                .filter(line -> line.startsWith("import dev.merryai.innerplatform.weekly."))
                .filter(line -> line.contains(".service.")
                    || line.contains(".api.")
                    || line.contains(".storage.")
                    || line.contains(".repository."))
                .toList();

            assertThat(forbiddenImports).isEmpty();
        }
    }

    @Test
    void reopenApplicationPortDependsOnlyOnDomainTypesAndTheServiceUsesThatPort() throws Exception {
        Path port = sourceRoot().resolve(
            "dev/merryai/innerplatform/weekly/service/port/CashflowMonthReopenPort.java"
        );
        List<String> imports = readLines(port).stream()
            .map(String::trim)
            .filter(line -> line.startsWith("import "))
            .toList();

        assertThat(imports)
            .allSatisfy(line -> assertThat(line)
                .doesNotContain(".api.", ".storage.", ".repository."));
        assertThat(WeeklyExpenseCommandService.class.getDeclaredField("cashflowMonthReopenPort").getType())
            .isEqualTo(CashflowMonthReopenPort.class);
        assertThat(CashflowMonthReopenPort.class.isAssignableFrom(WeeklyExpensePersistence.class)).isTrue();
        assertThat(WeeklyExpenseCommandService.class.getDeclaredMethod(
            "readCashflowMonthReopenAuthority",
            CashflowMonthReopenPort.Actor.class,
            String.class
        ).getReturnType()).isEqualTo(CashflowMonthReopenAuthorityResult.class);

        Path queryResult = sourceRoot().resolve(
            "dev/merryai/innerplatform/weekly/service/query/CashflowMonthReopenAuthorityResult.java"
        );
        List<String> querySource = readLines(queryResult);
        assertThat(querySource.stream()
            .map(String::trim)
            .filter(line -> line.startsWith("import "))
            .toList())
            .allSatisfy(line -> assertThat(line)
                .doesNotContain(".api.", ".storage.", ".repository."));
        assertThat(String.join("\n", querySource))
            .doesNotContain(
                "boolean ok",
                "guide",
                "재오픈 결정 권한",
                "잠시 후 다시 시도"
            );

        String commandServiceSource = String.join("\n", readLines(sourceRoot().resolve(
            "dev/merryai/innerplatform/weekly/service/WeeklyExpenseCommandService.java"
        )));
        assertThat(commandServiceSource)
            .contains(
                "cashflowMonthReopenPort.findCashflowMonthReopenDecisionAuthorityFacts",
                "cashflowMonthReopenPort.bindCashflowMonthReopenDecisionAuthority"
            )
            .doesNotContain(
                "api.CashflowMonthReopenAuthorityResponse",
                "persistence.findCashflowMonthReopenDecisionAuthorityFacts",
                "persistence.bindCashflowMonthReopenDecisionAuthority"
            );
    }

    @Test
    void dashboardControllerDelegatesBusinessOrchestrationToApplicationQuery() throws IOException {
        String controller = String.join("\n", readLines(sourceRoot().resolve(
            "dev/merryai/innerplatform/weekly/api/WeeklyExpenseController.java"
        )));
        String dashboardRead = controller.substring(
            controller.indexOf("public CashflowMonthDashboardSourceResponse readCashflowMonthDashboardSource("),
            controller.indexOf("@PostMapping(\"/cashflow/{projectId}/month-close\")")
        );

        assertThat(dashboardRead)
            .contains("dashboardQueryService.read(")
            .doesNotContain(
                "CompletableFuture",
                "dashboardSectionQueryService.read(",
                "cumulative.operationalStatus(",
                "readService.cumulativeCloseHead(",
                "readService.declaredWeeklyYear("
            );
        assertThat(controller)
            .doesNotContain(
                "new CashflowMonthDashboardQueryService(",
                "MONTH_CLOSE_HISTORY_STATUS_DIFFERS_FROM_CUMULATIVE_AUTHORITY"
            );

        Path applicationQuery = sourceRoot().resolve(
            "dev/merryai/innerplatform/weekly/service/query/CashflowMonthDashboardQueryService.java"
        );
        List<String> applicationSource = readLines(applicationQuery);
        assertThat(applicationSource.stream()
            .map(String::trim)
            .filter(line -> line.startsWith("import "))
            .toList())
            .allSatisfy(line -> assertThat(line)
                .doesNotContain(".api.", ".storage.", ".repository."));
        assertThat(String.join("\n", applicationSource))
            .doesNotContain("record Blocker(String code, String guide)")
            .doesNotContainPattern("[가-힣]");
    }

    private static Path sourceRoot() {
        return Path.of(System.getProperty("user.dir"), "src/main/java");
    }

    private static List<String> readLines(Path path) {
        try {
            return Files.readAllLines(path);
        } catch (IOException error) {
            throw new IllegalStateException("Could not read source for architecture test: " + path, error);
        }
    }
}
