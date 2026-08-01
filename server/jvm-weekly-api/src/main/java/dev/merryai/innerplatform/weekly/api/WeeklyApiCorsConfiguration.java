package dev.merryai.innerplatform.weekly.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WeeklyApiCorsConfiguration implements WebMvcConfigurer {
    private static final String[] DEFAULT_ALLOWED_ORIGINS = new String[]{
        "https://myscube.myscguard.app"
    };
    static final String[] ALLOWED_HEADERS = new String[]{
        "authorization",
        "content-type",
        "idempotency-key",
        "x-request-id",
        "x-tenant-id",
        "x-actor-id",
        "x-actor-role",
        "x-actor-email",
        "x-actor-name"
    };

    private final String[] allowedOrigins;

    public WeeklyApiCorsConfiguration(@Value("${weekly.allowed-origins:}") String allowedOrigins) {
        this.allowedOrigins = parseOrigins(allowedOrigins);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/v1/**")
            .allowedOrigins(allowedOrigins)
            .allowedMethods("GET", "POST", "OPTIONS")
            .allowedHeaders(ALLOWED_HEADERS)
            .exposedHeaders("x-request-id")
            .allowCredentials(true)
            .maxAge(600);
    }

    static String[] parseOrigins(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.isEmpty()) {
            return DEFAULT_ALLOWED_ORIGINS;
        }
        return java.util.Arrays.stream(text.split(","))
            .map(String::trim)
            .filter(value -> !value.isEmpty())
            .toArray(String[]::new);
    }
}
