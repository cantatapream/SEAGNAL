package com.seagnal.app;

import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.content.Context;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.seagnal.app.voice.SeagnalAssistantPlugin;

/**
 * SEAGNAL Android 앱의 메인 Activity (Capacitor BridgeActivity 확장).
 *
 * [역할]
 *   - WebView 기본 설정 (텍스트 줌 100% 고정, 핀치 줌 활성화)
 *   - 네트워크 오류 시 커스텀 오프라인 페이지 표출
 *   - Capacitor 브릿지 기능 유지 (BridgeWebViewClient 상속)
 *
 * [WebView 정책]
 *   - setTextZoom(100): 시스템 폰트 크기(접근성 설정) 무시 — 모든 사용자에게
 *     동일한 레이아웃 보장. 텍스트 크기는 앱 자체 설정(설정 모달)으로 조정.
 *   - 핀치 줌: 지도/이미지 확대 가능. zoom controls 버튼은 숨김.
 *   - 메인 프레임 로딩 실패 → 다크 테마 오프라인 HTML 로 fallback
 *     (서브 리소스 실패는 Capacitor 기본 처리)
 *
 * [연계]
 *   - capacitor.config.json: server.url 또는 androidScheme 설정
 *   - 웹뷰 안의 JS — capacitor-plugins.js 가 native API 호출
 */
public class MainActivity extends BridgeActivity {

    /** 현재 오프라인 에러 페이지가 표시 중인지 여부 — onPageStarted 에서 reset. */
    private boolean isShowingError = false;
    /** 마지막으로 실패한 URL — "다시 시도" 버튼이 이 URL 로 재로드 시도. */
    private String lastFailedUrl = null;

