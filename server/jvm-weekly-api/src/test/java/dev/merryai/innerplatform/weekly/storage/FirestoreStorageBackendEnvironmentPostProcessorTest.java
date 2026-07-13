package dev.merryai.innerplatform.weekly.storage;

import org.junit.jupiter.api.Test;
import org.springframework.boot.SpringApplication;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.test.context.support.TestPropertySourceUtils;

import static org.assertj.core.api.Assertions.assertThat;

class FirestoreStorageBackendEnvironmentPostProcessorTest {
    @Test
    void excludesJpaDatasourceAndFlywayAutoconfigurationInFirestoreBackendMode() {
        StandardEnvironment environment = new StandardEnvironment();
        TestPropertySourceUtils.addInlinedPropertiesToEnvironment(
            environment,
            "weekly.storage-backend=firestore"
        );

        new FirestoreStorageBackendEnvironmentPostProcessor()
            .postProcessEnvironment(environment, new SpringApplication());

        String excludes = environment.getProperty("spring.autoconfigure.exclude", "");
        assertThat(excludes).contains("DataSourceAutoConfiguration");
        assertThat(excludes).contains("DataSourceTransactionManagerAutoConfiguration");
        assertThat(excludes).contains("HibernateJpaAutoConfiguration");
        assertThat(excludes).contains("JpaRepositoriesAutoConfiguration");
        assertThat(excludes).contains("FlywayAutoConfiguration");
        assertThat(environment.getProperty("spring.flyway.enabled")).isEqualTo("false");
    }

    @Test
    void leavesJpaAutoconfigurationAloneByDefault() {
        StandardEnvironment environment = new StandardEnvironment();

        new FirestoreStorageBackendEnvironmentPostProcessor()
            .postProcessEnvironment(environment, new SpringApplication());

        assertThat(environment.getProperty("spring.autoconfigure.exclude")).isNull();
    }
}
