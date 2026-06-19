package com.seagnal.app.memory;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.Index;
import androidx.room.PrimaryKey;

/**
 * [사용자 기억 v2 — E1] interest_topics 테이블 매핑.
 *
 * 설계 출처: A1 §2.2 / §3 (인덱스)
 *   - (topic, zone, source_channel) 복합 유니크 — 채널·해역별 별도 행
 *   - count DESC / last_seen_at DESC 인덱스
 *   - source_channel ∈ {chat, voice, mixed}
 *
 * 본 Entity 는 단순 매핑이며, 실제 upsert 머지 정책(채널 mixed 머지 등)은 A2 트랙이 담당.
 */
@Entity(
        tableName = "interest_topics",
        indices = {
                @Index(value = {"topic", "zone", "source_channel"}, unique = true),
                @Index(value = {"count"}),
                @Index(value = {"last_seen_at"})
        }
)
public class InterestTopicEntity {

    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    public long id;

    /** 정규화된 키워드 (예: "태풍", "안개", "물때"). NOT NULL. */
    @NonNull
    @ColumnInfo(name = "topic")
    public String topic = "";

    /** 해역 한정 토픽일 때만 (예: KR_S_SOUTH). */
    @Nullable
    @ColumnInfo(name = "zone")
    public String zone;

    /** 누적 등장 횟수. */
    @ColumnInfo(name = "count", defaultValue = "1")
    public int count = 1;

    /** 마지막 등장 시각 (epoch ms). NOT NULL. */
    @ColumnInfo(name = "last_seen_at")
    public long lastSeenAt;

    /** 최초 등장 시각 (epoch ms). NOT NULL. */
    @ColumnInfo(name = "first_seen_at")
    public long firstSeenAt;

    /**
     * 출처 채널 — chat / voice / mixed.
     * Room 은 CHECK 제약을 어노테이션으로 직접 지원하지 않으므로 쓰기 단계(A2)에서 검증한다.
     */
    @NonNull
    @ColumnInfo(name = "source_channel")
    public String sourceChannel = "chat";

    public InterestTopicEntity() {
        // Room 기본 생성자.
    }
}
