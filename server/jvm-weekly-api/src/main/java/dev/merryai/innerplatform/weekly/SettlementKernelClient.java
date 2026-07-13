package dev.merryai.innerplatform.weekly;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.TimeUnit;

final class SettlementKernelClient {
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final Path binaryPath;

    SettlementKernelClient(Path repoRoot) {
        String configured = System.getenv("SETTLEMENT_KERNEL_BIN");
        this.binaryPath = configured == null || configured.isBlank()
            ? repoRoot.resolve("rust/spreadsheet-calculation-core/target/debug/spreadsheet-calculation-core")
            : Path.of(configured);
    }

    boolean isAvailable() {
        return Files.isRegularFile(binaryPath) && Files.isExecutable(binaryPath);
    }

    String derive(String requestJson) throws IOException, InterruptedException {
        return run(requestJson);
    }

    String actualSync(String requestJson) throws IOException, InterruptedException {
        return run(withCommand(requestJson, "actualSync"));
    }

    String flowSnapshot(String requestJson) throws IOException, InterruptedException {
        return run(withCommand(requestJson, "flowSnapshot"));
    }

    private String run(String requestJson) throws IOException, InterruptedException {
        if (!isAvailable()) {
            throw new KernelUnavailableException("Settlement kernel binary is unavailable: " + binaryPath);
        }

        Process process = new ProcessBuilder(binaryPath.toString()).start();
        process.getOutputStream().write(requestJson.getBytes(StandardCharsets.UTF_8));
        process.getOutputStream().close();

        boolean exited = process.waitFor(TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);
        if (!exited) {
            process.destroyForcibly();
            throw new KernelFailedException("Settlement kernel timed out.");
        }

        String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
        if (process.exitValue() != 0) {
            throw new KernelFailedException(stderr.isBlank() ? stdout : stderr);
        }
        return stdout.isBlank() ? "{}" : stdout;
    }

    private static String withCommand(String requestJson, String command) {
        String trimmed = requestJson == null ? "" : requestJson.trim();
        if (trimmed.isEmpty() || trimmed.equals("{}")) {
            return "{\"command\":\"" + command + "\"}";
        }
        if (!trimmed.startsWith("{")) {
            throw new IllegalArgumentException("Kernel request must be a JSON object.");
        }
        return "{\"command\":\"" + command + "\"," + trimmed.substring(1);
    }

    static final class KernelUnavailableException extends RuntimeException {
        KernelUnavailableException(String message) {
            super(message);
        }
    }

    static final class KernelFailedException extends RuntimeException {
        KernelFailedException(String message) {
            super(message);
        }
    }
}
