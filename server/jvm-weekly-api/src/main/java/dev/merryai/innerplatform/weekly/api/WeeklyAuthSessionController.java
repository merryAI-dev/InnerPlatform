package dev.merryai.innerplatform.weekly.api;

import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class WeeklyAuthSessionController {
    public static final String SESSION_COOKIE_NAME = "__Host-innerplatform_weekly_session";

    private final FirebaseBearerTokenVerifier firebaseBearerTokenVerifier;
    private final Duration sessionTtl;

    public WeeklyAuthSessionController(
        FirebaseBearerTokenVerifier firebaseBearerTokenVerifier,
        @Value("${weekly.session-cookie-ttl-seconds:432000}") long sessionTtlSeconds
    ) {
        this.firebaseBearerTokenVerifier = firebaseBearerTokenVerifier;
        this.sessionTtl = Duration.ofSeconds(Math.max(300, Math.min(sessionTtlSeconds, 432000)));
    }

    @PostMapping("/session")
    public CreateFirebaseSessionResponse createSession(
        @Valid @RequestBody CreateFirebaseSessionRequest request,
        HttpServletResponse response
    ) {
        VerifiedFirebaseActor actor = firebaseBearerTokenVerifier.verify(request.idToken());
        String sessionCookie = firebaseBearerTokenVerifier.createSessionCookie(request.idToken(), sessionTtl);
        response.addHeader(HttpHeaders.SET_COOKIE, sessionCookie(sessionCookie, sessionTtl).toString());
        return new CreateFirebaseSessionResponse(
            true,
            actor.actorId(),
            actor.tenantId(),
            actor.actorRole(),
            sessionTtl.toSeconds()
        );
    }

    @PostMapping("/logout")
    public CreateFirebaseSessionResponse logout(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, sessionCookie("", Duration.ZERO).toString());
        return new CreateFirebaseSessionResponse(true, "", "", "", 0);
    }

    private ResponseCookie sessionCookie(String value, Duration maxAge) {
        return ResponseCookie.from(SESSION_COOKIE_NAME, value)
            .httpOnly(true)
            .secure(true)
            .sameSite("None")
            .path("/")
            .maxAge(maxAge)
            .build();
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> invalidFirebaseToken(IllegalArgumentException error) {
        return ResponseEntity.status(401).body(Map.of(
            "ok", "false",
            "code", "weekly_expense_firebase_auth_invalid",
            "message", error.getMessage()
        ));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> invalidSessionRequest(MethodArgumentNotValidException error) {
        return ResponseEntity.status(400).body(Map.of(
            "ok", "false",
            "code", "weekly_expense_firebase_auth_request_invalid",
            "message", "Firebase ID token is required."
        ));
    }
}
