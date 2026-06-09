package dev.merryai.innerplatform.weekly.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.Vector;

@Component
public class InternalServiceTokenFilter extends OncePerRequestFilter {
    public static final String HEADER_NAME = "x-inner-platform-service-token";

    private final String internalApiToken;
    private final FirebaseBearerTokenVerifier firebaseBearerTokenVerifier;

    public InternalServiceTokenFilter(
        @Value("${weekly.internal-api-token}") String internalApiToken,
        FirebaseBearerTokenVerifier firebaseBearerTokenVerifier
    ) {
        if (internalApiToken == null || internalApiToken.isBlank()) {
            throw new IllegalStateException("weekly.internal-api-token must be configured.");
        }
        this.internalApiToken = internalApiToken;
        this.firebaseBearerTokenVerifier = firebaseBearerTokenVerifier;
    }

    @Override
    protected void doFilterInternal(
        HttpServletRequest request,
        HttpServletResponse response,
        FilterChain filterChain
    ) throws ServletException, IOException {
        if (isPublicEndpoint(request)) {
            filterChain.doFilter(request, response);
            return;
        }

        String suppliedToken = request.getHeader(HEADER_NAME);
        if (tokensMatch(internalApiToken, suppliedToken)) {
            filterChain.doFilter(request, response);
            return;
        }

        VerifiedFirebaseActor actor;
        try {
            actor = verifyFirebaseActor(request);
            requireHeaderMatch(request, "x-tenant-id", actor.tenantId(), "tenant_mismatch", "Header tenant does not match token tenant.");
            requireHeaderMatch(request, "x-actor-id", actor.actorId(), "actor_mismatch", "Header actor does not match token subject.");
            requireCookieMutationHeader(request);
        } catch (WeeklyApiAuthException error) {
            writeAuthError(response, error.statusCode, error.code, error.getMessage());
            return;
        } catch (RuntimeException error) {
            writeAuthError(response, HttpServletResponse.SC_UNAUTHORIZED, "weekly_expense_firebase_auth_required", error.getMessage());
            return;
        }

        filterChain.doFilter(withTrustedActorHeaders(request, actor), response);
    }

    private boolean isPublicEndpoint(HttpServletRequest request) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }
        String path = request.getRequestURI();
        if ("GET".equalsIgnoreCase(request.getMethod()) && "/api/v1/health".equals(path)) {
            return true;
        }
        return "POST".equalsIgnoreCase(request.getMethod())
            && ("/api/v1/auth/session".equals(path) || "/api/v1/auth/logout".equals(path));
    }

    private boolean tokensMatch(String expected, String supplied) {
        if (supplied == null || supplied.isBlank()) {
            return false;
        }
        return MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8),
            supplied.getBytes(StandardCharsets.UTF_8)
        );
    }

    private String parseBearer(String authorization) {
        String value = authorization == null ? "" : authorization.trim();
        if (value.isEmpty()) return "";
        if (!value.toLowerCase(Locale.ROOT).startsWith("bearer ")) return "";
        return value.substring("bearer ".length()).trim();
    }

    private VerifiedFirebaseActor verifyFirebaseActor(HttpServletRequest request) {
        String sessionCookie = readCookie(request, WeeklyAuthSessionController.SESSION_COOKIE_NAME);
        if (!sessionCookie.isBlank()) {
            return firebaseBearerTokenVerifier.verifySessionCookie(sessionCookie);
        }
        return firebaseBearerTokenVerifier.verify(parseBearer(request.getHeader("authorization")));
    }

    private String readCookie(HttpServletRequest request, String cookieName) {
        if (request.getCookies() == null) return "";
        for (jakarta.servlet.http.Cookie cookie : request.getCookies()) {
            if (cookieName.equals(cookie.getName())) {
                return cookie.getValue() == null ? "" : cookie.getValue().trim();
            }
        }
        return "";
    }

    private void requireCookieMutationHeader(HttpServletRequest request) {
        if (!isMutationMethod(request.getMethod())) return;
        if (readCookie(request, WeeklyAuthSessionController.SESSION_COOKIE_NAME).isBlank()) return;
        String requestId = request.getHeader("x-request-id");
        if (requestId != null && !requestId.isBlank()) return;
        throw new WeeklyApiAuthException(
            HttpServletResponse.SC_FORBIDDEN,
            "weekly_expense_csrf_header_required",
            "Session-cookie mutations require x-request-id."
        );
    }

    private boolean isMutationMethod(String method) {
        String normalized = method == null ? "GET" : method.trim().toUpperCase(Locale.ROOT);
        return "POST".equals(normalized) || "PUT".equals(normalized) || "PATCH".equals(normalized) || "DELETE".equals(normalized);
    }

    private void requireHeaderMatch(
        HttpServletRequest request,
        String headerName,
        String trustedValue,
        String errorCode,
        String message
    ) {
        String supplied = request.getHeader(headerName);
        if (supplied == null || supplied.isBlank()) return;
        if (!supplied.trim().equals(trustedValue)) {
            throw new WeeklyApiAuthException(HttpServletResponse.SC_FORBIDDEN, errorCode, message);
        }
    }

    private HttpServletRequest withTrustedActorHeaders(HttpServletRequest request, VerifiedFirebaseActor actor) {
        Map<String, String> trustedHeaders = new LinkedHashMap<>();
        trustedHeaders.put("x-tenant-id", actor.tenantId());
        trustedHeaders.put("x-actor-id", actor.actorId());
        trustedHeaders.put("x-actor-role", actor.actorRole());
        if (!actor.actorEmail().isBlank()) {
            trustedHeaders.put("x-actor-email", actor.actorEmail());
        }
        return new TrustedActorHeaderRequest(request, trustedHeaders);
    }

    private void writeAuthError(HttpServletResponse response, int status, String code, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.getWriter().write("{\"ok\":false,\"code\":\"" + escapeJson(code) + "\",\"message\":\"" + escapeJson(message) + "\"}");
    }

    private String escapeJson(String value) {
        return String.valueOf(value == null ? "" : value)
            .replace("\\", "\\\\")
            .replace("\"", "\\\"");
    }

    private static class WeeklyApiAuthException extends RuntimeException {
        private final int statusCode;
        private final String code;

        private WeeklyApiAuthException(int statusCode, String code, String message) {
            super(message);
            this.statusCode = statusCode;
            this.code = code;
        }
    }

    private static class TrustedActorHeaderRequest extends HttpServletRequestWrapper {
        private final Map<String, String> trustedHeaders;

        private TrustedActorHeaderRequest(HttpServletRequest request, Map<String, String> trustedHeaders) {
            super(request);
            this.trustedHeaders = trustedHeaders;
        }

        @Override
        public String getHeader(String name) {
            String value = trustedHeaders.get(name.toLowerCase(Locale.ROOT));
            return value == null ? super.getHeader(name) : value;
        }

        @Override
        public Enumeration<String> getHeaders(String name) {
            String value = trustedHeaders.get(name.toLowerCase(Locale.ROOT));
            if (value == null) {
                return super.getHeaders(name);
            }
            return Collections.enumeration(Set.of(value));
        }

        @Override
        public Enumeration<String> getHeaderNames() {
            Set<String> names = new LinkedHashSet<>();
            Enumeration<String> existing = super.getHeaderNames();
            while (existing.hasMoreElements()) {
                names.add(existing.nextElement());
            }
            names.addAll(trustedHeaders.keySet());
            return new Vector<>(names).elements();
        }
    }
}
