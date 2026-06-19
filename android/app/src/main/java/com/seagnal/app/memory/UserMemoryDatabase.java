package com.seagnal.app.memory;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.room.Database;
import androidx.room.Room;
import androidx.room.RoomDatabase;

import java.io.File;

/**
 * [사용자 기억 v2 — E1] Room @Database — 5 Entity 통합 진입점.
 *
 * 설계 출처: A1 §1.1 (Room 채택) + 본 작업 지시(E1) §4
 *
 * 보안 / 위치:
 *   - DB 파일은 앱의 internal storage(`context.getFilesDir()/seagnal_memory/user_memory.db`)에 둔다.
 *   - 외부 저장소 / 공개 디렉토리 사용 금지 (A1 §4 프라이버시 정합성).
 *   - 서버 동기화 없음 — 로컬 원칙 유지 (cross_cutting §3).
 *
 * 싱글톤:
 *   - 본 클래스의 {@link #getInstance(Context)} 는 프로세스 단일 인스턴스를 보장.
 *   - 멀티 프로세스(예: 음성 서비스 별도 프로세스) 시나리오는 본 트랙 범위 외 — E3 통합 시 검토.
 *
 * 의존성 (build.gradle 수정은 본 트랙 금지 — 코멘트만, 빌드 시 사장님이 추가):
 *   //   implementation 'androidx.room:room-runtime:2.6.1'
 *   //   annotationProcessor 'androidx.room:room-compiler:2.6.1'
 *
 * 위 두 줄을 `android/app/build.gradle` 의 dependencies { ... } 블록 내에
 * (vosk-android 라인 근처) 추가하면 본 패키지가 컴파일된다.
 */
@Database(
        entities = {
                UserProfileEntity.class,
                InterestTopicEntity.class,
                StyleDigestEntity.class,
                EpisodeEntity.class,
                ConsolidatedMemoryEntity.class
        },
        version = 1,
        exportSchema = false
)
public abstract class UserMemoryDatabase extends RoomDatabase {

    /** 서브디렉토리 — internal storage 안에서 DB 파일을 다른 데이터와 분리. */
    private static final String DB_DIR = "seagnal_memory";

    /** Room DB 파일명. */
    private static final String DB_NAME = "user_memory.db";

    /** 싱글톤 인스턴스 (volatile + double-checked locking). */
    private static volatile UserMemoryDatabase INSTANCE;

    /** DAO 진입점. */
    @NonNull
    public abstract UserMemoryDao userMemoryDao();

    /**
     * 프로세스 단일 인스턴스 획득.
     * 호출 측은 ApplicationContext 를 넘기는 것이 안전(메모리 누수 방지).
     */
    @NonNull
    public static UserMemoryDatabase getInstance(@NonNull Context context) {
        UserMemoryDatabase local = INSTANCE;
        if (local != null) {
            return local;
        }
        synchronized (UserMemoryDatabase.class) {
            if (INSTANCE == null) {
                Context app = context.getApplicationContext();
                File dbFile = resolveDbFile(app);
                INSTANCE = Room.databaseBuilder(app, UserMemoryDatabase.class, dbFile.getAbsolutePath())
                        // v1 초기 작성 — 후속 마이그레이션(A8)이 추가될 때까지 fallback 비활성.
                        // 의도적으로 fallbackToDestructiveMigration 을 호출하지 않는다(데이터 보존).
                        .build();
            }
            return INSTANCE;
        }
    }

    /**
     * filesDir 하위에 DB 디렉토리를 보장하고 DB 파일 경로를 반환한다.
     * 보안: filesDir 는 앱 전용 internal storage 로, 다른 앱은 접근 불가.
     */
    @NonNull
    private static File resolveDbFile(@NonNull Context app) {
        File dir = new File(app.getFilesDir(), DB_DIR);
        if (!dir.exists()) {
            // mkdirs 실패는 곧 권한/저장소 문제 — Room 빌드에서 IOException 으로 노출됨.
            // 본 위치에서 throw 하지 않고 Room 에 위임한다.
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return new File(dir, DB_NAME);
    }

    /**
     * 테스트 / 디버그 전용 — 싱글톤 리셋.
     * 운영 코드에서는 호출 금지. (A6 트랙의 "기억 전체 삭제" UI 는 별도 경로로 처리.)
     */
    static void resetForTesting() {
        synchronized (UserMemoryDatabase.class) {
            if (INSTANCE != null) {
                INSTANCE.close();
                INSTANCE = null;
            }
        }
    }
}
