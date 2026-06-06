package com.seagnal.app.memory;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.Dao;
import androidx.room.Insert;
import androidx.room.OnConflictStrategy;
import androidx.room.Query;
import androidx.room.Transaction;

import java.util.List;

/**
 * [사용자 기억 v2 — E1] Room DAO — 5 테이블 통합 입출구.
 *
 * 설계 출처: A1 전반 + 본 작업 지시(E1) §3
 *
 * 본 DAO 의 책임은 "테이블에 닿는 SQL 만". 다음 항목은 의도적으로 본 트랙 범위 외:
 *   - 임베딩 기반 정밀 검색  → A4 트랙
 *   - 압축 트리거            → A3 트랙
 *   - 호출 진입점 통합       → E3 트랙 (기존 VoiceAssistantService 수정 금지)
 *
 * 검색 기본 매칭은 단순 LIKE 로 출발한다(A4 가 정밀화 예정).
 */
@Dao
public interface UserMemoryDao {

    // ────────────────────────────────────────────────────────────────────
    // user_profile (단일 행)
    // ────────────────────────────────────────────────────────────────────

    @Query("SELECT * FROM user_profile WHERE id = 1 LIMIT 1")
    @Nullable
    UserProfileEntity readUserProfile();

    /**
     * upsert — id 가 항상 1 이므로 REPLACE 전략이 안전.
     * (A1 §2.1 의 CHECK id=1 불변식과 정합.)
     */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertUserProfile(@NonNull UserProfileEntity profile);

    // ────────────────────────────────────────────────────────────────────
    // style_digest (단일 행)
    // ────────────────────────────────────────────────────────────────────

    @Query("SELECT * FROM style_digest WHERE id = 1 LIMIT 1")
    @Nullable
    StyleDigestEntity readStyleDigest();

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    void upsertStyleDigest(@NonNull StyleDigestEntity digest);

    // ────────────────────────────────────────────────────────────────────
    // episodes — 무한 누적 원본
    // ────────────────────────────────────────────────────────────────────

    /**
     * 단순 LIKE 매칭 (A1 §3 인덱스: created_at DESC 활용).
     * A4 트랙이 도입되면 FTS5 또는 임베딩 유사도로 교체된다.
     *
     * @param queryLike  예: "%태풍%" 형태로 호출자가 % 를 부착한다.
     * @param limit      반환 상한.
     */
    @Query("SELECT * FROM episodes " +
            "WHERE compressed_flag = 0 " +
            "  AND (query LIKE :queryLike OR answer_summary LIKE :queryLike) " +
            "ORDER BY created_at DESC " +
            "LIMIT :limit")
    @NonNull
    List<EpisodeEntity> readRelevantEpisodes(@NonNull String queryLike, int limit);

    /**
     * 원시 INSERT — 본 DAO 는 트림/개인정보 가드를 수행하지 않는다(A2 책임).
     * 반환은 신규 row id.
     */
    @Insert(onConflict = OnConflictStrategy.ABORT)
    long insertEpisode(@NonNull EpisodeEntity episode);

    /**
     * 호출자 친화 헬퍼 — 자주 쓰는 5 컬럼을 받아 EpisodeEntity 를 조립한 후 INSERT.
     * A1 §2.4 의 필수 컬럼만 받고 옵션(intent, domain)은 추후 오버로드 예정.
     *
     * @param query          사용자 원문 (트림 책임은 호출자/A2).
     * @param answer         어시스턴트 답변 요약 (트림 책임 동일).
     * @param zone           응답 시점 해역 (옵션).
     * @param tools          tools_used — JSON 배열 stringified (옵션).
     * @param channel        chat / voice. NOT NULL.
     * @return 신규 row id.
     */
    @Transaction
    default long appendEpisode(
            @NonNull String query,
            @NonNull String answer,
            @Nullable String zone,
            @Nullable String tools,
            @NonNull String channel) {
        long now = System.currentTimeMillis();
        EpisodeEntity e = EpisodeEntity.of(now, query, answer, zone, tools, channel);
        return insertEpisode(e);
    }

    // ────────────────────────────────────────────────────────────────────
    // consolidated_memory — AI 압축 두뇌
    // ────────────────────────────────────────────────────────────────────

    /**
     * 정렬 키는 화이트리스트로 enum 처리.
     * @see SortBy
     */
    enum SortBy {
        REF_COUNT,
        LAST_REFERENCED,
        RECENT
    }

    /**
     * 활성(최신) 압축본 top-N. superseded_by IS NULL 만 노출.
     * sortBy 별로 다른 인덱스를 활용한다 (A1 §3).
     */
    @Transaction
    default List<ConsolidatedMemoryEntity> readConsolidatedTop(int limit, @NonNull SortBy sortBy) {
        switch (sortBy) {
            case REF_COUNT:
                return readConsolidatedTopByRefCount(limit);
            case LAST_REFERENCED:
                return readConsolidatedTopByLastReferenced(limit);
            case RECENT:
            default:
                return readConsolidatedTopByRecent(limit);
        }
    }

