package dev.merryai.innerplatform.weekly.storage;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;

import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

public class FirestoreStorageBackendEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {
    private static final String[] FIRESTORE_EXCLUDES = {
        "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration",
        "org.springframework.boot.autoconfigure.jdbc.DataSourceTransactionManagerAutoConfiguration",
        "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration",
        "org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration",
        "org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration"
    };

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String backend = environment.getProperty("weekly.storage-backend", "firestore").trim();
        if (!"firestore".equalsIgnoreCase(backend)) return;

        Set<String> excludes = new LinkedHashSet<>();
        String existing = environment.getProperty("spring.autoconfigure.exclude", "");
        if (!existing.isBlank()) {
            Arrays.stream(existing.split(","))
                .map(String::trim)
                .filter(value -> !value.isBlank())
                .forEach(excludes::add);
        }
        excludes.addAll(Arrays.asList(FIRESTORE_EXCLUDES));

        environment.getPropertySources().addFirst(new MapPropertySource(
            "weekly-firestore-storage-autoconfig",
            Map.of(
                "spring.autoconfigure.exclude", String.join(",", excludes),
                "spring.flyway.enabled", "false"
            )
        ));
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 20;
    }
}
