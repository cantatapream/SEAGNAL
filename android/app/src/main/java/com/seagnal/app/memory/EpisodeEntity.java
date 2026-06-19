package com.seagnal.app.memory;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/**
 * [사용자 기억 v2 — E1] episodes 테이블 매핑 — 무한 누적 원본.
 *
 * 설계 출처: A1 §2.4 / §3 (인덱스 5종) / §4 (보존 정책: 영구)
 *   - query ≤ 300자, answer_summary ≤ 600자 트림 (쓰기 파이프라인 A2 가드)
 *   - 좌표·전화·이메일·계정 식별자 컬럼 부재 — 누수면 확장 방지 (위험 §8 #6)
 *   - compressed_flag = 1 이면 검색 우선순위 ↓ (consolidated_memory 가 대표)
 *   - source_channel ∈ {chat, voice}
 *
 * 인덱스는 DDL 의사코드와 동일하게 5개를 선언.
 */
@Entity(
        tableName = "episodes",
        indices = {
                @Index(value = {"created_at"}),
                @Index(value = {"zone", "created_at"}),
                @Index(value = {"domain", "created_at"}),
                @Index(value = {"source_channel", "created_at"}),
                @Index(value = {"compressed_flag", "created_at"})
        }
)
public class EpisodeEntity {

    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    public long id;

    /** 작성 시각 (epoch ms). NOT NULL. */
    @ColumnInfo(name = "created_at")
    public long createdAt;

    /** 사용자 원문 (≤300자, 트림 책임은 A2). NOT NULL. */
    @NonNull
    @ColumnInfo(name = "query")
    public String query = "";

    /** 어시스턴트 답변 요약 (≤600자, 트림 책임은 A2). NOT NULL. */
    @NonNull
    @ColumnInfo(name = "answer_summary")
    public String answerSummary = "";

    /** 응답 시점에 추정된 해역. */
    @Nullable
    @ColumnInfo(name = "zone")
    public String zone;

    /** 사용된 도구 — JSON 배열 stringified (예: '["get_marine_forecast"]'). */
    @Nullable
    @ColumnInfo(name = "tools_used")
    public String toolsUsed;

    /** 도메인 분류 (marine_forecast/typhoon/general 등). */
    @Nullable
    @ColumnInfo(name = "domain")
    public String domain;

    /** chat / voice. CHECK 제약은 A2 쓰기 단계에서 검증. NOT NULL. */
    @NonNull
    @ColumnInfo(name = "source_channel")
    public String sourceChannel = "chat";

    /** planQuery 의 1차 의도 (옵션). */
    @Nullable
    @ColumnInfo(name = "intent")
    public String intent;

    /** 압축본으로 흡수된 경우 consolidated_memory.id (NULL=원본). */
    @Nullable
    @ColumnInfo(name = "consolidated_ref")
    public Long consolidatedRef;

    /** 0=raw, 1=압축됨 (검색 우선순위 ↓). NOT NULL DEFAULT 0. */
    @ColumnInfo(name = "compressed_flag", defaultValue = "0")
    public int compressedFlag = 0;

    public EpisodeEntity() {
        // Room 기본 생성자.
    }

    /** 헬퍼 — A2 트랙이 도입되기 전까지 단순 누적용. */
    @NonNull
    public static EpisodeEntity of(
            long createdAt,
            @NonNull String query,
            @NonNull String answerSummary,
            @Nullable String zone,
            @Nullable String toolsUsed,
            @NonNull String sourceChannel) {
        EpisodeEntity e = new EpisodeEntity();
        e.createdAt = createdAt;
        e.query = query;
        e.answerSummary = answerSummary;
        e.zone = zone;
        e.toolsUsed = toolsUsed;
        e.sourceChannel = sourceChannel;
        e.compressedFlag = 0;
        return e;
    }
}
