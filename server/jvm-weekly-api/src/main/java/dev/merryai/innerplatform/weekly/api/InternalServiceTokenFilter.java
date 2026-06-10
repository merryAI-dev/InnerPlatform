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

    private final boolean internalApiTokenEnabled;
    private final String internalApiToken;
    private final FirebaseBearerTokenVerifier firebaseBearerTokenVerifier;
    private final Set<String> allowedOrigins;

    public InternalServiceTokenFilter(
        @Value("${weekly.internal-api-token-enabled:false}") boolean internalApiTokenEnabled,
        @Value("${weekly.internal-api-token}") String internalApiToken,
        @Value("${weekly.allowed-origins:}") String allowedOrigins,
        FirebaseBearerTokenVerifier firebaseBearerTokenVerifier
    ) {
        if (internalApiTokenEnabled && (internalApiToken == null || internalApiToken.isBlank())) {
            throw new IllegalStateException("weekly.internal-api-token must be configured.");
        }
        this.internalApiTokenEnabled = internalApiTokenEnabled;
        this.internalApiToken = internalApiToken;
        this.allowedOrigins = Set.of(WeeklyApiCorsConfiguration.parseOrigins(allowedOrigins));
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
        if (internalApiTokenEnabled && tokensMatch(internalApiToken, suppliedToken)) {
            filterChain.doFilter(request, response);
            return;
        }

        VerifiedFirebaseActor actor;
        try {
            actor = firebaseBearerTokenVerifier.verify(parseBearer(request.getHeader("authorization")));
            requireHeaderMatch(request, "x-actor-id", actor.actorId(), "actor_mismatch", "Header actor does not match token subject.");
            actor = resolveTrustedActor(request, actor);
        } catch (WeeklyApiAuthException error) {
            applyCorsHeaders(request, response);
            writeAuthError(response, error.statusCode, error.code, error.getMessage());
            return;
        } catch (RuntimeException error) {
            applyCorsHeaders(request, response);
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
        return false;
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

    private VerifiedFirebaseActor resolveTrustedActor(HttpServletRequest request, VerifiedFirebaseActor tokenActor) {
        String tenantId = tokenActor.tenantId();
        if (tenantId.isBlank()) {
            tenantId = requireRequestHeader(request, "x-tenant-id", "tenant_required", "Request tenant context is required.");
        } else {
            requireHeaderMatch(request, "x-tenant-id", tenantId, "tenant_mismatch", "Header tenant does not match token tenant.");
        }

        String actorRole = tokenActor.actorRole();
        if (actorRole.isBlank()) {
            actorRole = normalizeRole(requireRequestHeader(request, "x-actor-role", "actor_role_required", "Request actor role context is required."));
            if (isPrivilegedRole(actorRole)) {
                throw new WeeklyApiAuthException(
                    HttpServletResponse.SC_FORBIDDEN,
                    "actor_role_claim_required",
                    "Privileged actor roles require trusted Firebase role claims."
                );
            }
        }

        String actorEmail = tokenActor.actorEmail();
        if (actorEmail.isBlank()) {
            actorEmail = normalizeEmail(request.getHeader("x-actor-email"));
        }

        return new VerifiedFirebaseActor(tenantId, tokenActor.actorId(), actorEmail, actorRole);
    }

    private String requireRequestHeader(HttpServletRequest request, String headerName, String code, String message) {
        String supplied = request.getHeader(headerName);
        if (supplied == null || supplied.isBlank()) {
            throw new WeeklyApiAuthException(HttpServletResponse.SC_UNAUTHORIZED, code, message);
        }
        return supplied.trim();
    }

    private String normalizeRole(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if ("viewer".equals(normalized)) {
            return "pm";
        }
        return normalized;
    }

    private boolean isPrivilegedRole(String value) {
        String normalized = normalizeRole(value);
        return "admin".equals(normalized)
            || "tenant_admin".equals(normalized)
            || "finance".equals(normalized)
            || "auditor".equals(normalized)
            || "support".equals(normalized)
            || "security".equals(normalized);
    }

    private String normalizeEmail(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
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

    private void applyCorsHeaders(HttpServletRequest request, HttpServletResponse response) {
        String origin = request.getHeader("origin");
        if (origin == null || !allowedOrigins.contains(origin.trim())) {
            return;
        }
        response.setHeader("Vary", "Origin");
        response.setHeader("Access-Control-Allow-Origin", origin.trim());
        response.setHeader("Access-Control-Allow-Credentials", "true");
        response.setHeader("Access-Control-Expose-Headers", "x-request-id");
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
