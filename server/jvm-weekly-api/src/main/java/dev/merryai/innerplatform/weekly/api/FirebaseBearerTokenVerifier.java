package dev.merryai.innerplatform.weekly.api;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.SessionCookieOptions;
import com.google.firebase.auth.FirebaseToken;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

@Component
public class FirebaseBearerTokenVerifier {
    private static final String TEST_TOKEN_PREFIX = "test-firebase:";
    private static final String TEST_SESSION_PREFIX = "test-firebase-session:";

    private final String firebaseProjectId;
    private final boolean testTokensEnabled;
    private volatile FirebaseAuth firebaseAuth;

    public FirebaseBearerTokenVerifier(
        @Value("${weekly.firebase-project-id:}") String firebaseProjectId,
        @Value("${weekly.firebase-test-tokens-enabled:false}") boolean testTokensEnabled
    ) {
        this.firebaseProjectId = firebaseProjectId == null ? "" : firebaseProjectId.trim();
        this.testTokensEnabled = testTokensEnabled;
    }

    public VerifiedFirebaseActor verify(String bearerToken) {
        String token = bearerToken == null ? "" : bearerToken.trim();
        if (token.isEmpty()) {
            throw new IllegalArgumentException("Authorization Bearer token is required.");
        }
        if (testTokensEnabled && token.startsWith(TEST_TOKEN_PREFIX)) {
            return verifyTestToken(token.substring(TEST_TOKEN_PREFIX.length()));
        }

        FirebaseToken firebaseToken;
        try {
            firebaseToken = auth().verifyIdToken(token, true);
        } catch (Exception error) {
            throw new IllegalArgumentException("Invalid Firebase ID token.");
        }

        Map<String, Object> claims = firebaseToken.getClaims();
        String tenantId = readTextClaim(claims, "tenantId", "tenant_id", "orgId", "org_id");
        String actorRole = readRoleClaim(claims);
        String actorEmail = normalizeEmail(firebaseToken.getEmail());
        return new VerifiedFirebaseActor(tenantId, firebaseToken.getUid(), actorEmail, actorRole);
    }

    public String createSessionCookie(String idToken, Duration expiresIn) {
        String token = idToken == null ? "" : idToken.trim();
        if (token.isEmpty()) {
            throw new IllegalArgumentException("Firebase ID token is required.");
        }
        if (testTokensEnabled && token.startsWith(TEST_TOKEN_PREFIX)) {
            return TEST_SESSION_PREFIX + token.substring(TEST_TOKEN_PREFIX.length());
        }
        try {
            SessionCookieOptions options = SessionCookieOptions.builder()
                .setExpiresIn(expiresIn.toMillis())
                .build();
            return auth().createSessionCookie(token, options);
        } catch (Exception error) {
            throw new IllegalArgumentException("Invalid Firebase ID token.");
        }
    }

    public VerifiedFirebaseActor verifySessionCookie(String sessionCookie) {
        String cookie = sessionCookie == null ? "" : sessionCookie.trim();
        if (cookie.isEmpty()) {
            throw new IllegalArgumentException("Firebase session cookie is required.");
        }
        if (testTokensEnabled && cookie.startsWith(TEST_SESSION_PREFIX)) {
            return verifyTestToken(cookie.substring(TEST_SESSION_PREFIX.length()));
        }

        FirebaseToken firebaseToken;
        try {
            firebaseToken = auth().verifySessionCookie(cookie, true);
        } catch (Exception error) {
            throw new IllegalArgumentException("Invalid Firebase session cookie.");
        }

        Map<String, Object> claims = firebaseToken.getClaims();
        String tenantId = readTextClaim(claims, "tenantId", "tenant_id", "orgId", "org_id");
        String actorRole = readRoleClaim(claims);
        String actorEmail = normalizeEmail(firebaseToken.getEmail());
        return new VerifiedFirebaseActor(tenantId, firebaseToken.getUid(), actorEmail, actorRole);
    }

    private FirebaseAuth auth() {
        FirebaseAuth existing = firebaseAuth;
        if (existing != null) return existing;
        if (firebaseProjectId.isBlank()) {
            throw new IllegalStateException("weekly.firebase-project-id must be configured for browser-direct Java API auth.");
        }
        synchronized (this) {
            if (firebaseAuth == null) {
                firebaseAuth = FirebaseAuth.getInstance(app());
            }
            return firebaseAuth;
        }
    }

    private FirebaseApp app() {
        for (FirebaseApp candidate : FirebaseApp.getApps()) {
            if ("innerplatform-weekly-api".equals(candidate.getName())) {
                return candidate;
            }
        }
        try {
            FirebaseOptions options = FirebaseOptions.builder()
                .setProjectId(firebaseProjectId)
                .setCredentials(GoogleCredentials.getApplicationDefault())
                .build();
            return FirebaseApp.initializeApp(options, "innerplatform-weekly-api");
        } catch (IOException error) {
            throw new IllegalStateException("Could not initialize Firebase Admin credentials.", error);
        }
    }

    private VerifiedFirebaseActor verifyTestToken(String encoded) {
        Map<String, Object> claims = parseTestClaims(encoded);
        return new VerifiedFirebaseActor(
            readTextClaim(claims, "tenantId", "tenant_id", "orgId", "org_id"),
            readTextClaim(claims, "uid", "sub"),
            normalizeEmail(readTextClaim(claims, "email")),
            readRoleClaim(claims)
        );
    }

    private Map<String, Object> parseTestClaims(String encoded) {
        String jsonLike = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
        Map<String, Object> claims = new HashMap<>();
        for (String pair : jsonLike.split(";")) {
            int sep = pair.indexOf('=');
            if (sep <= 0) continue;
            claims.put(pair.substring(0, sep).trim(), pair.substring(sep + 1).trim());
        }
        return claims;
    }

    private static String readTextClaim(Map<String, Object> claims, String... keys) {
        if (claims == null) return "";
        for (String key : keys) {
            Object value = claims.get(key);
            if (value instanceof String text && !text.trim().isEmpty()) {
                return text.trim();
            }
        }
        return "";
    }

    private static String readRoleClaim(Map<String, Object> claims) {
        String role = readTextClaim(claims, "role");
        if (!role.isBlank()) return role.trim().toLowerCase(Locale.ROOT);
        Object roles = claims == null ? null : claims.get("roles");
        if (roles instanceof Iterable<?> iterable) {
            for (Object value : iterable) {
                if (value instanceof String text && !text.trim().isEmpty()) {
                    return text.trim().toLowerCase(Locale.ROOT);
                }
            }
        }
        return "";
    }

    private static String normalizeEmail(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }
}
