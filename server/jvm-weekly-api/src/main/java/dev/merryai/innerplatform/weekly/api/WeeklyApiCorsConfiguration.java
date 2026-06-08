package dev.merryai.innerplatform.weekly.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WeeklyApiCorsConfiguration implements WebMvcConfigurer {
    private final String[] allowedOrigins;

    public WeeklyApiCorsConfiguration(@Value("${weekly.allowed-origins:}") String allowedOrigins) {
        this.allowedOrigins = parseOrigins(allowedOrigins);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/v1/**")
            .allowedOrigins(allowedOrigins)
            .allowedMethods("GET", "POST", "OPTIONS")
            .allowedHeaders(
                "authorization",
                "content-type",
                "idempotency-key",
                "x-request-id",
                "x-tenant-id",
                "x-actor-id",
                "x-actor-role",
                "x-actor-email"
            )
            .exposedHeaders("x-request-id")
            .allowCredentials(true)
            .maxAge(600);
    }

    private static String[] parseOrigins(String raw) {
        String text = raw == null ? "" : raw.trim();
        if (text.isEmpty()) {
            return new String[]{"https://inner-platform.vercel.app"};
        }
        return java.util.Arrays.stream(text.split(","))
            .map(String::trim)
            .filter(value -> !value.isEmpty())
            .toArray(String[]::new);
    }
}
