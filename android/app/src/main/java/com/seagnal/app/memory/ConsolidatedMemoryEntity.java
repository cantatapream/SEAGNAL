package com.seagnal.app.memory;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/**
 * [사용자 기억 v2 — E1] consolidated_memory 테이블 매핑 — AI 압축 두뇌.
 *
 * 설계 출처: A1 §2.5 / §3 (인덱스 3종) / §4 (보존: 영구, 논리 삭제 X, version 분리)
 *   - 갱신 정책: 새 행 INSERT 후 직전 버전의 superseded_by 에 신규 id 기록.
 *   - 검색은 WHERE superseded_by IS NULL 만 우선.
 *   - source_episode_ids 는 JSON 배열 stringified (원본 회수용).
 *
 * 본 Entity 는 매핑만 담당하며 압축 트리거(§5)는 A3 트랙이 구현한다.
 */
@Entity(
        tableName = "consolidated_memory",
        indices = {
                @Index(value = {"topic"}),
                @Index(value = {"last_referenced_at"}),
                @Index(value = {"ref_count"})
        }
)
public class ConsolidatedMemoryEntity {

    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    public long id;

    /** 생성 시각 (epoch ms). NOT NULL. */
    @ColumnInfo(name = "created_at")
    public long createdAt;

    /** 묶음 토픽. NOT NULL. */
    @NonNull
    @ColumnInfo(name = "topic")
    public String topic = "";

    /** AI 가 다수 episodes 를 압축한 핵심 (1~3문장). NOT NULL. */
    @NonNull
    @ColumnInfo(name = "summary")
    public String summary = "";

    /** JSON 배열 stringified — 검색 보조 태그. */
    @Nullable
    @ColumnInfo(name = "relevance_tags")
    public String relevanceTags;

    /** 후속 질문에서 참조된 횟수. NOT NULL DEFAULT 0. */
    @ColumnInfo(name = "ref_count", defaultValue = "0")
    public int refCount = 0;

    /** 마지막 참조 시각 (epoch ms). */
    @Nullable
    @ColumnInfo(name = "last_referenced_at")
    public Long lastReferencedAt;

    /** 원본 회수용 JSON 배열 stringified. */
    @Nullable
    @ColumnInfo(name = "source_episode_ids")
    public String sourceEpisodeIds;

    /** 같은 topic 의 갱신본 누적 (delete X, 새 행 INSERT). NOT NULL DEFAULT 1. */
    @ColumnInfo(name = "version", defaultValue = "1")
    public int version = 1;

    /** 같은 topic 의 후속 버전 id (NULL=최신). */
    @Nullable
    @ColumnInfo(name = "superseded_by")
    public Long supersededBy;

    public ConsolidatedMemoryEntity() {
        // Room 기본 생성자.
    }
}
