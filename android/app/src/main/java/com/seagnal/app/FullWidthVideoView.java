package com.seagnal.app;

import android.content.Context;
import android.util.AttributeSet;
import android.widget.VideoView;

/**
 * 표준 Android VideoView 의 너비를 부모 컨테이너 너비에 맞추는 커스텀 뷰.
 *
 * [문제 배경]
 *   Android 기본 VideoView 는 비디오의 원본 종횡비에 맞춰 자동으로
 *   width/height 를 계산하여, layout_width="match_parent" 로 지정해도
 *   실제로는 종횡비 고정으로 좁게 그려지는 문제가 있다. 이로 인해
 *   세로 영상 또는 가로 영상이 화면 너비를 채우지 못하고 좌우 여백이 생김.
 *
 * [해결]
 *   onMeasure 를 override 하여 width 는 항상 부모가 준 그대로 사용하고,
 *   height 만 비디오 종횡비로 계산하도록 수정. 결과: 너비가 부모에 꽉 차고
 *   높이가 종횡비로 자연스럽게 결정.
 *
 * [사용처]
 *   레이아웃 XML 에서 <com.seagnal.app.FullWidthVideoView .../> 형태로 사용.
 *   WebView 안에서는 미사용 — 웹뷰 외 native 비디오 재생 화면 전용.
 */
public class FullWidthVideoView extends VideoView {
    /** Code 에서 직접 생성할 때 사용. */
    public FullWidthVideoView(Context context) {
        super(context);
    }

    /** XML 레이아웃에서 inflate 될 때 사용 — 표준 attrs 처리. */
    public FullWidthVideoView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    /** 사용자 지정 스타일이 있을 때 사용 (드물게 호출됨). */
    public FullWidthVideoView(Context context, AttributeSet attrs, int defStyle) {
        super(context, attrs, defStyle);
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        // 1. 화면의 전체 너비를 가져옵니다.
        int width = getDefaultSize(0, widthMeasureSpec);
        
        // 2. 높이는 너비가 정해지면 비율에 맞춰 자동으로 계산하도록 초기값 세팅
        // (VideoView 내부에서 비디오 로드 후 비율을 알지만, 
        // 여기서는 일단 너비를 강제로 화면 너비로 맞추는 것이 핵심)
        
        // 일단 기본 동작을 호출하여 비디오의 원본 비율을 계산하게 둡니다.
        super.onMeasure(widthMeasureSpec, heightMeasureSpec);
        
        // 3. 비디오가 로드되어 크기가 측정된 상태라면 재조정
        int videoWidth = getMeasuredWidth();
        int videoHeight = getMeasuredHeight();

        if (width > 0 && videoWidth > 0) {
            // 화면 너비에 꽉 차게 (Scale to Width)
            // 높이는 비율 유지하여 증가
            float ratio = (float) width / videoWidth;
            int adjustedHeight = (int) (videoHeight * ratio);
            
            setMeasuredDimension(width, adjustedHeight);
        }
    }
}
