package com.seagnal.app;

import android.content.Context;
import android.util.AttributeSet;
import android.widget.VideoView;

public class FullWidthVideoView extends VideoView {
    public FullWidthVideoView(Context context) {
        super(context);
    }

    public FullWidthVideoView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

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
