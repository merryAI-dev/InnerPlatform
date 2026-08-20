package dev.merryai.innerplatform.weekly.storage;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * lockState 가 없는 완료 기록의 해석을 고정한다.
 *
 * <p>라이브 사고(2026-08, JLIN IBS · GGGI): 완료 문서 55건 전부에 lockState 가 없었는데
 * 이 자리가 없는 값을 LOCKED 로 읽어, 조직장이 확정한 적 없는 주가 "조직장 확정 · 완료"
 * 로 보이고 회수(SUBMITTED 에서만 가능)까지 막혔다. lockState 는 확정 단계와 함께 생긴
 * 필드이므로, 없다는 것은 확정을 지난 적이 없다는 뜻이다.
 */
class WeeklyLegacyLockStateTest {
    @Test
    void treatsCompletionsWithoutLockStateAsAwaitingConfirmation() throws Exception {
        String source = Files.readString(Path.of(
            "src/main/java/dev/merryai/innerplatform/weekly/storage/FirestoreInheritedWeeklyExpensePersistence.java"
        ));

        assertThat(source)
            .as("lockState 없는 완료는 확정 대기(SUBMITTED)로 읽어야 한다")
            .contains("text(value.get(\"lockState\"), \"SUBMITTED\")")
            .doesNotContain("text(value.get(\"lockState\"), \"LOCKED\")");
        // 확정 쓰기는 그대로 LOCKED 여야 한다 - 읽기 기본값만 바뀐 것이다.
        assertThat(source).contains("version.put(\"lockState\", \"LOCKED\")");
        assertThat(source).contains("version.put(\"lockState\", \"SUBMITTED\")");
    }
}
