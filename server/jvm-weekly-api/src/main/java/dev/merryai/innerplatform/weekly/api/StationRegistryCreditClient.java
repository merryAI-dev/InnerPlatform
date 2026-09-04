package dev.merryai.innerplatform.weekly.api;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

@Component
public class StationRegistryCreditClient {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final HttpClient http;
    private final URI creditsUri;
    private final URI tokenUri;

    @Autowired
    public StationRegistryCreditClient(
        @Value("${station.registry-credits-url:}") String creditsUrl,
        @Value("${station.registry-credits-audience:${station.registry-credits-url:}}") String audience
    ) {
        this(
            creditsUrl == null || creditsUrl.isBlank() ? null : URI.create(creditsUrl),
            audience == null || audience.isBlank() ? null : URI.create(
                "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"
                    + "?audience=" + URLEncoder.encode(audience, StandardCharsets.UTF_8) + "&format=full"
            )
        );
    }

    StationRegistryCreditClient(URI creditsUri, URI tokenUri) {
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
        this.creditsUri = creditsUri;
        this.tokenUri = tokenUri;
    }

    public JsonNode read() {
        if (creditsUri == null || tokenUri == null) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Station credit integration is not configured.");
        }
        try {
            HttpResponse<String> token = http.send(HttpRequest.newBuilder(tokenUri)
                .header("Metadata-Flavor", "Google").timeout(Duration.ofSeconds(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
            if (token.statusCode() != 200 || token.body().isBlank()) throw new IllegalStateException("OIDC token unavailable");

            HttpResponse<String> response = http.send(HttpRequest.newBuilder(creditsUri)
                .header("Authorization", "Bearer " + token.body().trim()).header("Accept", "application/json")
                .timeout(Duration.ofSeconds(10)).GET().build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) throw new IllegalStateException("Station returned " + response.statusCode());
            JsonNode payload = JSON.readTree(response.body());
            if (!"station".equals(payload.path("source").asText()) || !payload.path("readOnly").asBoolean() || !payload.path("people").isArray()) {
                throw new IllegalStateException("Invalid Station response");
            }
            return payload;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw unavailable(error);
        } catch (Exception error) {
            throw unavailable(error);
        }
    }

    private ResponseStatusException unavailable(Exception cause) {
        return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Station credits are temporarily unavailable.", cause);
    }
}
