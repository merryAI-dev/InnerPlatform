package dev.merryai.innerplatform.weekly.storage;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@ActiveProfiles("test")
class JpaWeeklyExpensePersistenceTransactionTest {
    @Autowired
    private JpaWeeklyExpensePersistence persistence;

    @Test
    void opensSpringTransactionAtPersistenceBoundary() {
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();

        boolean transactionActive = persistence.runCommandTransaction(
            TransactionSynchronizationManager::isActualTransactionActive
        );

        assertThat(transactionActive).isTrue();
        assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
    }
}
