package com.seagnal.app.memory;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.room.ColumnInfo;
import androidx.room.Entity;
import androidx.room.PrimaryKey;

/**
 * [사용자 기억 v2 — E1] style_digest 테이블 매핑.
 *
 * 설계 출처: A1 §2.3
 *   - 단일 행 강제 (id = 1)
 *   - 갱신은 UPDATE 만, DELETE 금지 (보존 정책 §4)
 *   - total_questions % 8 == 0 시 AI 호출 (기존 STYLE_REFRESH_EVERY 와 동일)
 *
 * 본 Entity 는 매핑만 담당하며 실제 갱신 트리거는 A2/A3 트랙에서 처리한다.
 */
@Entity(tableName = "style_digest")
public class StyleDigestEntity {

    @PrimaryKey
    @ColumnInfo(name = "id")
    public int id = 1;

    /** AI 가 갱신한 1문장 요약 (기존 styleNote 와 매핑). */
    @Nullable
    @ColumnInfo(name = "style_note")
    public String styleNote;

    /** 선호 답변 포맷 (table/sentence/list). */
    @Nullable
    @ColumnInfo(name = "preferred_format")
    public String preferredFormat;

    /** 누적 질문 수. NOT NULL DEFAULT 0. */
    @ColumnInfo(name = "total_questions", defaultValue = "0")
    public int totalQuestions = 0;

    /** 최초 시각 (epoch ms). */
    @Nullable
    @ColumnInfo(name = "first_at")
    public Long firstAt;

    /** 마지막 갱신 시각 (epoch ms). */
    @Nullable
    @ColumnInfo(name = "updated_at")
    public Long updatedAt;

    /** 갱신 회차 (디버깅용). NOT NULL DEFAULT 1. */
    @ColumnInfo(name = "version", defaultValue = "1")
    public int version = 1;

    public StyleDigestEntity() {
        // Room 기본 생성자.
    }

    @NonNull
    public static StyleDigestEntity empty(long now) {
        StyleDigestEntity e = new StyleDigestEntity();
        e.id = 1;
        e.totalQuestions = 0;
        e.firstAt = now;
        e.updatedAt = now;
        e.version = 1;
        return e;
    }
}
