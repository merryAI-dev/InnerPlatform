package dev.merryai.innerplatform.weekly.storage;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * lockState 가 없는 완료 기록의 해석을 고정한다.
 *
 * <p>2026-08-20 에 이 기본값을 SUBMITTED 로 바꿨다가 되돌렸다. 회수 가능 여부를 판정하는
 * 필드는 lockState 가 아니라 완료 문서의 status 이고, 라이브 문서는 status="LOCKED" 다.
 * lockState 만 바꾸니 화면은 회수 버튼을 열어 주는데 서버가 400 으로 막는 불일치가 났다.
 * 두 필드를 함께 다루기 전에는 이 기본값을 건드리지 않는다.
 */
class WeeklyLegacyLockStateTest {
    @Test
    void treatsCompletionsWithoutLockStateAsConfirmed() throws Exception {
        String source = Files.readString(Path.of(
            "src/main/java/dev/merryai/innerplatform/weekly/storage/FirestoreInheritedWeeklyExpensePersistence.java"
        ));

        assertThat(source)
            .as("회수 판정은 완료 문서의 status 가 하고, lockState 만 바꾸면 화면과 서버가 갈린다")
            .contains("text(value.get(\"lockState\"), \"LOCKED\")")
            .doesNotContain("text(value.get(\"lockState\"), \"SUBMITTED\")");
        // 확정 쓰기는 그대로 LOCKED 여야 한다 - 읽기 기본값만 바뀐 것이다.
        assertThat(source).contains("version.put(\"lockState\", \"LOCKED\")");
        assertThat(source).contains("version.put(\"lockState\", \"SUBMITTED\")");
    }
}
