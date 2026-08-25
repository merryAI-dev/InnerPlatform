package dev.merryai.innerplatform.weekly.api;

import com.google.api.core.ApiFutures;
import com.google.cloud.firestore.DocumentReference;
import com.google.cloud.firestore.DocumentSnapshot;
import com.google.cloud.firestore.Firestore;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class CanonicalMemberResolverTest {
    @Test
    void resolvesOnlyExactTenantAndActorDocumentAndPreservesAbsentStatus() {
        Firestore firestore = mock(Firestore.class);
        DocumentReference reference = mock(DocumentReference.class);
        DocumentSnapshot snapshot = mock(DocumentSnapshot.class);
        when(firestore.document("orgs/tenant-selected/members/actor-a")).thenReturn(reference);
        when(reference.get()).thenReturn(ApiFutures.immediateFuture(snapshot));
        when(snapshot.exists()).thenReturn(true);
        when(snapshot.getData()).thenReturn(Map.of("role", "viewer"));

        CanonicalMemberResolver.CanonicalMember member = new CanonicalMemberResolver(firestore)
            .resolve("tenant-selected", "actor-a")
            .orElseThrow();

        assertThat(member.statusPresent()).isFalse();
        assertThat(member.status()).isNull();
        assertThat(member.role()).isEqualTo("viewer");
        verify(firestore).document("orgs/tenant-selected/members/actor-a");
    }

    @Test
    void preservesExplicitNullStatusAsPresentForFailClosedGate() {
        Firestore firestore = mock(Firestore.class);
        DocumentReference reference = mock(DocumentReference.class);
        DocumentSnapshot snapshot = mock(DocumentSnapshot.class);
        Map<String, Object> data = new HashMap<>();
        data.put("status", null);
        data.put("role", "finance");
        when(firestore.document("orgs/tenant-a/members/actor-a")).thenReturn(reference);
        when(reference.get()).thenReturn(ApiFutures.immediateFuture(snapshot));
        when(snapshot.exists()).thenReturn(true);
        when(snapshot.getData()).thenReturn(data);

        CanonicalMemberResolver.CanonicalMember member = new CanonicalMemberResolver(firestore)
            .resolve("tenant-a", "actor-a")
            .orElseThrow();

        assertThat(member.statusPresent()).isTrue();
        assertThat(member.status()).isNull();
    }

    @Test
    void returnsEmptyWhenExactCanonicalMemberDoesNotExist() {
        Firestore firestore = mock(Firestore.class);
        DocumentReference reference = mock(DocumentReference.class);
        DocumentSnapshot snapshot = mock(DocumentSnapshot.class);
        when(firestore.document("orgs/tenant-a/members/actor-a")).thenReturn(reference);
        when(reference.get()).thenReturn(ApiFutures.immediateFuture(snapshot));
        when(snapshot.exists()).thenReturn(false);

        assertThat(new CanonicalMemberResolver(firestore).resolve("tenant-a", "actor-a")).isEmpty();
    }

    @Test
    void rejectsPathLikeTenantBeforeFirestoreLookup() {
        Firestore firestore = mock(Firestore.class);

        assertThatThrownBy(() -> new CanonicalMemberResolver(firestore).resolve("tenant-a/members/attacker", "actor-a"))
            .isInstanceOf(CanonicalMemberResolver.CanonicalMemberResolutionException.class);

        verifyNoInteractions(firestore);
    }
}
