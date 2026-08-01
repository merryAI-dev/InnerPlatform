package dev.merryai.innerplatform.weekly.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class WeeklyApiCorsConfigurationTest {
    @Test
    void defaultOriginsIncludeOnlyCanonicalLive() {
        assertThat(WeeklyApiCorsConfiguration.parseOrigins(""))
            .containsExactly("https://myscube.myscguard.app");
    }

    @Test
    void configuredOriginsAreTrimmed() {
        assertThat(WeeklyApiCorsConfiguration.parseOrigins(" https://one.example , https://two.example "))
            .containsExactly("https://one.example", "https://two.example");
    }

    @Test
    void allowedHeadersIncludeActorNameForBrowserDirectAuditLogging() {
        assertThat(WeeklyApiCorsConfiguration.ALLOWED_HEADERS)
            .contains("x-actor-id", "x-actor-email", "x-actor-name");
    }
}
