package dev.merryai.innerplatform.weekly.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class InternalServiceTokenFilterMembershipTest {
    @ParameterizedTest(name = "present status {0} is denied")
    @MethodSource("nonActiveStatuses")
    void firebaseMemberWithAnyPresentNonExactActiveStatusIsDeniedBeforeController(
        String label,
        Object status
    ) throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        when(resolver.resolve("tenant-a", "actor-a")).thenReturn(Optional.of(member(true, status, "finance")));
        InternalServiceTokenFilter filter = filter("strict", resolver);
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(firebaseRequest("tenant-a", "actor-a", "finance", "actor-a@mysc.co.kr"), response, chain);

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("\"code\":\"member_inactive\"");
        verify(chain, never()).doFilter(any(), any());
    }

    @Test
    void firebaseMemberWithLegacyAbsentStatusUsesOnlyCanonicalRole() throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        when(resolver.resolve("tenant-a", "actor-a")).thenReturn(Optional.of(member(false, null, "pm")));
        InternalServiceTokenFilter filter = filter("strict", resolver);
        AtomicReference<HttpServletRequest> downstream = new AtomicReference<>();
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            downstream.set(invocation.getArgument(0));
            return null;
        }).when(chain).doFilter(any(), any());

        MockHttpServletRequest request = firebaseRequest("tenant-a", "actor-a", "finance", "actor-a@mysc.co.kr");
        request.addHeader("x-actor-role", "admin");
        filter.doFilter(request, new MockHttpServletResponse(), chain);

        assertThat(downstream.get()).isNotNull();
        assertThat(downstream.get().getHeader("x-actor-role")).isEqualTo("pm");
    }

    @Test
    void firebaseActiveMemberWithBlankCanonicalRoleDoesNotFallBackToPrivilegedClaimOrHeader() throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        when(resolver.resolve("tenant-a", "actor-a")).thenReturn(Optional.of(member(true, "ACTIVE", "")));
        InternalServiceTokenFilter filter = filter("strict", resolver);
        AtomicReference<HttpServletRequest> downstream = new AtomicReference<>();
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            downstream.set(invocation.getArgument(0));
            return null;
        }).when(chain).doFilter(any(), any());

        MockHttpServletRequest request = firebaseRequest("tenant-a", "actor-a", "finance", "actor-a@mysc.co.kr");
        request.addHeader("x-actor-role", "admin");
        filter.doFilter(request, new MockHttpServletResponse(), chain);

        assertThat(downstream.get()).isNotNull();
        assertThat(downstream.get().getHeader("x-actor-role")).isEmpty();
    }

    @Test
    void claimlessTenantUsesHeaderOnlyToSelectExactCanonicalMembership() throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        when(resolver.resolve("tenant-selected", "actor-a")).thenReturn(Optional.of(member(true, "ACTIVE", "pm")));
        InternalServiceTokenFilter filter = filter("strict", resolver);
        AtomicReference<HttpServletRequest> downstream = new AtomicReference<>();
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            downstream.set(invocation.getArgument(0));
            return null;
        }).when(chain).doFilter(any(), any());
        MockHttpServletRequest request = firebaseRequest("", "actor-a", "finance", "actor-a@mysc.co.kr");
        request.addHeader("x-tenant-id", "tenant-selected");

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        verify(resolver).resolve("tenant-selected", "actor-a");
        assertThat(downstream.get().getHeader("x-tenant-id")).isEqualTo("tenant-selected");
        assertThat(downstream.get().getHeader("x-actor-role")).isEqualTo("pm");
    }

    @Test
    void claimlessTenantHeaderWithoutCanonicalMemberIsDeniedBeforeController() throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        when(resolver.resolve("tenant-selected", "actor-a")).thenReturn(Optional.empty());
        InternalServiceTokenFilter filter = filter("strict", resolver);
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletRequest request = firebaseRequest("", "actor-a", "finance", "actor-a@mysc.co.kr");
        request.addHeader("x-tenant-id", "tenant-selected");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("\"code\":\"member_inactive\"");
        verify(chain, never()).doFilter(any(), any());
    }

    @Test
    void workspaceFirebaseRequestStillRequiresCanonicalActiveMemberAndRole() throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        when(resolver.resolve("tenant-workspace", "workspace-user"))
            .thenReturn(Optional.of(member(true, "INACTIVE", "admin")));
        InternalServiceTokenFilter filter = filter("workspace", resolver);
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(
            firebaseRequest("tenant-workspace", "workspace-user", "finance", "workspace-user@mysc.co.kr"),
            response,
            chain
        );

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("\"code\":\"member_inactive\"");
        verify(chain, never()).doFilter(any(), any());
    }

    @Test
    void activeWorkspaceMemberUsesCanonicalRoleWithoutSyntheticWorkspaceRole() throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        when(resolver.resolve("tenant-workspace", "workspace-user"))
            .thenReturn(Optional.of(member(true, "ACTIVE", "pm")));
        InternalServiceTokenFilter filter = filter("workspace", resolver);
        AtomicReference<HttpServletRequest> downstream = new AtomicReference<>();
        FilterChain chain = mock(FilterChain.class);
        doAnswer(invocation -> {
            downstream.set(invocation.getArgument(0));
            return null;
        }).when(chain).doFilter(any(), any());

        filter.doFilter(
            firebaseRequest("tenant-workspace", "workspace-user", "finance", "workspace-user@mysc.co.kr"),
            new MockHttpServletResponse(),
            chain
        );

        assertThat(downstream.get().getHeader("x-actor-role")).isEqualTo("pm");
    }

    @Test
    void canonicalResolverFailureFailsClosedBeforeController() throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        when(resolver.resolve("tenant-a", "actor-a")).thenThrow(
            new CanonicalMemberResolver.CanonicalMemberResolutionException("unavailable")
        );
        InternalServiceTokenFilter filter = filter("strict", resolver);
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(firebaseRequest("tenant-a", "actor-a", "finance", "actor-a@mysc.co.kr"), response, chain);

        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(response.getContentAsString()).contains("\"code\":\"member_resolver_unavailable\"");
        verify(chain, never()).doFilter(any(), any());
    }

    @Test
    void internalServiceTokenPreservesTrustedBffFlowWithoutCanonicalLookup() throws Exception {
        CanonicalMemberResolver resolver = mock(CanonicalMemberResolver.class);
        InternalServiceTokenFilter filter = new InternalServiceTokenFilter(
            true,
            "service-secret",
            "",
            "strict",
            "mysc.co.kr",
            new FirebaseBearerTokenVerifier("", true),
            resolver
        );
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletRequest request = protectedRequest();
        request.addHeader(InternalServiceTokenFilter.HEADER_NAME, "service-secret");

        filter.doFilter(request, new MockHttpServletResponse(), chain);

        verify(chain).doFilter(eq(request), any());
        verify(resolver, never()).resolve(any(), any());
    }

    private static Stream<Arguments> nonActiveStatuses() {
        return Stream.of(
            Arguments.of("INACTIVE", "INACTIVE"),
            Arguments.of("DISABLED", "DISABLED"),
            Arguments.of("empty", ""),
            Arguments.of("blank", " "),
            Arguments.of("null", null),
            Arguments.of("number", 7),
            Arguments.of("lowercase", "active"),
            Arguments.of("padded", " ACTIVE ")
        );
    }

    private static CanonicalMemberResolver.CanonicalMember member(
        boolean statusPresent,
        Object status,
        String role
    ) {
        return new CanonicalMemberResolver.CanonicalMember(statusPresent, status, role);
    }

    private static InternalServiceTokenFilter filter(String authMode, CanonicalMemberResolver resolver) {
        return new InternalServiceTokenFilter(
            false,
            "",
            "",
            authMode,
            "mysc.co.kr",
            new FirebaseBearerTokenVerifier("", true),
            resolver
        );
    }

    private static MockHttpServletRequest firebaseRequest(
        String tenantId,
        String actorId,
        String role,
        String email
    ) {
        MockHttpServletRequest request = protectedRequest();
        String claims = "uid=%s;tenantId=%s;role=%s;email=%s".formatted(actorId, tenantId, role, email);
        String token = "test-firebase:" + Base64.getUrlEncoder()
            .encodeToString(claims.getBytes(StandardCharsets.UTF_8));
        request.addHeader("authorization", "Bearer " + token);
        if (!tenantId.isBlank()) request.addHeader("x-tenant-id", tenantId);
        return request;
    }

    private static MockHttpServletRequest protectedRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/weekly-expenses/project-a/sheets/default/save-draft");
        request.setRequestURI("/api/v1/weekly-expenses/project-a/sheets/default/save-draft");
        return request;
    }
}
