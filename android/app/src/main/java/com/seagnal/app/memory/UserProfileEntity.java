package com.seagnal.app.memory;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

/**
 * [사용자 기억 v2 — E1] user_profile 테이블 매핑.
 *
 * 설계 출처: local_server/knowledge/phases/memory_v2_A1_storage_design.md §2.1
 *   - 싱글톤 강제(id = 1)
 *   - 직군/기본 해역/호칭/답변 스타일/경력/선호 포맷 등 정적 프로필
 *   - 시각 컬럼은 epoch ms 정수 (Room TypeConverter 불필요)
 *
 * 본 Entity 는 DDL 의사코드와 1:1 매핑되도록 컬럼명을 snake_case 로 강제했다.
 * (필드명은 자바 관례에 따라 camelCase, ColumnInfo 로 매핑)
 *
 * 불변식:
 *   - id 는 항상 1 (UserMemoryDao#upsertUserProfile 에서 강제)
 *   - 본 클래스는 기존 자바 파일(VoiceAssistantService 등)을 수정하지 않으며,
 *     E3 통합 트랙이 호출 진입점을 연결한다.
 */
@Entity(tableName = "user_profile")
public class UserProfileEntity {

    /** 싱글톤 강제 — DDL CHECK (id = 1) 와 동일 의도. */
    @PrimaryKey
    @ColumnInfo(name = "id")
    public int id = 1;

    /** 직군 코드 (예: marine_leisure, local_gov, fishing). */
    @Nullable
    @ColumnInfo(name = "jikgun")
    public String jikgun;

    /** 기본 해역 (예: KR_S_SOUTH). */
    @Nullable
    @ColumnInfo(name = "default_zone")
    public String defaultZone;

    /** 호칭/별명 (옵션). */
    @Nullable
    @ColumnInfo(name = "display_name")
    public String displayName;

    /** 선호 답변 길이/톤 (short/normal/long, casual/formal). */
    @Nullable
    @ColumnInfo(name = "answer_style")
    public String answerStyle;

    /** 관련 경력(년). 해당 직군 노출 시 사용. */
    @Nullable
    @ColumnInfo(name = "experience_years")
    public Integer experienceYears;

    /** 표/문장/리스트 선호 (table/sentence/list). */
    @Nullable
    @ColumnInfo(name = "preferred_format")
    public String preferredFormat;

    /** 온보딩 완료 시각 (epoch ms). */
    @Nullable
    @ColumnInfo(name = "onboarded_at")
    public Long onboardedAt;

    /** 마지막 갱신 시각 (epoch ms). */
    @Nullable
    @ColumnInfo(name = "updated_at")
    public Long updatedAt;

    public UserProfileEntity() {
        // Room 기본 생성자.
    }

    /** 헬퍼 — 모든 필드를 묶어 단일 행을 생성한다. */
    @NonNull
    public static UserProfileEntity of(
            @Nullable String jikgun,
            @Nullable String defaultZone,
            @Nullable String displayName,
            @Nullable String answerStyle,
            @Nullable Integer experienceYears,
            @Nullable String preferredFormat,
            @Nullable Long onboardedAt,
            @Nullable Long updatedAt) {
        UserProfileEntity e = new UserProfileEntity();
        e.id = 1;
        e.jikgun = jikgun;
        e.defaultZone = defaultZone;
        e.displayName = displayName;
        e.answerStyle = answerStyle;
        e.experienceYears = experienceYears;
        e.preferredFormat = preferredFormat;
        e.onboardedAt = onboardedAt;
        e.updatedAt = updatedAt;
        return e;
    }
}