    @Query("SELECT * FROM consolidated_memory " +
            "WHERE superseded_by IS NULL " +
            "ORDER BY ref_count DESC " +
            "LIMIT :limit")
    @NonNull
    List<ConsolidatedMemoryEntity> readConsolidatedTopByRefCount(int limit);

    @Query("SELECT * FROM consolidated_memory " +
            "WHERE superseded_by IS NULL " +
            "ORDER BY last_referenced_at DESC " +
            "LIMIT :limit")
    @NonNull
    List<ConsolidatedMemoryEntity> readConsolidatedTopByLastReferenced(int limit);

    @Query("SELECT * FROM consolidated_memory " +
            "WHERE superseded_by IS NULL " +
            "ORDER BY created_at DESC " +
            "LIMIT :limit")
    @NonNull
    List<ConsolidatedMemoryEntity> readConsolidatedTopByRecent(int limit);

    /**
     * action 화이트리스트.
     *   - INSERT: 동일 topic 의 기존 활성 행은 superseded_by 가 신규 id 로 기록되고,
     *             신규 행이 활성(superseded_by = NULL) 으로 INSERT.
     *   - UPDATE_REF: targetId 의 ref_count += 1, last_referenced_at = now.
     */
    enum Action {
        INSERT,
        UPDATE_REF
    }

    /**
     * 통합 upsert — A3(영구 압축 두뇌) 트랙이 호출.
     *
     * @param action    INSERT(신규 압축본) / UPDATE_REF(참조 카운트).
     * @param targetId  UPDATE_REF 일 때 대상 row id. INSERT 시 무시.
     * @param summary   INSERT 시 필수 (NULL 이면 빈 문자열).
     * @param topic     INSERT 시 필수.
     * @param tagsJson  relevance_tags — JSON 배열 stringified (옵션).
     * @return INSERT 의 경우 신규 row id, UPDATE_REF 의 경우 갱신된 row id (-1 if N/A).
     */
    @Transaction
    default long upsertConsolidated(
            @NonNull Action action,
            @Nullable Long targetId,
            @Nullable String summary,
            @Nullable String topic,
            @Nullable String tagsJson) {
        long now = System.currentTimeMillis();
        if (action == Action.UPDATE_REF) {
            if (targetId == null) return -1L;
            bumpRefCount(targetId, now);
            return targetId;
        }
        // INSERT path — 토픽 필수
        String safeTopic = topic == null ? "" : topic;
        String safeSummary = summary == null ? "" : summary;
        Long previousActiveId = findActiveIdByTopic(safeTopic);
        int nextVersion = nextVersionForTopic(safeTopic);

        ConsolidatedMemoryEntity row = new ConsolidatedMemoryEntity();
        row.createdAt = now;
        row.topic = safeTopic;
        row.summary = safeSummary;
        row.relevanceTags = tagsJson;
        row.refCount = 0;
        row.lastReferencedAt = null;
        row.sourceEpisodeIds = null;
        row.version = nextVersion;
        row.supersededBy = null;
        long newId = insertConsolidated(row);

        if (previousActiveId != null) {
            markSupersededBy(previousActiveId, newId);
        }
        return newId;
    }

    @Insert(onConflict = OnConflictStrategy.ABORT)
    long insertConsolidated(@NonNull ConsolidatedMemoryEntity row);

    @Query("UPDATE consolidated_memory " +
            "SET ref_count = ref_count + 1, last_referenced_at = :now " +
            "WHERE id = :id")
    void bumpRefCount(long id, long now);

    @Query("SELECT id FROM consolidated_memory " +
            "WHERE topic = :topic AND superseded_by IS NULL " +
            "LIMIT 1")
    @Nullable
    Long findActiveIdByTopic(@NonNull String topic);

    @Query("SELECT IFNULL(MAX(version), 0) + 1 FROM consolidated_memory WHERE topic = :topic")
    int nextVersionForTopic(@NonNull String topic);

    @Query("UPDATE consolidated_memory SET superseded_by = :newId WHERE id = :previousId")
    void markSupersededBy(long previousId, long newId);

    // ────────────────────────────────────────────────────────────────────
    // 카운트 (TTL/압축 트리거 체크용 — A1 §5)
    // ────────────────────────────────────────────────────────────────────

    @Query("SELECT COUNT(*) FROM episodes")
    int countEpisodes();

    @Query("SELECT COUNT(*) FROM consolidated_memory WHERE superseded_by IS NULL")
    int countConsolidated();
}