    /**
     * Capacitor 브릿지 초기화 전에 커스텀 플러그인을 등록한다.
     * (음성 비서 네이티브 서비스 제어용 SeagnalAssistant 플러그인)
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SeagnalAssistantPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /**
     * Activity 시작 시점 hook — WebView 가 준비된 직후 폰트 줌/핀치 줌 설정 +
     * 커스텀 WebViewClient 등록.
     */
    @Override
    public void onStart() {
        super.onStart();
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            // 시스템 폰트 크기 설정을 무시하고 100%로 고정
            WebSettings settings = webView.getSettings();
            settings.setTextZoom(100);

            // 핀치 줌(두 손가락 확대/축소) 활성화
            settings.setSupportZoom(true);
            settings.setBuiltInZoomControls(true);
            settings.setDisplayZoomControls(false); // +/- 버튼 숨김

            // BridgeWebViewClient를 상속하여 Capacitor 브릿지 기능을 유지하면서
            // 네트워크 에러 감지 기능 추가
            webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
                @Override
                public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    // 메인 프레임 로딩 에러만 커스텀 처리 (이미지, CSS 등 서브리소스 에러는 Capacitor 기본 처리)
                    if (request.isForMainFrame()) {
                        isShowingError = true;
                        lastFailedUrl = request.getUrl().toString();
                        view.loadDataWithBaseURL(null, getOfflineErrorHtml(lastFailedUrl), "text/html", "UTF-8", null);
                    } else {
                        super.onReceivedError(view, request, error);
                    }
                }

                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    // 에러 페이지의 자체 로딩은 무시
                    if (url == null || url.equals("about:blank")) return;
                    isShowingError = false;
                    super.onPageStarted(view, url, favicon);
                }
            });

            // [음성] WebView 안의 웹 음성인식(getUserMedia/SpeechRecognition)이 마이크를
            //   쓸 수 있도록 권한 요청을 허용한다. (앱에 RECORD_AUDIO 가 있어야 실제 동작)
            //   Capacitor 기본 동작/파일 선택 등은 BridgeWebChromeClient 를 그대로 상속해 보존.
            webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                request.grant(new String[]{ PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                            } catch (Exception e) {
                                request.deny();
                            }
                        }
                    });
                }
            });
        }
    }

    /**
     * 네트워크 연결 상태 확인
     */
    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
            return activeNetwork != null && activeNetwork.isConnected();
        }
        return false;
    }

    /**
     * 오프라인 에러 페이지 HTML
     * 앱의 다크 테마(#080a0f ~ #1c2640)에 맞춘 디자인
     */
    private String getOfflineErrorHtml(String retryUrl) {
        // XSS 방지를 위해 URL에서 위험 문자 이스케이프
        String safeUrl = retryUrl.replace("\\", "\\\\").replace("'", "\\'").replace("\"", "&quot;");
        return "<!DOCTYPE html>" +
            "<html lang='ko'>" +
            "<head>" +
            "<meta charset='UTF-8'>" +
            "<meta name='viewport' content='width=device-width, initial-scale=1.0'>" +
            "<style>" +
            "* { margin: 0; padding: 0; box-sizing: border-box; }" +
            "body {" +
            "  font-family: 'Inter', 'Noto Sans KR', sans-serif;" +
            "  background: linear-gradient(180deg, #080a0f 0%, #111525 50%, #080a0f 100%);" +
            "  color: #ffffff;" +
            "  display: flex;" +
            "  align-items: center;" +
            "  justify-content: center;" +
            "  min-height: 100vh;" +
            "  text-align: center;" +
            "  padding: 24px;" +
            "}" +
            ".error-container {" +
            "  max-width: 340px;" +
            "}" +
            ".error-icon {" +
            "  width: 80px;" +
            "  height: 80px;" +
            "  margin: 0 auto 28px;" +
            "  border-radius: 50%;" +
            "  background: rgba(255, 82, 82, 0.12);" +
            "  display: flex;" +
            "  align-items: center;" +
            "  justify-content: center;" +
            "}" +
            ".error-icon svg {" +
            "  width: 40px;" +
            "  height: 40px;" +
            "  stroke: #ff5252;" +
            "  fill: none;" +
            "  stroke-width: 2;" +
            "  stroke-linecap: round;" +
            "  stroke-linejoin: round;" +
            "}" +
            ".error-title {" +
            "  font-size: 1.3rem;" +
            "  font-weight: 700;" +
            "  margin-bottom: 12px;" +
            "  color: #ffffff;" +
            "}" +
            ".error-message {" +
            "  font-size: 0.95rem;" +
            "  color: #94a3b8;" +
            "  line-height: 1.6;" +
            "  margin-bottom: 32px;" +
            "}" +
            ".retry-button {" +
            "  display: inline-flex;" +
            "  align-items: center;" +
            "  gap: 8px;" +
            "  padding: 14px 32px;" +
            "  background: #448aff;" +
            "  color: #ffffff;" +
            "  border: none;" +
            "  border-radius: 12px;" +
            "  font-size: 1rem;" +
            "  font-weight: 600;" +
            "  cursor: pointer;" +
            "  transition: background 0.2s;" +
            "  -webkit-tap-highlight-color: transparent;" +
            "}" +
            ".retry-button:active {" +
            "  background: #2962ff;" +
            "}" +
            ".retry-button svg {" +
            "  width: 18px;" +
            "  height: 18px;" +
            "  stroke: #ffffff;" +
            "  fill: none;" +
            "  stroke-width: 2;" +
            "  stroke-linecap: round;" +
            "  stroke-linejoin: round;" +
            "}" +
            "</style>" +
            "</head>" +
            "<body>" +
            "<div class='error-container'>" +
            "  <div class='error-icon'>" +
            "    <svg viewBox='0 0 24 24'>" +
            "      <line x1='1' y1='1' x2='23' y2='23'/>" +
            "      <path d='M16.72 11.06A10.94 10.94 0 0 1 19 12.55'/>" +
            "      <path d='M5 12.55a10.94 10.94 0 0 1 5.17-2.39'/>" +
            "      <path d='M10.71 5.05A16 16 0 0 1 22.56 9'/>" +
            "      <path d='M1.42 9a15.91 15.91 0 0 1 4.7-2.88'/>" +
            "      <path d='M8.53 16.11a6 6 0 0 1 6.95 0'/>" +
            "      <line x1='12' y1='20' x2='12.01' y2='20'/>" +
            "    </svg>" +
            "  </div>" +
            "  <h1 class='error-title'>인터넷에 연결할 수 없습니다</h1>" +
            "  <p class='error-message'>" +
            "    네트워크 연결 상태를 확인한 후<br>다시 시도해 주세요." +
            "  </p>" +
            "  <button class='retry-button' onclick=\"window.location.href='" + safeUrl + "'\">" +
            "    <svg viewBox='0 0 24 24'>" +
            "      <polyline points='23 4 23 10 17 10'/>" +
            "      <path d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10'/>" +
            "    </svg>" +
            "    다시 시도" +
            "  </button>" +
            "</div>" +
            "</body>" +
            "</html>";
    }
}
