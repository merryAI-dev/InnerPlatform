package dev.merryai.innerplatform.weekly.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class WeeklyApiCorsConfigurationTest {
    @Test
    void defaultOriginsIncludeFixedStageAndLive() {
        assertThat(WeeklyApiCorsConfiguration.parseOrigins(""))
            .containsExactly(
                "https://inner-platform-stage-merryai-devs-projects.vercel.app",
                "https://inner-platform.vercel.app"
            );
    }

    @Test
    void configuredOriginsAreTrimmed() {
        assertThat(WeeklyApiCorsConfiguration.parseOrigins(" https://stage.example , https://live.example "))
            .containsExactly("https://stage.example", "https://live.example");
    }
}
